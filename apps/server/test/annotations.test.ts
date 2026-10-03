import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import {
  folderIdFor,
  getAsset,
  listAssets,
  recordComparisonDecision,
  updateAssetScore
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";

describe("annotations", () => {
  let cwd: string;
  let config: AppConfig;
  let db: AetherDatabase;
  let app: FastifyInstance;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "aether-annotations-"));
    await mkdir(path.join(cwd, "media"));

    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
        AETHER_PASSWORD_HASH: await hashPassword("annotation-password"),
        AETHER_SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      cwd
    );
    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("updates scores and favorites behind CSRF protection", async () => {
    const asset = await createIndexedAsset("photo.jpg");
    const auth = await login();

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/assets/${asset.id}/score`,
      cookies: auth.cookies,
      payload: {
        score: 4
      }
    });

    expect(forbidden.statusCode).toBe(403);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/assets/${asset.id}/score`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        score: 10,
        favorite: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().asset).toMatchObject({
      id: asset.id,
      score: 10,
      favorite: true
    });

    const updated = firstAsset();
    expect(updated.score).toBe(10);
    expect(updated.favorite).toBe(true);
  });

  it("stores unbounded non-negative media scores", async () => {
    const asset = await createIndexedAsset("scored-photo.jpg");
    const auth = await login();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/assets/${asset.id}/score`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        score: 125
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().asset.score).toBe(125);

    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/assets/${asset.id}/score`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        score: -1
      }
    });

    expect(invalid.statusCode).toBe(400);
  });

  it("atomically stores a manual score and its ranking adjustment", async () => {
    await Promise.all([
      writeFile(path.join(cwd, "media", "atomic-one.jpg"), "one"),
      writeFile(path.join(cwd, "media", "atomic-two.jpg"), "two")
    ]);
    await scanLibrary(db, config.mediaRoots);
    const indexed = listAssets(db, {
      folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })?.items;
    const first = indexed?.find((asset) => asset.name === "atomic-one.jpg");
    const second = indexed?.find((asset) => asset.name === "atomic-two.jpg");

    if (!first || !second) {
      throw new Error("Expected indexed atomic score fixtures.");
    }

    recordComparisonDecision(db, {
      leftAssetId: first.id,
      rightAssetId: second.id,
      winnerAssetId: first.id,
      createdAt: new Date().toISOString()
    });
    db.exec(`
      CREATE TRIGGER reject_manual_adjustment_update
      BEFORE UPDATE OF manual_adjustment ON asset_rankings
      BEGIN
        SELECT RAISE(ABORT, 'manual adjustment rejected');
      END;
    `);

    expect(() =>
      updateAssetScore(db, {
        assetId: first.id,
        score: 200,
        updatedAt: new Date().toISOString()
      })
    ).toThrow(/manual adjustment rejected/);
    expect(
      db
        .prepare(
          "SELECT manual_score FROM asset_annotations WHERE asset_id = ?"
        )
        .get(first.id)
    ).toBeUndefined();
    expect(getAsset(db, first.id)?.ranking?.manualAdjustment).toBe(0);
  });

  it("sets tags, deduplicates normalized names, and suggests by prefix", async () => {
    const asset = await createIndexedAsset("photo.jpg");
    const auth = await login();

    const response = await app.inject({
      method: "PUT",
      url: `/api/assets/${asset.id}/tags`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        tags: [" Family ", "family", "Vacation"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tags).toMatchObject([
      { displayName: "Family", usageCount: 1 },
      { displayName: "Vacation", usageCount: 1 }
    ]);

    const tags = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/tags`,
      cookies: auth.cookies
    });

    expect(tags.statusCode).toBe(200);
    expect(
      tags.json().tags.map((tag: { displayName: string }) => tag.displayName)
    ).toEqual(["Family", "Vacation"]);

    expect(firstAsset().tags.map((tag) => tag.displayName)).toEqual([
      "Family",
      "Vacation"
    ]);

    const suggestions = await app.inject({
      method: "GET",
      url: "/api/tags/suggest?q=fa",
      cookies: auth.cookies
    });

    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.json().tags).toMatchObject([
      { displayName: "Family", usageCount: 1 }
    ]);
  });

  it("rejects oversized tags", async () => {
    const asset = await createIndexedAsset("photo.jpg");
    const auth = await login();

    const response = await app.inject({
      method: "PUT",
      url: `/api/assets/${asset.id}/tags`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        tags: ["x".repeat(49)]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_tag" });
  });

  it("suggests reviewable tags from local metadata", async () => {
    await mkdir(path.join(cwd, "media", "Trips"), { recursive: true });
    await writeFile(
      path.join(cwd, "media", "Trips", "beach-walk.png"),
      "first"
    );
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const indexed = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })?.items;
    const asset = indexed?.find((entry) => entry.name === "beach-walk.png");
    const auth = await login();

    if (!asset) {
      throw new Error("Expected indexed nested asset.");
    }

    const tagResponse = await app.inject({
      method: "PUT",
      url: `/api/assets/${asset.id}/tags`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        tags: ["Beach"]
      }
    });

    expect(tagResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}/tag-suggestions?limit=6`,
      cookies: auth.cookies
    });
    const body = response.json() as {
      suggestions: Array<{
        displayName: string;
        source: string;
      }>;
    };
    const names = body.suggestions.map((suggestion) => suggestion.displayName);

    expect(response.statusCode).toBe(200);
    expect(names).toContain("Trips");
    expect(names).toContain("Walk");
    expect(names).not.toContain("Beach");
    expect(
      body.suggestions.every(
        (suggestion) => suggestion.source === "local-metadata"
      )
    ).toBe(true);
  });

  it("keeps AI tag suggestions disabled by default and CSRF protected", async () => {
    const asset = await createIndexedAsset("photo.jpg");
    const auth = await login();

    const status = await app.inject({
      method: "GET",
      url: "/api/admin/ai",
      cookies: auth.cookies
    });
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/assets/${asset.id}/ai-tag-suggestions?limit=6`,
      cookies: auth.cookies
    });
    const disabled = await app.inject({
      method: "POST",
      url: `/api/assets/${asset.id}/ai-tag-suggestions?limit=6`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      }
    });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      enabled: false,
      provider: "disabled",
      model: null
    });
    expect(forbidden.statusCode).toBe(403);
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json()).toEqual({ error: "ai_disabled" });
  });

  it("filters listed assets by search, tag, and score state", async () => {
    await writeFile(path.join(cwd, "media", "family-photo.jpg"), "first");
    await writeFile(path.join(cwd, "media", "skyline.png"), "second");
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const indexed = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })?.items;
    const familyPhoto = indexed?.find(
      (asset) => asset.name === "family-photo.jpg"
    );
    const skyline = indexed?.find((asset) => asset.name === "skyline.png");
    const auth = await login();

    if (!familyPhoto || !skyline) {
      throw new Error("Expected indexed test assets.");
    }

    await app.inject({
      method: "PATCH",
      url: `/api/assets/${familyPhoto.id}/score`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        score: 5,
        favorite: true
      }
    });
    await app.inject({
      method: "PUT",
      url: `/api/assets/${familyPhoto.id}/tags`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        tags: ["Family", "Travel"]
      }
    });
    await app.inject({
      method: "PUT",
      url: `/api/assets/${skyline.id}/tags`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        tags: ["Travel"]
      }
    });

    const search = await listedAssetIds(
      folderId,
      auth.cookies,
      "search=family"
    );
    expect(search).toEqual([familyPhoto.id]);

    const tag = await listedAssetIds(folderId, auth.cookies, "tag=family");
    expect(tag).toEqual([familyPhoto.id]);

    const multipleTags = await listedAssetIds(
      folderId,
      auth.cookies,
      "tag=family&tag=travel"
    );
    expect(multipleTags).toEqual([familyPhoto.id]);

    const favorites = await listedAssetIds(
      folderId,
      auth.cookies,
      "score=favorites"
    );
    expect(favorites).toEqual([familyPhoto.id]);

    const unranked = await listedAssetIds(
      folderId,
      auth.cookies,
      "score=unranked"
    );
    expect(unranked).toEqual([skyline.id]);
  });

  it("batch updates scores and tags transactionally", async () => {
    await writeFile(path.join(cwd, "media", "family-photo.jpg"), "first");
    await writeFile(path.join(cwd, "media", "skyline.png"), "second");
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const indexed = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })?.items;
    const assetIds = indexed?.map((asset) => asset.id) ?? [];
    const auth = await login();

    expect(assetIds).toHaveLength(2);

    const forbiddenScore = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/scores",
      cookies: auth.cookies,
      payload: {
        assetIds,
        score: 4
      }
    });

    expect(forbiddenScore.statusCode).toBe(403);

    const scores = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/scores",
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        assetIds,
        score: 8,
        favorite: true
      }
    });

    expect(scores.statusCode).toBe(200);
    expect(scores.json()).toMatchObject({
      updated: 2,
      assets: [
        { id: assetIds[0], score: 8, favorite: true },
        { id: assetIds[1], score: 8, favorite: true }
      ]
    });

    const favoriteOnly = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/scores",
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        assetIds: [...assetIds].reverse(),
        favorite: false
      }
    });

    expect(favoriteOnly.statusCode).toBe(200);
    expect(favoriteOnly.json()).toMatchObject({
      updated: 2,
      assets: [
        { id: assetIds[1], score: 8, favorite: false },
        { id: assetIds[0], score: 8, favorite: false }
      ]
    });

    const tags = await app.inject({
      method: "POST",
      url: "/api/assets/batch/tags",
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        assetIds,
        mode: "add",
        tags: [" Travel ", "travel"]
      }
    });

    expect(tags.statusCode).toBe(200);
    expect(tags.json()).toMatchObject({
      updated: 2,
      tags: [{ displayName: "Travel", usageCount: 2 }]
    });

    for (const assetId of assetIds) {
      const assetTags = await app.inject({
        method: "GET",
        url: `/api/assets/${assetId}/tags`,
        cookies: auth.cookies
      });

      expect(assetTags.statusCode).toBe(200);
      expect(assetTags.json().tags).toMatchObject([
        { displayName: "Travel", usageCount: 2 }
      ]);
    }
  });

  it("keeps score pagination stable when every visible tie-breaker matches", async () => {
    await Promise.all(
      ["tie-one.jpg", "tie-two.jpg", "tie-three.jpg"].map((name) =>
        writeFile(path.join(cwd, "media", name), name)
      )
    );
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const indexed = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items;
    const updatedAt = new Date().toISOString();

    for (const asset of indexed) {
      updateAssetScore(db, { assetId: asset.id, score: 25, updatedAt });
    }
    db.prepare("UPDATE assets SET mtime_ms = ?").run(1_000);

    const pagedIds = indexed.map((_, offset) => {
      const page = listAssets(db, {
        folderId,
        offset,
        limit: 1,
        sort: "score",
        sortDirection: "desc",
        type: "all",
        recursive: true
      });

      return page!.items[0]!.id;
    });

    expect(pagedIds).toEqual(indexed.map((asset) => asset.id).sort());
  });

  it("rejects a batch when any selected asset is missing", async () => {
    const asset = await createIndexedAsset("photo.jpg");
    const auth = await login();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/scores",
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        assetIds: [asset.id, "asset_missing"],
        score: 5
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "asset_not_indexed" });
    expect(firstAsset().score).toBe(0);
  });

  it("records reversible pair decisions and projects them into media scores", async () => {
    await writeFile(path.join(cwd, "media", "first.jpg"), "first");
    await writeFile(path.join(cwd, "media", "second.jpg"), "second");
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const auth = await login();
    const pairResponse = await app.inject({
      method: "GET",
      url: `/api/folders/${folderId}/comparisons/next`,
      cookies: auth.cookies
    });

    expect(pairResponse.statusCode).toBe(200);
    const pair = pairResponse.json() as {
      left: { id: string };
      right: { id: string };
      progress: {
        candidateCount: number;
        comparedCount: number;
        decidedPairCount: number;
      };
    };
    expect(pair.progress).toEqual({
      candidateCount: 2,
      comparedCount: 0,
      decidedPairCount: 0
    });

    const firstDecision = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        leftAssetId: pair.left.id,
        rightAssetId: pair.right.id,
        winnerAssetId: pair.left.id
      }
    });

    expect(firstDecision.statusCode).toBe(200);
    expect(firstDecision.json().replacedDecision).toBe(false);
    expect(firstDecision.json()).not.toHaveProperty("nextPair");
    const firstAssets = firstDecision.json().assets as Array<{
      id: string;
      score: number;
      ranking: { comparisonCount: number };
    }>;
    expect(
      firstAssets.find((asset) => asset.id === pair.left.id)!.score
    ).toBeGreaterThan(
      firstAssets.find((asset) => asset.id === pair.right.id)!.score
    );
    expect(
      firstAssets.every((asset) => asset.ranking.comparisonCount === 1)
    ).toBe(true);

    const changedDecision = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        leftAssetId: pair.left.id,
        rightAssetId: pair.right.id,
        winnerAssetId: pair.right.id
      }
    });

    expect(changedDecision.statusCode).toBe(200);
    expect(changedDecision.json().replacedDecision).toBe(true);
    const changedAssets = changedDecision.json().assets as Array<{
      id: string;
      score: number;
    }>;
    expect(
      changedAssets.find((asset) => asset.id === pair.right.id)!.score
    ).toBeGreaterThan(
      changedAssets.find((asset) => asset.id === pair.left.id)!.score
    );

    const undo = await app.inject({
      method: "POST",
      url: `/api/comparisons/${changedDecision.json().eventId}/undo`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken }
    });

    expect(undo.statusCode).toBe(200);
    expect(undo.json().restoredDecision).toBe(true);
    const restoredAssets = undo.json().assets as Array<{
      id: string;
      score: number;
    }>;
    expect(
      restoredAssets.find((asset) => asset.id === pair.left.id)!.score
    ).toBeGreaterThan(
      restoredAssets.find((asset) => asset.id === pair.right.id)!.score
    );
    expect(
      (
        db.prepare("SELECT COUNT(*) AS total FROM comparison_events").get() as {
          total: number;
        }
      ).total
    ).toBe(3);
  });

  it("returns the next filtered pair with a recorded decision", async () => {
    for (const name of [
      "pipeline-one.jpg",
      "pipeline-two.jpg",
      "pipeline-three.jpg",
      "unrelated.jpg"
    ]) {
      await writeFile(path.join(cwd, "media", name), name);
    }
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const auth = await login();
    const pairResponse = await app.inject({
      method: "GET",
      url: `/api/folders/${folderId}/comparisons/next?search=pipeline`,
      cookies: auth.cookies
    });
    const pair = pairResponse.json() as {
      left: { id: string };
      right: { id: string };
    };

    const decision = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        leftAssetId: pair.left.id,
        rightAssetId: pair.right.id,
        winnerAssetId: pair.left.id,
        pairContext: {
          folderId,
          type: "image",
          recursive: true,
          search: "pipeline",
          tags: [],
          score: "all"
        }
      }
    });

    expect(decision.statusCode).toBe(200);
    const nextPair = decision.json().nextPair as {
      left: { id: string; name: string };
      right: { id: string; name: string };
      progress: {
        candidateCount: number;
        comparedCount: number;
        decidedPairCount: number;
      };
    };
    expect(nextPair.progress).toEqual({
      candidateCount: 3,
      comparedCount: 2,
      decidedPairCount: 1
    });
    expect([nextPair.left.name, nextPair.right.name]).toEqual([
      expect.stringContaining("pipeline"),
      expect.stringContaining("pipeline")
    ]);
    expect(
      [nextPair.left.id, nextPair.right.id].sort().join("\u0000")
    ).not.toBe([pair.left.id, pair.right.id].sort().join("\u0000"));
  });

  it("keeps a saved decision successful when next-pair preparation fails", async () => {
    for (const name of [
      "fallback-one.jpg",
      "fallback-two.jpg",
      "fallback-three.jpg"
    ]) {
      await writeFile(path.join(cwd, "media", name), name);
    }
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const assets = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items;
    const auth = await login();
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("forced next-pair failure");
    });

    let decision;
    try {
      decision = await app.inject({
        method: "POST",
        url: "/api/comparisons",
        cookies: auth.cookies,
        headers: { "x-csrf-token": auth.csrfToken },
        payload: {
          leftAssetId: assets[0]!.id,
          rightAssetId: assets[1]!.id,
          winnerAssetId: assets[0]!.id,
          pairContext: {
            folderId,
            type: "all",
            recursive: true,
            search: "",
            tags: [],
            score: "all"
          }
        }
      });
    } finally {
      random.mockRestore();
    }

    expect(decision.statusCode).toBe(200);
    expect(decision.json()).not.toHaveProperty("nextPair");
    expect(
      (
        db.prepare("SELECT COUNT(*) AS total FROM pair_preferences").get() as {
          total: number;
        }
      ).total
    ).toBe(1);
  });

  it("preserves manual scores when ranking begins and when its last choice is undone", async () => {
    await writeFile(path.join(cwd, "media", "manual.jpg"), "manual");
    await writeFile(path.join(cwd, "media", "other.jpg"), "other");
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const indexed = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })?.items;
    const manualAsset = indexed?.find((asset) => asset.name === "manual.jpg");
    const otherAsset = indexed?.find((asset) => asset.name === "other.jpg");
    const auth = await login();

    if (!manualAsset || !otherAsset) {
      throw new Error("Expected indexed comparison assets.");
    }

    await app.inject({
      method: "PATCH",
      url: `/api/assets/${manualAsset.id}/score`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: { score: 125 }
    });

    const decision = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        leftAssetId: manualAsset.id,
        rightAssetId: otherAsset.id,
        winnerAssetId: otherAsset.id
      }
    });

    expect(decision.statusCode).toBe(200);
    expect(
      decision
        .json()
        .assets.find((asset: { id: string }) => asset.id === manualAsset.id)
    ).toMatchObject({ score: 125, ranking: { comparisonCount: 1 } });

    const adjusted = await app.inject({
      method: "PATCH",
      url: `/api/assets/${manualAsset.id}/score`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: { score: 200 }
    });
    expect(adjusted.json().asset.score).toBe(200);

    const undo = await app.inject({
      method: "POST",
      url: `/api/comparisons/${decision.json().eventId}/undo`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken }
    });

    expect(undo.statusCode).toBe(200);
    expect(
      undo
        .json()
        .assets.find((asset: { id: string }) => asset.id === manualAsset.id)
    ).toMatchObject({ score: 200, ranking: null });
  });

  it("removes manual adjustments and resets an item's active comparisons", async () => {
    await writeFile(path.join(cwd, "media", "reset-one.jpg"), "one");
    await writeFile(path.join(cwd, "media", "reset-two.jpg"), "two");
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const indexed = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })?.items;
    const first = indexed?.find((asset) => asset.name === "reset-one.jpg");
    const second = indexed?.find((asset) => asset.name === "reset-two.jpg");
    const auth = await login();

    if (!first || !second) {
      throw new Error("Expected indexed reset fixtures.");
    }

    const decision = await app.inject({
      method: "POST",
      url: "/api/comparisons",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        leftAssetId: first.id,
        rightAssetId: second.id,
        winnerAssetId: first.id
      }
    });
    expect(decision.statusCode).toBe(200);

    const adjusted = await app.inject({
      method: "PATCH",
      url: `/api/assets/${first.id}/score`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: { score: 200 }
    });
    expect(adjusted.json().asset).toMatchObject({
      score: 200,
      ranking: { comparisonCount: 1 }
    });

    const cleared = await app.inject({
      method: "DELETE",
      url: `/api/assets/${first.id}/score/manual-adjustment`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken }
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().asset.score).toBe(
      cleared.json().asset.ranking.comparisonScore
    );
    expect(cleared.json().asset.ranking.manualAdjustment).toBe(0);

    await app.inject({
      method: "PATCH",
      url: `/api/assets/${first.id}/score`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: { score: 150 }
    });

    const reset = await app.inject({
      method: "DELETE",
      url: `/api/assets/${first.id}/comparisons`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      asset: { score: 150, ranking: null },
      removedComparisons: 1
    });
    expect(getAsset(db, second.id)).toMatchObject({
      score: 0,
      ranking: null
    });
  });

  it("selectively resets library data without removing indexed assets", async () => {
    await writeFile(path.join(cwd, "media", "reset-data-one.jpg"), "one");
    await writeFile(path.join(cwd, "media", "reset-data-two.jpg"), "two");
    await scanLibrary(db, config.mediaRoots);
    const folderId = folderIdFor(config.mediaRoots[0]!.id, "");
    const assets = listAssets(db, {
      folderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })?.items;
    const first = assets?.find((asset) => asset.name === "reset-data-one.jpg");
    const second = assets?.find((asset) => asset.name === "reset-data-two.jpg");
    const auth = await login();

    if (!first || !second) {
      throw new Error("Expected indexed data reset fixtures.");
    }

    await app.inject({
      method: "PATCH",
      url: `/api/assets/${first.id}/score`,
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: { score: 20, favorite: true }
    });
    for (const asset of [first, second]) {
      await app.inject({
        method: "PUT",
        url: `/api/assets/${asset.id}/tags`,
        cookies: auth.cookies,
        headers: { "x-csrf-token": auth.csrfToken },
        payload: { tags: ["Reset test"] }
      });
    }
    await app.inject({
      method: "POST",
      url: "/api/comparisons",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        leftAssetId: first.id,
        rightAssetId: second.id,
        winnerAssetId: first.id
      }
    });

    const annotationsReset = await app.inject({
      method: "POST",
      url: "/api/admin/database/reset",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        confirmation: "RESET",
        scores: false,
        favorites: true,
        tags: true,
        comparisons: false
      }
    });

    expect(annotationsReset.statusCode).toBe(200);
    expect(annotationsReset.json()).toMatchObject({
      scoresReset: 0,
      favoritesReset: 1,
      tagsRemoved: 1,
      tagAssignmentsRemoved: 2,
      comparisonPreferencesRemoved: 0,
      comparisonEventsRemoved: 0
    });
    expect(getAsset(db, first.id)).toMatchObject({
      score: 20,
      favorite: false,
      tags: [],
      ranking: { comparisonCount: 1 }
    });

    const rankingReset = await app.inject({
      method: "POST",
      url: "/api/admin/database/reset",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        confirmation: "RESET",
        scores: true,
        favorites: false,
        tags: false,
        comparisons: true
      }
    });

    expect(rankingReset.statusCode).toBe(200);
    expect(rankingReset.json()).toMatchObject({
      scoresReset: 1,
      comparisonPreferencesRemoved: 1,
      comparisonEventsRemoved: 1
    });
    expect(getAsset(db, first.id)).toMatchObject({ score: 0, ranking: null });
    expect(getAsset(db, second.id)).toMatchObject({ score: 0, ranking: null });
    expect(
      (
        db.prepare("SELECT COUNT(*) AS total FROM assets").get() as {
          total: number;
        }
      ).total
    ).toBe(2);

    const emptyReset = await app.inject({
      method: "POST",
      url: "/api/admin/database/reset",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        confirmation: "RESET",
        scores: false,
        favorites: false,
        tags: false,
        comparisons: false
      }
    });
    expect(emptyReset.statusCode).toBe(400);

    const unconfirmedReset = await app.inject({
      method: "POST",
      url: "/api/admin/database/reset",
      cookies: auth.cookies,
      headers: { "x-csrf-token": auth.csrfToken },
      payload: {
        confirmation: "reset",
        scores: true,
        favorites: false,
        tags: false,
        comparisons: false
      }
    });
    expect(unconfirmedReset.statusCode).toBe(400);
  });

  async function createIndexedAsset(name: string) {
    await writeFile(path.join(cwd, "media", name), "media-bytes");
    await scanLibrary(db, config.mediaRoots);
    return firstAsset();
  }

  function firstAsset() {
    const root = config.mediaRoots[0]!;
    const result = listAssets(db, {
      folderId: folderIdFor(root.id, ""),
      offset: 0,
      limit: 1,
      sort: "filename",
      type: "all",
      recursive: true
    });
    const asset = result?.items[0];

    if (!asset) {
      throw new Error("Expected scanner fixture asset.");
    }

    return asset;
  }

  async function login(): Promise<{
    cookies: Record<string, string>;
    csrfToken: string;
  }> {
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        password: "annotation-password"
      }
    });

    const sessionCookie = loginResponse.cookies.find(
      (entry) => entry.name === "aether_session"
    );
    const csrfCookie = loginResponse.cookies.find(
      (entry) => entry.name === "aether_csrf"
    );

    if (!sessionCookie || !csrfCookie) {
      throw new Error("Expected auth cookies.");
    }

    return {
      cookies: {
        aether_session: sessionCookie.value
      },
      csrfToken: csrfCookie.value
    };
  }

  async function listedAssetIds(
    folderId: string,
    cookies: Record<string, string>,
    query: string
  ): Promise<string[]> {
    const response = await app.inject({
      method: "GET",
      url: `/api/folders/${folderId}/assets?sort=filename&${query}`,
      cookies
    });

    expect(response.statusCode).toBe(200);
    return response.json().items.map((asset: { id: string }) => asset.id);
  }
});
