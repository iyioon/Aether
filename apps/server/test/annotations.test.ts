import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { folderIdFor, listAssets } from "../src/library/repository.js";
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

  it("updates ratings and favorites behind CSRF protection", async () => {
    const asset = await createIndexedAsset("photo.jpg");
    const auth = await login();

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/assets/${asset.id}/rating`,
      cookies: auth.cookies,
      payload: {
        rating: 4
      }
    });

    expect(forbidden.statusCode).toBe(403);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/assets/${asset.id}/rating`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        rating: 10,
        favorite: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().asset).toMatchObject({
      id: asset.id,
      rating: 10,
      favorite: true
    });

    const updated = firstAsset();
    expect(updated.rating).toBe(10);
    expect(updated.favorite).toBe(true);
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
    expect(tags.json().tags.map((tag: { displayName: string }) => tag.displayName))
      .toEqual(["Family", "Vacation"]);

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
    await writeFile(path.join(cwd, "media", "Trips", "beach-walk.png"), "first");
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
    expect(body.suggestions.every((suggestion) => suggestion.source === "local-metadata"))
      .toBe(true);
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

  it("filters listed assets by search, tag, and rating state", async () => {
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
    const familyPhoto = indexed?.find((asset) => asset.name === "family-photo.jpg");
    const skyline = indexed?.find((asset) => asset.name === "skyline.png");
    const auth = await login();

    if (!familyPhoto || !skyline) {
      throw new Error("Expected indexed test assets.");
    }

    await app.inject({
      method: "PATCH",
      url: `/api/assets/${familyPhoto.id}/rating`,
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        rating: 5,
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
        tags: ["Family"]
      }
    });

    const search = await listedAssetIds(folderId, auth.cookies, "search=family");
    expect(search).toEqual([familyPhoto.id]);

    const tag = await listedAssetIds(folderId, auth.cookies, "tag=family");
    expect(tag).toEqual([familyPhoto.id]);

    const favorites = await listedAssetIds(
      folderId,
      auth.cookies,
      "rating=favorites"
    );
    expect(favorites).toEqual([familyPhoto.id]);

    const unrated = await listedAssetIds(folderId, auth.cookies, "rating=unrated");
    expect(unrated).toEqual([skyline.id]);
  });

  it("batch updates ratings and tags transactionally", async () => {
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

    const forbiddenRating = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/ratings",
      cookies: auth.cookies,
      payload: {
        assetIds,
        rating: 4
      }
    });

    expect(forbiddenRating.statusCode).toBe(403);

    const ratings = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/ratings",
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        assetIds,
        rating: 8,
        favorite: true
      }
    });

    expect(ratings.statusCode).toBe(200);
    expect(ratings.json()).toMatchObject({
      updated: 2,
      assets: [
        { id: assetIds[0], rating: 8, favorite: true },
        { id: assetIds[1], rating: 8, favorite: true }
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

  it("rejects a batch when any selected asset is missing", async () => {
    const asset = await createIndexedAsset("photo.jpg");
    const auth = await login();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/assets/batch/ratings",
      cookies: auth.cookies,
      headers: {
        "x-csrf-token": auth.csrfToken
      },
      payload: {
        assetIds: [asset.id, "asset_missing"],
        rating: 5
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "asset_not_indexed" });
    expect(firstAsset().rating).toBeNull();
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
