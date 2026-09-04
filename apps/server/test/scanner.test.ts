import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
    expect(assets?.items.find((asset) => asset.name === "photo.JPG")).toMatchObject({
      width: 32,
      height: 24
    });
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
