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
import { getComparisonGeneration } from "../src/library/comparison-generation.js";
import { comparisonPairKey } from "../src/library/ranking-model.js";
import {
  folderIdFor,
  listAssets,
  resetAssetComparisons,
  resetLibraryData,
  setAssetTags,
  updateAssetScore,
  type AssetRecord
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";

interface PairResponse {
  left: AssetRecord;
  right: AssetRecord;
  comparisonGeneration: string;
  progress: {
    candidateCount: number;
    comparedCount: number;
    decidedPairCount: number;
  };
}

interface PrefetchResponse {
  comparisonGeneration: string;
  pairs: PairResponse[];
}

describe("comparison prefetch", () => {
  let db: AetherDatabase;
  let app: FastifyInstance;
  let folderId: string;
  let childFolderId: string;
  let assets: AssetRecord[];
  let generation: string;
  let auth: {
    cookies: Record<string, string>;
    headers: Record<string, string>;
  };

  beforeEach(async () => {
    const cwd = await mkdtemp(
      path.join(tmpdir(), "aether-comparison-prefetch-")
    );
    await mkdir(path.join(cwd, "media", "nested"), { recursive: true });
    for (const name of [
      "same-one.jpg",
      "same-two.jpg",
      "same-three.jpg",
      "other.jpg",
      "clip.mp4",
      "nested/same-child.jpg"
    ]) {
      await writeFile(path.join(cwd, "media", name), name);
    }
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_PASSWORD_HASH: await hashPassword("prefetch-password"),
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );
    db = openDatabase(config.configDir);
    await scanLibrary(db, config.mediaRoots);
    app = await buildApp({ config, db, logger: false });
    generation = getComparisonGeneration(db);
    folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    childFolderId = folderIdFor(config.mediaRoots[0]!.id, "nested");
    assets = listAssets(db, {
      folderId,
      offset: 0,
      limit: 20,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "prefetch-password" }
    });
    const cookies = Object.fromEntries(
      login.cookies.map((cookie) => [cookie.name, cookie.value])
    );
    auth = { cookies, headers: { "x-csrf-token": cookies.aether_csrf! } };
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const asset = (name: string) => assets.find((entry) => entry.name === name)!;
  const ids = (pair: PairResponse): [string, string] => [
    pair.left.id,
    pair.right.id
  ];
  const key = (pair: PairResponse) => comparisonPairKey(...ids(pair));
  const context = () => ({
    folderId,
    type: "all",
    recursive: true,
    search: "",
    tags: [],
    score: "all"
  });
  const prefetch = (
    payload: Record<string, unknown> = {},
    requestedFolderId = folderId
  ) =>
    app.inject({
      method: "POST",
      url: `/api/folders/${requestedFolderId}/comparisons/prefetch`,
      ...auth,
      payload: { ...context(), folderId: undefined, ...payload }
    });
  const choose = (payload: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/comparisons",
      ...auth,
      payload: {
        leftAssetId: asset("same-one.jpg").id,
        rightAssetId: asset("same-two.jpg").id,
        winnerAssetId: asset("same-one.jpg").id,
        mutationId: randomUUID(),
        comparisonGeneration: generation,
        pairContext: context(),
        ...payload
      }
    });
  const markFavorite = (id: string) =>
    updateAssetScore(db, {
      assetId: id,
      favorite: true,
      updatedAt: new Date().toISOString()
    });

  it("prepares at most three distinct hydrated pairs without recording decisions", async () => {
    for (const entry of assets) setAssetTags(db, entry.id, ["Ready"]);
    const response = await prefetch();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    const result = response.json<PrefetchResponse>();
    expect(result.comparisonGeneration).toBe(generation);
    expect(result.pairs).toHaveLength(3);
    expect(new Set(result.pairs.map(key)).size).toBe(3);
    for (const pair of result.pairs) {
      expect(pair.left.id).not.toBe(pair.right.id);
      expect(pair.left.tags[0]?.displayName).toBe("Ready");
      expect(pair.right.tags[0]?.displayName).toBe("Ready");
      expect(pair.comparisonGeneration).toBe(generation);
      expect(pair.progress).toEqual({
        candidateCount: 6,
        comparedCount: 0,
        decidedPairCount: 0
      });
    }
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM comparison_events").get()
    ).toEqual({ total: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM asset_rankings").get()
    ).toEqual({ total: 0 });
    expect(
      (await prefetch({ count: 1 })).json<PrefetchResponse>().pairs
    ).toHaveLength(1);
  });

  it("protects prefetch with authentication and CSRF", async () => {
    const url = `/api/folders/${folderId}/comparisons/prefetch`;
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
  });

  it("validates counts, exclusions, filters and prepared vote dependencies", async () => {
    const one = asset("same-one.jpg").id;
    const two = asset("same-two.jpg").id;
    for (const payload of [
      { count: 0 },
      { count: 4 },
      { count: 1.5 },
      { count: "2" },
      { excludePairs: Array.from({ length: 5 }, () => [one, two]) },
      { excludePairs: [[one, one]] },
      { excludePairs: [[one]] },
      { excludePairs: [["x".repeat(257), two]] },
      { type: "audio" },
      { recursive: "false" },
      { search: "x".repeat(129) },
      { tags: Array.from({ length: 21 }, () => "tag") },
      { score: "highest" }
    ])
      expect((await prefetch(payload)).statusCode).toBe(400);
    for (const payload of [
      { nextPairAssetIds: [one, one] },
      { nextPairAssetIds: [one, two], pairContext: undefined },
      { nextPairAssetIds: [one, two], mutationId: undefined },
      { nextPairAssetIds: [one, two], comparisonGeneration: undefined }
    ])
      expect((await choose(payload)).statusCode).toBe(400);
  });

  it("excludes canonical pairs and returns fewer when a small pool is exhausted", async () => {
    const selected = [
      asset("same-one.jpg"),
      asset("same-two.jpg"),
      asset("same-three.jpg")
    ];
    selected.forEach((entry) => markFavorite(entry.id));
    const [one, two, three] = selected.map((entry) => entry.id) as [
      string,
      string,
      string
    ];
    const result = (
      await prefetch({
        score: "favorites",
        excludePairs: [
          [one, two],
          [two, one]
        ]
      })
    ).json<PrefetchResponse>();
    expect(result.pairs).toHaveLength(2);
    expect(new Set(result.pairs.map(key)).size).toBe(2);
    expect(result.pairs.map(key)).not.toContain(comparisonPairKey(one, two));
    expect(
      (
        await prefetch({
          score: "favorites",
          excludePairs: [
            [one, two],
            [one, three],
            [two, three]
          ]
        })
      ).json<PrefetchResponse>().pairs
    ).toEqual([]);
  });

  it("handles two, one, empty and missing candidate pools", async () => {
    const one = asset("same-one.jpg").id;
    const two = asset("same-two.jpg").id;
    markFavorite(one);
    markFavorite(two);
    expect(
      (await prefetch({ score: "favorites" })).json<PrefetchResponse>().pairs
    ).toHaveLength(1);
    expect(
      (
        await prefetch({ score: "favorites", excludePairs: [[two, one]] })
      ).json<PrefetchResponse>().pairs
    ).toEqual([]);
    expect(
      (await prefetch({ type: "video" })).json<PrefetchResponse>().pairs
    ).toEqual([]);
    expect(
      (await prefetch({ search: "not-present" })).json<PrefetchResponse>().pairs
    ).toEqual([]);
    expect(
      (await prefetch({}, "missing-folder")).json<PrefetchResponse>().pairs
    ).toEqual([]);
    expect(
      (await prefetch({}, childFolderId)).json<PrefetchResponse>().pairs
    ).toEqual([]);
  });

  it("uses the same type, recursive, search, tags and score filters as listing", async () => {
    const selected = [
      asset("same-one.jpg"),
      asset("same-two.jpg"),
      asset("same-three.jpg")
    ];
    selected.forEach((entry, index) => {
      setAssetTags(db, entry.id, index < 2 ? ["Ready", "Chosen"] : ["Ready"]);
      updateAssetScore(db, {
        assetId: entry.id,
        score: 25,
        favorite: true,
        updatedAt: new Date().toISOString()
      });
    });
    const filtered = (
      await prefetch({
        type: "image",
        recursive: false,
        search: "same",
        tags: ["Ready", "Chosen"],
        score: "favorites"
      })
    ).json<PrefetchResponse>();
    expect(filtered.pairs).toHaveLength(1);
    expect(new Set(ids(filtered.pairs[0]!))).toEqual(
      new Set(selected.slice(0, 2).map((entry) => entry.id))
    );
    const ranked = (
      await prefetch({ score: "ranked" })
    ).json<PrefetchResponse>();
    expect(
      ranked.pairs.every((pair) => pair.left.score > 0 && pair.right.score > 0)
    ).toBe(true);
    const unranked = (
      await prefetch({ score: "unranked" })
    ).json<PrefetchResponse>();
    expect(
      unranked.pairs.every(
        (pair) => pair.left.score === 0 && pair.right.score === 0
      )
    ).toBe(true);
    const shallow = (
      await prefetch({ type: "image", recursive: false })
    ).json<PrefetchResponse>();
    expect(
      shallow.pairs.every(
        (pair) =>
          pair.left.folderId === folderId && pair.right.folderId === folderId
      )
    ).toBe(true);
  });

  it("honors a prepared pair orientation after committing and returns current progress", async () => {
    const nextPairAssetIds = [
      asset("same-three.jpg").id,
      asset("other.jpg").id
    ];
    const response = await choose({ nextPairAssetIds });
    expect(response.statusCode).toBe(200);
    expect(response.json().nextPair).toMatchObject({
      left: { id: nextPairAssetIds[0] },
      right: { id: nextPairAssetIds[1] },
      comparisonGeneration: generation,
      progress: { candidateCount: 6, comparedCount: 2, decidedPairCount: 1 }
    });
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM comparison_events").get()
    ).toEqual({ total: 1 });
  });

  it("revalidates unranked eligibility after the vote changes scores", async () => {
    const response = await choose({
      pairContext: {
        ...context(),
        type: "image",
        recursive: false,
        score: "unranked"
      },
      nextPairAssetIds: [asset("same-one.jpg").id, asset("same-three.jpg").id]
    });
    expect(response.statusCode).toBe(200);
    const pair = response.json().nextPair as PairResponse;
    expect(new Set(ids(pair))).toEqual(
      new Set([asset("same-three.jpg").id, asset("other.jpg").id])
    );
    expect(pair.progress).toEqual({
      candidateCount: 2,
      comparedCount: 0,
      decidedPairCount: 0
    });
  });

  it("refreshes prepared asset records when the chosen pair shares an updated asset", async () => {
    const response = await choose({
      nextPairAssetIds: [asset("same-one.jpg").id, asset("other.jpg").id]
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().nextPair.left.id).toBe(asset("same-one.jpg").id);
    expect(response.json().nextPair.left.score).toBeGreaterThan(0);
    expect(response.json().nextPair.left.ranking.comparisonCount).toBe(1);
    expect(response.json().nextPair.left).toEqual(response.json().assets[0]);
  });

  it("avoids immediately repeating the chosen pair unless it is the only eligible pair", async () => {
    const nextPairAssetIds = [
      asset("same-one.jpg").id,
      asset("same-two.jpg").id
    ];
    const response = await choose({ nextPairAssetIds });
    expect(key(response.json().nextPair as PairResponse)).not.toBe(
      comparisonPairKey(...(nextPairAssetIds as [string, string]))
    );
    nextPairAssetIds.forEach(markFavorite);
    const tiny = await choose({
      nextPairAssetIds,
      pairContext: { ...context(), score: "favorites" }
    });
    expect(ids(tiny.json().nextPair as PairResponse)).toEqual(nextPairAssetIds);
  });

  it("keeps the committed vote when its unranked context has no next pair", async () => {
    const selected = [asset("same-one.jpg"), asset("same-two.jpg")];
    selected.forEach((entry) => setAssetTags(db, entry.id, ["Only"]));
    const response = await choose({
      pairContext: { ...context(), score: "unranked", tags: ["Only"] },
      nextPairAssetIds: selected.map((entry) => entry.id)
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().nextPair).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM pair_preferences").get()
    ).toEqual({ total: 1 });
  });

  it("revalidates a deleted prepared asset and falls back to a valid pair", async () => {
    const removed = asset("same-three.jpg").id;
    db.prepare("DELETE FROM assets WHERE id = ?").run(removed);
    const response = await choose({
      nextPairAssetIds: [removed, asset("other.jpg").id]
    });
    expect(response.statusCode).toBe(200);
    expect(ids(response.json().nextPair as PairResponse)).not.toContain(
      removed
    );
    expect(response.json().nextPair.progress.candidateCount).toBe(5);
  });

  it("drops prepared pairs that no longer match favorites, tags, type, search or scope", async () => {
    const eligible = [asset("same-three.jpg"), asset("other.jpg")];
    eligible.forEach((entry) => {
      markFavorite(entry.id);
      setAssetTags(db, entry.id, ["Chosen"]);
    });
    const cases = [
      {
        pairContext: { ...context(), score: "favorites" },
        nextPairAssetIds: [asset("same-one.jpg").id, eligible[0]!.id]
      },
      {
        pairContext: { ...context(), tags: ["Chosen"] },
        nextPairAssetIds: [asset("same-one.jpg").id, eligible[0]!.id]
      },
      {
        pairContext: { ...context(), type: "image" },
        nextPairAssetIds: [asset("clip.mp4").id, eligible[0]!.id]
      },
      {
        pairContext: { ...context(), search: "same" },
        nextPairAssetIds: [asset("other.jpg").id, eligible[0]!.id]
      },
      {
        pairContext: { ...context(), recursive: false },
        nextPairAssetIds: [asset("same-child.jpg").id, eligible[0]!.id]
      }
    ];
    for (const request of cases) {
      const response = await choose(request);
      expect(response.statusCode).toBe(200);
      const returned = response.json().nextPair as PairResponse;
      expect(ids(returned)).not.toEqual(request.nextPairAssetIds);
      expect(returned).not.toBeNull();
    }
  });

  it("preserves keyed vote and Undo idempotency while recomputing the next pair", async () => {
    const mutationId = randomUUID();
    const nextPairAssetIds = [
      asset("same-three.jpg").id,
      asset("other.jpg").id
    ];
    const first = await choose({ mutationId, nextPairAssetIds });
    const retry = await choose({
      mutationId,
      nextPairAssetIds: ["missing", asset("other.jpg").id]
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().eventId).toBe(first.json().eventId);
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM comparison_events").get()
    ).toEqual({ total: 1 });
    const undo = await app.inject({
      method: "POST",
      url: `/api/comparisons/${first.json().eventId}/undo`,
      ...auth,
      payload: { mutationId: randomUUID(), comparisonGeneration: generation }
    });
    expect(undo.statusCode).toBe(200);
    expect((await choose({ mutationId, nextPairAssetIds })).statusCode).toBe(
      200
    );
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM pair_preferences").get()
    ).toEqual({ total: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM comparison_events").get()
    ).toEqual({ total: 2 });
  });

  it("rejects old prepared operations after full or per-asset reset", async () => {
    for (const reset of [
      () =>
        resetLibraryData(
          db,
          { comparisons: true, scores: false, favorites: false, tags: false },
          new Date().toISOString()
        ),
      () =>
        resetAssetComparisons(
          db,
          asset("other.jpg").id,
          new Date().toISOString()
        )
    ]) {
      const queued = (await prefetch()).json<PrefetchResponse>();
      generation = queued.comparisonGeneration;
      reset();
      const response = await choose({
        nextPairAssetIds: ids(queued.pairs[0]!)
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("comparison_session_reset");
      expect(
        (await prefetch()).json<PrefetchResponse>().comparisonGeneration
      ).not.toBe(generation);
      expect(
        db.prepare("SELECT COUNT(*) AS total FROM pair_preferences").get()
      ).toEqual({ total: 0 });
    }
  });

  it("does not record a vote when its own assets were removed", async () => {
    db.prepare("DELETE FROM assets WHERE id = ?").run(asset("same-one.jpg").id);
    expect(
      (
        await choose({
          nextPairAssetIds: [asset("same-three.jpg").id, asset("other.jpg").id]
        })
      ).statusCode
    ).toBe(404);
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM comparison_events").get()
    ).toEqual({ total: 0 });
  });
});
