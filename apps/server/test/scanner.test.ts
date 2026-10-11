import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  rename,
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
  getAsset,
  listAssets,
  listFolders,
  recordComparisonDecision,
  setAssetTags,
  updateAssetScore,
  undoComparisonDecision
} from "../src/library/repository.js";
import { LibraryScanner, scanLibrary } from "../src/library/scanner.js";
import type { ScanProgress, ScanResult } from "../src/library/scanner.js";

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
        AETHER_DATA_DIR: "./aether-data"
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

  it("records a clean scan job as completed without warnings", async () => {
    await writeFile(path.join(cwd, "media", "clean.jpg"), "clean media");
    const scanner = new LibraryScanner(db, config.mediaRoots);

    const started = scanner.startScan();
    await waitForCondition(() => scanner.listJobs(1)[0]?.status !== "running");

    const job = scanner.listJobs(1)[0]!;
    const result = JSON.parse(job.result ?? "null") as ScanResult;
    expect(job).toMatchObject({
      id: started.id,
      status: "completed",
      error: null
    });
    expect(result).toMatchObject({
      outcome: "completed",
      incompleteReason: null,
      errors: 0,
      warnings: []
    });
  });

  it("records a pre-reconciliation source failure as incomplete", async () => {
    const mediaDir = path.join(cwd, "media");
    const offlineDir = path.join(cwd, "media-offline-for-job");
    await writeFile(path.join(mediaDir, "preserved.jpg"), "preserved media");
    await scanLibrary(db, config.mediaRoots);
    const preserved = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("preserved.jpg") as { id: string };

    await rename(mediaDir, offlineDir);
    try {
      const scanner = new LibraryScanner(db, config.mediaRoots);
      const started = scanner.startScan();
      await waitForCondition(
        () => scanner.listJobs(1)[0]?.status !== "running"
      );

      const job = scanner.listJobs(1)[0]!;
      const result = JSON.parse(job.result ?? "null") as ScanResult;
      expect(job).toMatchObject({
        id: started.id,
        status: "incomplete",
        error: null
      });
      expect(result).toMatchObject({
        outcome: "incomplete",
        incompleteReason: "source_changed_or_unavailable",
        warnings: [],
        removedAssets: 0
      });
      expect(result.errors).toBeGreaterThan(0);
      expect(getAsset(db, preserved.id)?.name).toBe("preserved.jpg");
    } finally {
      await rename(offlineDir, mediaDir);
    }
  });

  it("records post-reconciliation cache cleanup failures as completed warnings", async () => {
    await writeFile(path.join(cwd, "media", "indexed.jpg"), "indexed media");
    const invalidCachePath = path.join(cwd, "cache-is-a-file");
    await writeFile(invalidCachePath, "not a directory");
    const scanner = new LibraryScanner(db, config.mediaRoots, invalidCachePath);

    const started = scanner.startScan();
    await waitForCondition(() => scanner.listJobs(1)[0]?.status !== "running");

    const job = scanner.listJobs(1)[0]!;
    const result = JSON.parse(job.result ?? "null") as ScanResult;
    expect(job).toMatchObject({
      id: started.id,
      status: "completed",
      error: null
    });
    expect(result).toMatchObject({
      outcome: "completed",
      incompleteReason: null,
      errors: 0,
      warnings: ["derivative_cache_cleanup_failed"]
    });
    expect(
      db.prepare("SELECT id FROM assets WHERE name = ?").get("indexed.jpg")
    ).toBeDefined();
  });

  it("cancels an active hash on shutdown without reconciling deletions", async () => {
    const mediaDir = path.join(cwd, "media");
    const preservedPath = path.join(mediaDir, "preserved.jpg");
    await writeFile(preservedPath, "preserve this indexed asset");
    await scanLibrary(db, config.mediaRoots);
    const preserved = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("preserved.jpg") as { id: string };

    await rm(preservedPath);
    const largeMediaPath = path.join(mediaDir, "large.mp4");
    const largeMedia = await open(largeMediaPath, "w");
    try {
      await largeMedia.truncate(8 * 1024 * 1024 * 1024);
    } finally {
      await largeMedia.close();
    }

    const scanner = new LibraryScanner(db, config.mediaRoots);
    const job = scanner.startScan();
    await waitForCondition(() => {
      const progress = scanner.listJobs(1)[0]?.progress;
      return progress?.phase === "scanning" && progress.total !== null;
    });

    const stoppingStartedAt = Date.now();
    await scanner.stop();

    expect(Date.now() - stoppingStartedAt).toBeLessThan(5_000);
    expect(scanner.listJobs(1)[0]).toMatchObject({
      id: job.id,
      status: "failed",
      error: "Scan stopped before library changes were applied."
    });
    expect(getAsset(db, preserved.id)?.name).toBe("preserved.jpg");
    expect(
      db.prepare("SELECT id FROM assets WHERE name = ?").get("large.mp4")
    ).toBeUndefined();
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

  it("preserves identity and user metadata when a file is renamed", async () => {
    const mediaDir = path.join(cwd, "media");
    const originalPath = path.join(mediaDir, "original.jpg");
    const renamedPath = path.join(mediaDir, "renamed.jpg");
    await Promise.all([
      writeFile(originalPath, "same media bytes"),
      writeFile(path.join(mediaDir, "opponent.jpg"), "opponent bytes")
    ]);
    await scanLibrary(db, config.mediaRoots);

    const rows = db.prepare("SELECT id, name FROM assets").all() as Array<{
      id: string;
      name: string;
    }>;
    const originalId = rows.find((row) => row.name === "original.jpg")!.id;
    const opponentId = rows.find((row) => row.name === "opponent.jpg")!.id;
    const updatedAt = new Date().toISOString();
    updateAssetScore(db, {
      assetId: originalId,
      score: 87,
      favorite: true,
      updatedAt
    });
    setAssetTags(db, originalId, ["Archive", "Exam paper"], updatedAt);
    const decision = recordComparisonDecision(db, {
      leftAssetId: originalId,
      rightAssetId: opponentId,
      winnerAssetId: originalId,
      createdAt: updatedAt
    });

    await rename(originalPath, renamedPath);
    await scanLibrary(db, config.mediaRoots);

    const renamed = getAsset(db, originalId);
    expect(renamed).toMatchObject({
      id: originalId,
      name: "renamed.jpg",
      score: 87,
      favorite: true
    });
    expect(renamed?.tags.map((tag) => tag.displayName)).toEqual([
      "Archive",
      "Exam paper"
    ]);
    expect(renamed?.ranking?.comparisonCount).toBe(1);
    expect(
      db
        .prepare("SELECT id FROM comparison_events WHERE id = ?")
        .get(decision!.eventId)
    ).toEqual({ id: decision!.eventId });
    expect(
      db.prepare("SELECT id FROM assets WHERE name = ?").get("original.jpg")
    ).toBeUndefined();
  });

  it("preserves identity when a containing folder is moved", async () => {
    const albumsDir = path.join(cwd, "media", "albums");
    const originalDir = path.join(albumsDir, "original");
    const movedDir = path.join(albumsDir, "moved");
    await mkdir(originalDir, { recursive: true });
    await writeFile(path.join(originalDir, "photo.jpg"), "folder move bytes");
    await scanLibrary(db, config.mediaRoots);

    const before = db
      .prepare("SELECT id FROM assets WHERE relative_path = ?")
      .get("albums/original/photo.jpg") as { id: string };
    updateAssetScore(db, {
      assetId: before.id,
      score: 42,
      updatedAt: new Date().toISOString()
    });

    await rename(originalDir, movedDir);
    await scanLibrary(db, config.mediaRoots);

    const after = db
      .prepare("SELECT id, relative_path FROM assets WHERE name = ?")
      .get("photo.jpg") as { id: string; relative_path: string };
    expect(after).toEqual({
      id: before.id,
      relative_path: "albums/moved/photo.jpg"
    });
    expect(getAsset(db, before.id)?.score).toBe(42);
  });

  it("removes an absent asset and all of its user metadata after a successful scan", async () => {
    const mediaDir = path.join(cwd, "media");
    const removedPath = path.join(mediaDir, "removed-with-metadata.jpg");
    await Promise.all([
      writeFile(removedPath, "removed media bytes"),
      writeFile(path.join(mediaDir, "remaining.jpg"), "remaining media bytes")
    ]);
    await scanLibrary(db, config.mediaRoots);

    const rows = db.prepare("SELECT id, name FROM assets").all() as Array<{
      id: string;
      name: string;
    }>;
    const removedId = rows.find(
      (row) => row.name === "removed-with-metadata.jpg"
    )!.id;
    const remainingId = rows.find((row) => row.name === "remaining.jpg")!.id;
    const updatedAt = new Date().toISOString();
    updateAssetScore(db, {
      assetId: removedId,
      score: 73,
      favorite: true,
      updatedAt
    });
    setAssetTags(db, removedId, ["Temporary"], updatedAt);
    const decision = recordComparisonDecision(db, {
      leftAssetId: removedId,
      rightAssetId: remainingId,
      winnerAssetId: removedId,
      createdAt: updatedAt
    });

    await rm(removedPath);
    const result = await scanLibrary(db, config.mediaRoots);

    expect(result.removedAssets).toBe(1);
    expect(getAsset(db, removedId)).toBeNull();
    expect(
      db
        .prepare("SELECT asset_id FROM asset_annotations WHERE asset_id = ?")
        .get(removedId)
    ).toBeUndefined();
    expect(
      db
        .prepare("SELECT asset_id FROM asset_tags WHERE asset_id = ?")
        .get(removedId)
    ).toBeUndefined();
    expect(
      db
        .prepare("SELECT id FROM comparison_events WHERE id = ?")
        .get(decision!.eventId)
    ).toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT event_id FROM pair_preferences WHERE asset_low_id = ? OR asset_high_id = ?"
        )
        .get(removedId, removedId)
    ).toBeUndefined();
  });

  it("treats different content at the same path as a new blank asset", async () => {
    const assetPath = path.join(cwd, "media", "replacement.jpg");
    await writeFile(assetPath, "first media content");
    await scanLibrary(db, config.mediaRoots);

    const original = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("replacement.jpg") as { id: string };
    const updatedAt = new Date().toISOString();
    updateAssetScore(db, {
      assetId: original.id,
      score: 64,
      favorite: true,
      updatedAt
    });
    setAssetTags(db, original.id, ["Original"], updatedAt);

    await writeFile(assetPath, "entirely different replacement content");
    const changedAt = new Date(Date.now() + 1_000);
    await utimes(assetPath, changedAt, changedAt);
    await scanLibrary(db, config.mediaRoots);

    const replacement = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("replacement.jpg") as { id: string };
    expect(replacement.id).not.toBe(original.id);
    expect(getAsset(db, original.id)).toBeNull();
    expect(getAsset(db, replacement.id)).toMatchObject({
      score: 0,
      favorite: false,
      tags: []
    });
  });

  it("creates a separate blank asset for an identical copy that leaves the original in place", async () => {
    const mediaDir = path.join(cwd, "media");
    const originalPath = path.join(mediaDir, "original-copy-source.jpg");
    const copyPath = path.join(mediaDir, "identical-copy.jpg");
    await writeFile(originalPath, "identical content bytes");
    await scanLibrary(db, config.mediaRoots);

    const original = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("original-copy-source.jpg") as { id: string };
    updateAssetScore(db, {
      assetId: original.id,
      score: 91,
      favorite: true,
      updatedAt: new Date().toISOString()
    });

    await copyFile(originalPath, copyPath);
    await scanLibrary(db, config.mediaRoots);

    const copied = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("identical-copy.jpg") as { id: string };
    expect(copied.id).not.toBe(original.id);
    expect(getAsset(db, original.id)).toMatchObject({
      score: 91,
      favorite: true
    });
    expect(getAsset(db, copied.id)).toMatchObject({
      score: 0,
      favorite: false,
      tags: []
    });
  });

  it("does not delete assets when the configured root cannot be read", async () => {
    const mediaDir = path.join(cwd, "media");
    const offlineDir = path.join(cwd, "media-offline");
    await writeFile(path.join(mediaDir, "preserved.jpg"), "preserved bytes");
    await scanLibrary(db, config.mediaRoots);

    const preserved = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("preserved.jpg") as { id: string };
    updateAssetScore(db, {
      assetId: preserved.id,
      score: 55,
      updatedAt: new Date().toISOString()
    });

    await rename(mediaDir, offlineDir);
    try {
      const result = await scanLibrary(db, config.mediaRoots);
      expect(result.outcome).toBe("incomplete");
      expect(result.incompleteReason).toBe("source_changed_or_unavailable");
      expect(result.warnings).toEqual([]);
      expect(result.errors).toBeGreaterThan(0);
      expect(result.removedAssets).toBe(0);
      expect(getAsset(db, preserved.id)?.score).toBe(55);
    } finally {
      await rename(offlineDir, mediaDir);
    }
  });

  it("does not delete assets beneath an unreadable subtree", async () => {
    const restrictedDir = path.join(cwd, "media", "restricted");
    await mkdir(restrictedDir);
    await writeFile(
      path.join(restrictedDir, "preserved.jpg"),
      "subtree preserved bytes"
    );
    await scanLibrary(db, config.mediaRoots);

    const preserved = db
      .prepare("SELECT id FROM assets WHERE name = ?")
      .get("preserved.jpg") as { id: string };
    updateAssetScore(db, {
      assetId: preserved.id,
      score: 33,
      updatedAt: new Date().toISOString()
    });

    await chmod(restrictedDir, 0o000);
    try {
      await scanLibrary(db, config.mediaRoots);
      expect(getAsset(db, preserved.id)?.score).toBe(33);
    } finally {
      await chmod(restrictedDir, 0o755);
    }
  });

  it("recomputes surviving rankings when a missing asset is removed", async () => {
    const mediaDir = path.join(cwd, "media");
    await Promise.all([
      writeFile(path.join(mediaDir, "removed.jpg"), "removed"),
      writeFile(path.join(mediaDir, "survivor.jpg"), "survivor"),
      writeFile(path.join(mediaDir, "opponent.jpg"), "opponent")
    ]);
    await scanLibrary(db, config.mediaRoots);

    const indexed = db.prepare("SELECT id, name FROM assets").all() as Array<{
      id: string;
      name: string;
    }>;
    const assetId = (name: string) =>
      indexed.find((asset) => asset.name === name)?.id ?? "";
    const removedId = assetId("removed.jpg");
    const survivorId = assetId("survivor.jpg");
    const opponentId = assetId("opponent.jpg");
    const decidedAt = new Date().toISOString();

    const firstRemovedAssetDecision = recordComparisonDecision(db, {
      leftAssetId: removedId,
      rightAssetId: survivorId,
      winnerAssetId: survivorId,
      createdAt: decidedAt
    });
    const changedRemovedAssetDecision = recordComparisonDecision(db, {
      leftAssetId: removedId,
      rightAssetId: survivorId,
      winnerAssetId: removedId,
      createdAt: decidedAt
    });
    expect(firstRemovedAssetDecision).not.toBeNull();
    expect(changedRemovedAssetDecision).not.toBeNull();
    undoComparisonDecision(db, changedRemovedAssetDecision!.eventId, decidedAt);
    recordComparisonDecision(db, {
      leftAssetId: survivorId,
      rightAssetId: opponentId,
      winnerAssetId: survivorId,
      createdAt: decidedAt
    });
    expect(getAsset(db, survivorId)?.ranking?.comparisonCount).toBe(2);

    await rm(path.join(mediaDir, "removed.jpg"));
    await scanLibrary(db, config.mediaRoots);

    const survivor = getAsset(db, survivorId);
    const opponent = getAsset(db, opponentId);
    expect(getAsset(db, removedId)).toBeNull();
    expect(survivor?.ranking?.comparisonCount).toBe(1);
    expect(opponent?.ranking?.comparisonCount).toBe(1);
    expect(survivor?.score).toBeGreaterThan(opponent?.score ?? 0);
  });

  it("recomputes surviving rankings when a configured root is removed", async () => {
    const otherRoot = path.join(cwd, "other-media");
    await mkdir(otherRoot);
    await Promise.all([
      writeFile(path.join(cwd, "media", "removed-root.jpg"), "removed"),
      writeFile(path.join(otherRoot, "survivor.jpg"), "survivor"),
      writeFile(path.join(otherRoot, "opponent.jpg"), "opponent")
    ]);
    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media,./other-media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    await scanLibrary(db, config.mediaRoots);

    const indexed = db.prepare("SELECT id, name FROM assets").all() as Array<{
      id: string;
      name: string;
    }>;
    const assetId = (name: string) =>
      indexed.find((asset) => asset.name === name)?.id ?? "";
    const removedId = assetId("removed-root.jpg");
    const survivorId = assetId("survivor.jpg");
    const opponentId = assetId("opponent.jpg");
    const decidedAt = new Date().toISOString();

    recordComparisonDecision(db, {
      leftAssetId: removedId,
      rightAssetId: survivorId,
      winnerAssetId: survivorId,
      createdAt: decidedAt
    });
    recordComparisonDecision(db, {
      leftAssetId: survivorId,
      rightAssetId: opponentId,
      winnerAssetId: survivorId,
      createdAt: decidedAt
    });
    expect(getAsset(db, survivorId)?.ranking?.comparisonCount).toBe(2);

    const remainingRoots = config.mediaRoots.filter(
      (root) => root.label === "other-media"
    );
    await scanLibrary(db, remainingRoots);

    expect(getAsset(db, removedId)).toBeNull();
    expect(getAsset(db, survivorId)?.ranking?.comparisonCount).toBe(1);
    expect(getAsset(db, opponentId)?.ranking?.comparisonCount).toBe(1);
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

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }

  throw new Error("Timed out waiting for the scan state.");
}
