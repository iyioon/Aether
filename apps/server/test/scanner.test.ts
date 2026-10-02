import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import {
  folderIdFor,
  listAssets,
  listFolders
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";
import type { ScanProgress } from "../src/library/scanner.js";

describe("library scanner", () => {
  let cwd: string;
  let config: AppConfig;
  let db: AetherDatabase;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "aether-scan-"));
    await mkdir(path.join(cwd, "media", "2026", "seoul"), {
      recursive: true
    });

    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache"
      },
      cwd
    );
    db = openDatabase(config.configDir);
  });

  afterEach(() => {
    db.close();
  });

  it("indexes supported image and video files into folders", async () => {
    const mediaDir = path.join(cwd, "media", "2026", "seoul");
    await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#8ca99b"
      }
    })
      .jpeg()
      .toFile(path.join(mediaDir, "photo.JPG"));
    await writeFile(path.join(mediaDir, "animation.GIF"), "fake animation");
    await writeFile(path.join(mediaDir, "motion.webp"), "fake webp");
    await writeFile(path.join(mediaDir, "sticker.apng"), "fake apng");
    await writeFile(path.join(mediaDir, "cinema.avif"), "fake avif");
    await writeFile(path.join(mediaDir, "clip.mp4"), "fake video");
    await writeFile(path.join(mediaDir, "notes.txt"), "ignore me");

    const result = await scanLibrary(db, config.mediaRoots);
    const root = config.mediaRoots[0]!;
    const rootFolderId = folderIdFor(root.id, "");
    const folders = listFolders(db);
    const assets = listAssets(db, {
      folderId: rootFolderId,
      offset: 0,
      limit: 20,
      sort: "filename",
      type: "all",
      recursive: true
    });

    expect(result.assets).toBe(6);
    expect(result.folders).toBe(2);
    expect(result.skipped).toBe(1);
    expect(folders.map((folder) => folder.relativePath)).toEqual([
      "",
      "2026",
      "2026/seoul"
    ]);
    expect(assets?.page.total).toBe(6);
    expect(assets?.items.map((asset) => asset.name)).toEqual([
      "animation.GIF",
      "cinema.avif",
      "clip.mp4",
      "motion.webp",
      "photo.JPG",
      "sticker.apng"
    ]);
    expect(assets?.items.map((asset) => asset.mediaType)).toEqual([
      "image",
      "image",
      "video",
      "image",
      "image",
      "image"
    ]);
    expect(
      assets?.items.find((asset) => asset.name === "photo.JPG")
    ).toMatchObject({
      width: 32,
      height: 24
    });
  });

  it("reports discovery, determinate scanning, and finalizing progress", async () => {
    const mediaDir = path.join(cwd, "media", "2026", "seoul");
    await writeFile(path.join(mediaDir, "photo.jpg"), "fake image");
    const updates: ScanProgress[] = [];

    await scanLibrary(db, config.mediaRoots, (progress) => {
      updates.push({ ...progress });
    });

    expect(updates[0]).toMatchObject({
      phase: "discovering",
      percent: null,
      total: null
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        phase: "scanning",
        processed: 0,
        total: 3,
        percent: 0
      })
    );
    expect(updates.at(-1)).toMatchObject({
      phase: "finalizing",
      processed: 3,
      total: 3,
      percent: 100
    });
  });

  it("does not rewrite dimensions for an unchanged image on repeat scans", async () => {
    const imagePath = path.join(cwd, "media", "unchanged.png");
    await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: "#718096"
      }
    })
      .png()
      .toFile(imagePath);

    await scanLibrary(db, config.mediaRoots);
    db.exec(`
      CREATE TRIGGER reject_redundant_dimension_write
      BEFORE UPDATE OF width, height ON assets
      BEGIN
        SELECT RAISE(ABORT, 'unchanged dimensions were rewritten');
      END;
    `);

    const result = await scanLibrary(db, config.mediaRoots);
    const assets = listAssets(db, {
      folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "image",
      recursive: true
    });

    expect(result.assets).toBe(1);
    expect(assets?.items[0]).toMatchObject({ width: 40, height: 30 });
  });

  it("refreshes dimensions when an image changes between scans", async () => {
    const imagePath = path.join(cwd, "media", "resized.png");
    await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: "#718096"
      }
    })
      .png()
      .toFile(imagePath);
    await scanLibrary(db, config.mediaRoots);

    await sharp({
      create: {
        width: 96,
        height: 72,
        channels: 3,
        background: "#8ca99b"
      }
    })
      .png()
      .toFile(imagePath);
    const changedAt = new Date(Date.now() + 1_000);
    await utimes(imagePath, changedAt, changedAt);
    await scanLibrary(db, config.mediaRoots);

    const assets = listAssets(db, {
      folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "image",
      recursive: true
    });

    expect(assets?.items).toHaveLength(1);
    expect(assets?.items[0]).toMatchObject({
      name: "resized.png",
      width: 96,
      height: 72
    });
  });

  it("keeps search index rows intact for unchanged assets", async () => {
    const mediaDir = path.join(cwd, "media");
    await Promise.all([
      sharp({
        create: {
          width: 32,
          height: 24,
          channels: 3,
          background: "#718096"
        }
      })
        .png()
        .toFile(path.join(mediaDir, "first.png")),
      sharp({
        create: {
          width: 48,
          height: 36,
          channels: 3,
          background: "#8ca99b"
        }
      })
        .png()
        .toFile(path.join(mediaDir, "second.png"))
    ]);
    await scanLibrary(db, config.mediaRoots);

    const searchRowsBefore = db
      .prepare(
        `SELECT asset_id, rowid
         FROM asset_search
         ORDER BY asset_id`
      )
      .all();

    await scanLibrary(db, config.mediaRoots);

    const searchRowsAfter = db
      .prepare(
        `SELECT asset_id, rowid
         FROM asset_search
         ORDER BY asset_id`
      )
      .all();

    expect(searchRowsBefore).toHaveLength(2);
    expect(searchRowsAfter).toEqual(searchRowsBefore);
  });

  it("repairs a missing search row during an unchanged repeat scan", async () => {
    const imagePath = path.join(cwd, "media", "search-repair.png");
    await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#718096"
      }
    })
      .png()
      .toFile(imagePath);
    await scanLibrary(db, config.mediaRoots);

    const indexedAsset = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("search-repair.png") as { id: string };
    db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(
      indexedAsset.id
    );

    await scanLibrary(db, config.mediaRoots);

    const searchResult = listAssets(db, {
      folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "image",
      recursive: true,
      search: "search-repair"
    });

    expect(searchResult?.items).toHaveLength(1);
    expect(searchResult?.items[0]?.id).toBe(indexedAsset.id);
  });

  it("skips symlinks and removes assets missing from a later scan", async () => {
    const mediaDir = path.join(cwd, "media", "2026", "seoul");
    const outsideDir = path.join(cwd, "outside");
    await mkdir(outsideDir);
    await writeFile(path.join(mediaDir, "photo.jpg"), "fake image");
    await writeFile(path.join(mediaDir, "clip.mp4"), "fake video");
    await writeFile(path.join(outsideDir, "secret.jpg"), "outside");
    await symlink(
      path.join(outsideDir, "secret.jpg"),
      path.join(mediaDir, "linked-secret.jpg")
    );

    await scanLibrary(db, config.mediaRoots);
    await rm(path.join(mediaDir, "clip.mp4"));
    const result = await scanLibrary(db, config.mediaRoots);

    const root = config.mediaRoots[0]!;
    const assets = listAssets(db, {
      folderId: folderIdFor(root.id, ""),
      offset: 0,
      limit: 20,
      sort: "filename",
      type: "all",
      recursive: true
    });

    expect(result.removedAssets).toBe(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(assets?.page.total).toBe(1);
    expect(assets?.items[0]?.name).toBe("photo.jpg");
  });

  it("matches Korean filename substrings in search", async () => {
    const mediaDir = path.join(cwd, "media", "2026", "seoul");
    await writeFile(path.join(mediaDir, "제주도여행사진.jpg"), "fake image");
    await writeFile(path.join(mediaDir, "가족모임.png"), "fake image");
    await scanLibrary(db, config.mediaRoots);
    const rootFolderId = folderIdFor(config.mediaRoots[0]!.id, "");

    const travel = listAssets(db, {
      folderId: rootFolderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true,
      search: "여행"
    });
    const family = listAssets(db, {
      folderId: rootFolderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true,
      search: "가족"
    });
    const middle = listAssets(db, {
      folderId: rootFolderId,
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true,
      search: "주도여"
    });

    expect(travel?.items.map((asset) => asset.name)).toEqual([
      "제주도여행사진.jpg"
    ]);
    expect(family?.items.map((asset) => asset.name)).toEqual(["가족모임.png"]);
    expect(middle?.items.map((asset) => asset.name)).toEqual([
      "제주도여행사진.jpg"
    ]);
  });
});
