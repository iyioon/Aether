import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import {
  folderIdFor,
  setAssetTags,
  updateAssetScore,
  upsertAsset,
  upsertFolder,
  type AssetRecord
} from "../src/library/repository.js";
import {
  commitAssetLocation,
  commitFolderLocation,
  getLibraryRevision,
  getManagedAsset,
  getManagedFolder
} from "../src/library/repository-management.js";

interface AssetDetailsResponse {
  assets: AssetRecord[];
  revision: string;
  matchingAssetIds?: string[];
}

describe("asset detail query membership", () => {
  let cwd: string;
  let app: FastifyInstance;
  let db: AetherDatabase;
  let headers: Record<string, string>;
  let rootId: string;
  let rootFolderId: string;
  let selectedFolderId: string;
  let nestedFolderId: string;
  const requestedIds = [
    "video",
    "root",
    "cjk",
    "nested",
    "direct",
    "sibling",
    "trashed",
    "missing"
  ];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "aether-asset-details-"));
    await mkdir(path.join(cwd, "media"));
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "Library=./media",
        AETHER_DATA_DIR: "./data",
        AETHER_PASSWORD_HASH: await hashPassword("asset-details-password"),
        AETHER_SESSION_SECRET: "asset-details-session-secret-is-long-enough",
        NODE_ENV: "test"
      },
      cwd
    );
    db = openDatabase(config.configDir);
    app = await buildApp({ config, db, logger: false });
    rootId = config.mediaRoots[0]!.id;
    rootFolderId = folderIdFor(rootId, "");
    const now = new Date().toISOString();
    selectedFolderId = upsertFolder(db, {
      rootId,
      parentId: rootFolderId,
      relativePath: "Trip_100%",
      name: "Trip_100%",
      seenAt: now
    });
    nestedFolderId = upsertFolder(db, {
      rootId,
      parentId: selectedFolderId,
      relativePath: "Trip_100%/Night",
      name: "Night",
      seenAt: now
    });
    const siblingFolderId = upsertFolder(db, {
      rootId,
      parentId: rootFolderId,
      relativePath: "TripX1000",
      name: "TripX1000",
      seenAt: now
    });
    for (const [id, folderId, relativePath, mediaType] of [
      ["root", rootFolderId, "sunset.jpg", "image"],
      ["direct", selectedFolderId, "Trip_100%/sunset.jpg", "image"],
      ["nested", nestedFolderId, "Trip_100%/Night/sunset.jpg", "image"],
      ["cjk", nestedFolderId, "Trip_100%/Night/東京の夜.jpg", "image"],
      ["video", selectedFolderId, "Trip_100%/sunset.mp4", "video"],
      ["sibling", siblingFolderId, "TripX1000/sunset.jpg", "image"],
      ["trashed", selectedFolderId, "Trip_100%/trashed.jpg", "image"]
    ] as const) {
      upsertAsset(db, {
        id,
        rootId,
        folderId,
        relativePath,
        name: path.posix.basename(relativePath),
        extension: path.posix.extname(relativePath),
        mediaType,
        mimeType: mediaType === "video" ? "video/mp4" : "image/jpeg",
        sizeBytes: 4,
        mtimeMs: 1000,
        fingerprint: `fixture-${id}`,
        contentSha256: "a".repeat(64),
        fsDeviceId: null,
        fsInode: null,
        fsBirthtimeNs: null,
        fsCtimeNs: null,
        seenAt: now
      });
    }
    for (const id of ["direct", "video"]) {
      updateAssetScore(db, {
        assetId: id,
        score: 3,
        favorite: true,
        updatedAt: now
      });
      setAssetTags(db, id, ["Night", "Travel"]);
    }
    setAssetTags(db, "nested", ["Night"]);
    db.prepare("UPDATE assets SET lifecycle = 'trashed' WHERE id = ?").run(
      "trashed"
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "asset-details-password" }
    });
    headers = {
      cookie: login.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
      "x-csrf-token": login.cookies.find(
        (cookie) => cookie.name === "aether_csrf"
      )!.value
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    db?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it("preserves unfiltered hydration, requested order and private-location boundaries", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/assets/batch/details",
      headers,
      payload: { assetIds: requestedIds }
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<AssetDetailsResponse>();
    expect(result.assets.map((asset) => asset.id)).toEqual(
      requestedIds.filter((id) => id !== "trashed" && id !== "missing")
    );
    expect(result).not.toHaveProperty("matchingAssetIds");
    expect(result.revision).toBe(getLibraryRevision(db));
    expect(response.body).not.toContain(cwd);
    expect(response.body).not.toContain("relativePath");
    expect(response.body).not.toContain("rootRealPath");
  });

  it.each([
    { filter: {}, expected: ["video", "cjk", "nested", "direct"] },
    { filter: { recursive: false }, expected: ["video", "direct"] },
    { filter: { type: "video" }, expected: ["video"] },
    { filter: { search: "sunset" }, expected: ["video", "nested", "direct"] },
    { filter: { search: "東京" }, expected: ["cjk"] },
    { filter: { search: "Night" }, expected: ["cjk", "nested"] },
    { filter: { tags: [" NIGHT ", "travel"] }, expected: ["video", "direct"] },
    { filter: { scoreFilter: "ranked" }, expected: ["video", "direct"] },
    { filter: { scoreFilter: "unranked" }, expected: ["cjk", "nested"] },
    { filter: { scoreFilter: "favorites" }, expected: ["video", "direct"] }
  ])("matches canonical listing for $filter", async ({ filter, expected }) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/assets/batch/details",
      headers,
      payload: {
        assetIds: requestedIds,
        filter: { folderId: selectedFolderId, ...filter }
      }
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<AssetDetailsResponse>();
    expect(result.matchingAssetIds).toEqual(expected);
    expect(result.assets).toHaveLength(6);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      if (key === "tags")
        for (const tag of value as string[]) query.append("tag", tag);
      else query.set(key === "scoreFilter" ? "score" : key, String(value));
    }
    const listed = await app.inject({
      url: `/api/folders/${selectedFolderId}/assets?${query}`,
      headers
    });
    expect(listed.statusCode).toBe(200);
    expect(
      new Set(
        listed.json<{ items: AssetRecord[] }>().items.map((asset) => asset.id)
      )
    ).toEqual(new Set(result.matchingAssetIds));
  });

  it("distinguishes renamed media and folder paths from active records outside the current search", async () => {
    const asset = getManagedAsset(db, "direct")!;
    commitAssetLocation(db, {
      assetId: asset.id,
      expectedVersion: asset.sourceVersion,
      rootId,
      folderId: selectedFolderId,
      relativePath: "Trip_100%/renamed.jpg",
      name: "renamed.jpg"
    });
    const folder = getManagedFolder(db, nestedFolderId)!;
    commitFolderLocation(db, {
      folderId: nestedFolderId,
      expectedVersion: folder.sourceVersion,
      rootId,
      parentId: selectedFolderId,
      relativePath: "Trip_100%/Day",
      name: "Day"
    });
    for (const [id, search] of [
      ["direct", "sunset"],
      ["nested", "Night"]
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/assets/batch/details",
        headers,
        payload: {
          assetIds: [id],
          filter: { folderId: rootFolderId, search }
        }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<AssetDetailsResponse>().assets).toHaveLength(1);
      expect(response.json<AssetDetailsResponse>().matchingAssetIds).toEqual(
        []
      );
    }
  });

  it("reads records, query membership and revision from one snapshot during a concurrent write", async () => {
    const revision = getLibraryRevision(db);
    const writer = new Database(db.name);
    let changed = false;
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (!changed && sql.includes("AND a.id IN (@assetId0)")) {
        changed = true;
        writer
          .prepare(
            "UPDATE asset_annotations SET manual_score = 0 WHERE asset_id = ?"
          )
          .run("direct");
      }
      return prepare(sql);
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/assets/batch/details",
        headers,
        payload: {
          assetIds: ["direct"],
          filter: { folderId: selectedFolderId, scoreFilter: "ranked" }
        }
      });
      expect(response.statusCode).toBe(200);
      expect(changed).toBe(true);
      expect(response.json<AssetDetailsResponse>()).toMatchObject({
        assets: [{ id: "direct", score: 3 }],
        matchingAssetIds: ["direct"],
        revision
      });
      expect(getLibraryRevision(db)).not.toBe(revision);
    } finally {
      writer.close();
    }
  });

  it("bounds requested IDs and filters and retains authentication and CSRF protection", async () => {
    const filter = { folderId: selectedFolderId };
    const request = (
      payload: Record<string, unknown>,
      requestHeaders = headers
    ) =>
      app.inject({
        method: "POST",
        url: "/api/assets/batch/details",
        headers: requestHeaders,
        payload
      });
    const assetIds = Array.from(
      { length: 500 },
      (_, index) => `missing-${index}`
    );
    const accepted = await request({ assetIds, filter });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<AssetDetailsResponse>().matchingAssetIds).toEqual([]);
    for (const payload of [
      { assetIds: [...assetIds, "extra"], filter },
      { assetIds: ["direct"], filter: { ...filter, search: "a".repeat(129) } },
      {
        assetIds: ["direct"],
        filter: { ...filter, tags: Array(21).fill("tag") }
      },
      { assetIds: ["direct"], filter: { ...filter, recursive: "true" } }
    ]) {
      expect((await request(payload)).statusCode).toBe(400);
    }
    const missingFolder = await request({
      assetIds: ["direct"],
      filter: { folderId: "missing-folder" }
    });
    expect(missingFolder.statusCode).toBe(404);
    expect(missingFolder.json()).toEqual({ error: "folder_not_found" });
    expect(
      (await request({ assetIds: ["direct"], filter }, {})).statusCode
    ).toBe(401);
    expect(
      (
        await request(
          { assetIds: ["direct"], filter },
          { cookie: headers.cookie! }
        )
      ).statusCode
    ).toBe(403);
  });
});
