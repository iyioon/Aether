import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { folderIdFor, listAssets } from "../src/library/repository.js";
import { getComparisonGeneration } from "../src/library/comparison-generation.js";
import { resetLibraryData } from "../src/library/repository-reset.js";
import { scanLibrary } from "../src/library/scanner.js";

describe("comparison resume and idempotency", () => {
  let db: AetherDatabase;
  let app: FastifyInstance;
  let folderId: string;
  let leftId: string;
  let rightId: string;
  let comparisonGeneration: string;
  let auth: {
    cookies: Record<string, string>;
    headers: Record<string, string>;
  };

  beforeEach(async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-comparison-resume-"));
    await mkdir(path.join(cwd, "media"));
    await writeFile(path.join(cwd, "media", "one.jpg"), "one");
    await writeFile(path.join(cwd, "media", "two.jpg"), "two");
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: await hashPassword("resume-password"),
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );
    db = openDatabase(config.configDir);
    comparisonGeneration = getComparisonGeneration(db);
    await scanLibrary(db, config.mediaRoots);
    app = await buildApp({ config, db, logger: false });
    folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const assets = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items;
    leftId = assets[0]!.id;
    rightId = assets[1]!.id;
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "resume-password" }
    });
    const cookies = Object.fromEntries(
      response.cookies.map((cookie) => [cookie.name, cookie.value])
    );
    auth = { cookies, headers: { "x-csrf-token": cookies.aether_csrf! } };
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  function resume(payload: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: `/api/folders/${folderId}/comparisons/resume`,
      ...auth,
      payload: {
        type: "all",
        recursive: true,
        search: "",
        tags: [],
        score: "all",
        pairAssetIds: [rightId, leftId],
        previousDecision: null,
        ...payload
      }
    });
  }

  function choose(mutationId = randomUUID(), winnerAssetId = leftId) {
    return app.inject({
      method: "POST",
      url: "/api/comparisons",
      ...auth,
      payload: {
        leftAssetId: leftId,
        rightAssetId: rightId,
        winnerAssetId,
        mutationId,
        comparisonGeneration
      }
    });
  }

  it("restores exact orientation using current server records and progress", async () => {
    const decision = await choose();
    const response = await resume({
      previousDecision: {
        eventId: decision.json().eventId,
        pairAssetIds: [leftId, rightId]
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      pair: {
        left: { id: rightId },
        right: { id: leftId },
        progress: { candidateCount: 2, comparedCount: 2, decidedPairCount: 1 }
      },
      previousDecision: {
        eventId: decision.json().eventId,
        pair: { left: { id: leftId }, right: { id: rightId } }
      }
    });
  });

  it("rejects pairs outside current filters or removed from the library", async () => {
    for (const filter of [
      { type: "video" },
      { search: "missing-name" },
      { tags: ["missing-tag"] },
      { score: "favorites" }
    ]) {
      expect((await resume(filter)).json().pair).toBeNull();
    }
    db.prepare("DELETE FROM assets WHERE id = ?").run(leftId);
    expect((await resume()).json().pair).toBeNull();
  });

  it("keeps Undo after a vote leaves the unranked filter, but drops superseded events", async () => {
    const first = await choose();
    const previousDecision = {
      eventId: first.json().eventId,
      pairAssetIds: [leftId, rightId]
    };
    const response = await resume({ score: "unranked", previousDecision });
    expect(response.json().pair).toBeNull();
    expect(response.json().previousDecision?.eventId).toBe(
      first.json().eventId
    );
    expect(
      (await resume({ score: "favorites", previousDecision })).json()
        .previousDecision
    ).toBeNull();
    await choose(randomUUID(), rightId);
    expect(
      (await resume({ previousDecision })).json().previousDecision
    ).toBeNull();
  });

  it("returns the original vote receipt without adding a retry event", async () => {
    const mutationId = randomUUID();
    const first = await choose(mutationId);
    const retry = await choose(mutationId);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM comparison_events").get()
    ).toEqual({ count: 1 });
    expect((await choose(mutationId, rightId)).statusCode).toBe(409);
  });

  it("retries Undo once and does not revive an undone vote on late receipt replay", async () => {
    const choiceId = randomUUID();
    const decision = await choose(choiceId);
    const mutationId = randomUUID();
    const undo = () =>
      app.inject({
        method: "POST",
        url: `/api/comparisons/${decision.json().eventId}/undo`,
        ...auth,
        payload: { mutationId, comparisonGeneration }
      });
    const first = await undo();
    expect(first.statusCode).toBe(200);
    expect((await undo()).json()).toEqual(first.json());
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM comparison_events").get()
    ).toEqual({ count: 2 });
    expect((await choose(choiceId)).statusCode).toBe(200);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM pair_preferences").get()
    ).toEqual({ count: 0 });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/comparisons/${decision.json().eventId}/undo`,
          ...auth,
          payload: { mutationId: choiceId, comparisonGeneration }
        })
      ).statusCode
    ).toBe(409);
  });

  it("protects resume validation with authentication, CSRF and input validation", async () => {
    const url = `/api/folders/${folderId}/comparisons/resume`;
    expect(
      (await app.inject({ method: "POST", url, payload: {} })).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          cookies: auth.cookies,
          payload: {}
        })
      ).statusCode
    ).toBe(403);
    expect((await resume({ pairAssetIds: [leftId, leftId] })).statusCode).toBe(
      400
    );
  });

  it("rejects uncertain operations from before a full comparison reset", async () => {
    const mutationId = randomUUID();
    const decision = await choose(mutationId);
    resetLibraryData(
      db,
      { comparisons: true, scores: false, favorites: false, tags: false },
      new Date().toISOString()
    );
    expect(getComparisonGeneration(db)).not.toBe(comparisonGeneration);
    const replay = await choose(mutationId);
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toBe("comparison_session_reset");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM comparison_events").get()
    ).toEqual({ count: 0 });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/comparisons/${decision.json().eventId}/undo`,
          ...auth,
          payload: { mutationId: randomUUID(), comparisonGeneration }
        })
      ).statusCode
    ).toBe(409);
  });

  it("keeps legacy unkeyed submissions compatible and requires generation for keyed requests", async () => {
    const legacy = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      ...auth,
      payload: {
        leftAssetId: leftId,
        rightAssetId: rightId,
        winnerAssetId: leftId
      }
    });
    expect(legacy.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/comparisons",
          ...auth,
          payload: {
            leftAssetId: leftId,
            rightAssetId: rightId,
            winnerAssetId: leftId,
            mutationId: randomUUID()
          }
        })
      ).statusCode
    ).toBe(400);
  });

  it("retains per-asset reset receipts so a lost-response retry cannot revive its cleared vote", async () => {
    const mutationId = randomUUID();
    const decision = await choose(mutationId);
    const reset = await app.inject({
      method: "DELETE",
      url: `/api/assets/${leftId}/comparisons`,
      ...auth
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().removedComparisons).toBe(1);
    const nextGeneration = getComparisonGeneration(db);
    expect(nextGeneration).not.toBe(comparisonGeneration);
    expect((await choose(mutationId)).statusCode).toBe(409);
    // Receipts remain safe even when explicitly retried in the new generation.
    comparisonGeneration = nextGeneration;
    const replay = await choose(mutationId);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().eventId).toBe(decision.json().eventId);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM comparison_events").get()
    ).toEqual({ count: 1 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM pair_preferences").get()
    ).toEqual({ count: 0 });
    expect(
      (
        await resume({
          previousDecision: {
            eventId: decision.json().eventId,
            pairAssetIds: [leftId, rightId]
          }
        })
      ).json().previousDecision
    ).toBeNull();
  });

  it("rotates generation for an empty per-asset reset and rejects never-received old intent", async () => {
    const neverReceivedMutationId = randomUUID();
    const reset = await app.inject({
      method: "DELETE",
      url: `/api/assets/${leftId}/comparisons`,
      ...auth
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().removedComparisons).toBe(0);
    expect(getComparisonGeneration(db)).not.toBe(comparisonGeneration);
    expect((await choose(neverReceivedMutationId)).statusCode).toBe(409);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM comparison_events").get()
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM pair_preferences").get()
    ).toEqual({ count: 0 });
  });
});
