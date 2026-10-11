import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { checkpointDatabase, openDatabase } from "../src/db/database.js";
import {
  removeAssetDerivativeCache,
  sweepDerivativeCache
} from "../src/library/derivative-cache.js";
import { scanLibrary } from "../src/library/scanner.js";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("privacy lifecycle", () => {
  it("enables secure deletion for SQLite and the media search index", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const db = openDatabase(path.join(fixtureDirectory, "config"));

    try {
      expect(db.pragma("secure_delete", { simple: true })).toBe(1);
      expect(
        db
          .prepare(
            "SELECT v FROM asset_search_config WHERE k = 'secure-delete'"
          )
          .get()
      ).toEqual({ v: 1 });
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 15")
          .get()
      ).toEqual({ name: "secure_deleted_media_metadata" });
      expect(
        db
          .prepare(
            "SELECT name FROM database_maintenance WHERE name = 'secure_delete_v15_vacuum'"
          )
          .get()
      ).toEqual({ name: "secure_delete_v15_vacuum" });
    } finally {
      db.close();
    }
  });

  it("retries incomplete privacy maintenance on the next database open", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const configDirectory = path.join(fixtureDirectory, "config");
    let db = openDatabase(configDirectory);
    db.prepare(
      "DELETE FROM database_maintenance WHERE name = 'secure_delete_v15_vacuum'"
    ).run();
    db.close();

    db = openDatabase(configDirectory);
    try {
      expect(
        db
          .prepare(
            "SELECT name FROM database_maintenance WHERE name = 'secure_delete_v15_vacuum'"
          )
          .get()
      ).toEqual({ name: "secure_delete_v15_vacuum" });
    } finally {
      db.close();
    }
  });

  it("scrubs deleted media text from SQLite and its write-ahead log", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const configDirectory = path.join(fixtureDirectory, "config");
    const databasePath = path.join(configDirectory, "aether.sqlite");
    const privateTitle = "PRIVATE_DELETED_TITLE_8F10C5B7E2";
    const db = openDatabase(configDirectory);

    try {
      insertAsset(db, "asset-private", privateTitle);
      db.prepare(
        `INSERT INTO asset_search
          (asset_id, root_id, folder_id, name, relative_path, search_ngrams)
         VALUES (?, 'root-test', NULL, ?, ?, ?)`
      ).run("asset-private", privateTitle, `${privateTitle}.jpg`, privateTitle);
      db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(
        "asset-private"
      );
      db.prepare("DELETE FROM assets WHERE id = ?").run("asset-private");
      expect(checkpointDatabase(db)).toBe(true);
    } finally {
      db.close();
    }

    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from(privateTitle))).toBe(false);
    const walBytes = await readFile(`${databasePath}-wal`).catch(() =>
      Buffer.alloc(0)
    );
    expect(walBytes.includes(Buffer.from(privateTitle))).toBe(false);
  });

  it("refuses to open a symlinked SQLite data file", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const configDirectory = path.join(fixtureDirectory, "config");
    const outsideFile = path.join(fixtureDirectory, "outside.sqlite");
    await writeFixtureFile(outsideFile);
    await mkdir(configDirectory, { recursive: true });
    await symlink(outsideFile, path.join(configDirectory, "aether.sqlite"));

    expect(() => openDatabase(configDirectory)).toThrow(
      "Unsafe SQLite data file."
    );
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("fixture");
  });

  it("removes orphaned and obsolete derivatives without touching other cache data", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const cacheDirectory = path.join(fixtureDirectory, "cache");
    const db = openDatabase(path.join(fixtureDirectory, "config"));
    const keptThumbnail = path.join(
      cacheDirectory,
      "thumbnails",
      "asset-live",
      "kept.webp"
    );
    const staleThumbnail = path.join(
      cacheDirectory,
      "thumbnails",
      "asset-live",
      "stale.webp"
    );
    const orphanPreview = path.join(
      cacheDirectory,
      "previews",
      "asset-gone",
      "preview.mp4"
    );
    const loosePoster = path.join(cacheDirectory, "posters", "loose.jpg");
    const unrelatedFile = path.join(cacheDirectory, "README.txt");

    try {
      insertAsset(db, "asset-live");
      db.prepare(
        `INSERT INTO derivatives
          (id, asset_id, kind, width, height, path, source_mtime_ms,
           status, error, created_at)
         VALUES (?, ?, 'thumbnail', 128, 128, ?, 1, 'ready', NULL, ?)`
      ).run(
        "derivative-live",
        "asset-live",
        keptThumbnail,
        "2026-10-11T00:00:00.000Z"
      );

      await Promise.all([
        writeFixtureFile(keptThumbnail),
        writeFixtureFile(staleThumbnail),
        writeFixtureFile(orphanPreview),
        writeFixtureFile(loosePoster),
        writeFixtureFile(unrelatedFile)
      ]);

      const result = await sweepDerivativeCache(db, cacheDirectory, {
        pruneStaleFiles: true
      });

      expect(result.removedEntries).toBe(3);
      await expect(access(keptThumbnail)).resolves.toBeUndefined();
      await expect(access(staleThumbnail)).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(access(orphanPreview)).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(access(loosePoster)).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(access(unrelatedFile)).resolves.toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("purges a removed asset without allowing a database ID to escape the cache", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const cacheDirectory = path.join(fixtureDirectory, "cache");
    const thumbnail = path.join(
      cacheDirectory,
      "thumbnails",
      "asset-removed",
      "thumbnail.webp"
    );
    const outsideSentinel = path.join(fixtureDirectory, "sentinel.txt");
    await Promise.all([
      writeFixtureFile(thumbnail),
      writeFixtureFile(outsideSentinel)
    ]);

    const result = await removeAssetDerivativeCache(cacheDirectory, [
      "asset-removed",
      "../sentinel.txt"
    ]);

    expect(result.removedEntries).toBe(1);
    await expect(access(thumbnail)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(outsideSentinel)).resolves.toBeUndefined();
  });

  it("refuses to follow a symlinked derivative cache directory", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const cacheDirectory = path.join(fixtureDirectory, "cache");
    const outsideDirectory = path.join(fixtureDirectory, "outside-cache");
    const outsideFile = path.join(
      outsideDirectory,
      "asset-removed",
      "private.webp"
    );
    await writeFixtureFile(outsideFile);
    await mkdir(cacheDirectory, { recursive: true });
    await symlink(outsideDirectory, path.join(cacheDirectory, "thumbnails"));

    await expect(
      removeAssetDerivativeCache(cacheDirectory, ["asset-removed"])
    ).rejects.toMatchObject({
      name: "DerivativeCacheCleanupError",
      message: "Derivative cache cleanup failed."
    });
    await expect(access(outsideFile)).resolves.toBeUndefined();
  });

  it("purges an asset's derivatives after a clean scan confirms source deletion", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const mediaDirectory = path.join(fixtureDirectory, "media");
    const sourceFile = path.join(mediaDirectory, "private-photo.jpg");
    await writeFixtureFile(sourceFile);
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: mediaDirectory,
        AETHER_DATA_DIR: path.join(fixtureDirectory, "aether-data"),
        NODE_ENV: "test"
      },
      fixtureDirectory
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots, undefined, config.cacheDir);
      const asset = db.prepare("SELECT id FROM assets").get() as {
        id: string;
      };
      const cachedFiles = [
        path.join(config.cacheDir, "thumbnails", asset.id, "thumbnail.webp"),
        path.join(config.cacheDir, "posters", asset.id, "poster.jpg"),
        path.join(config.cacheDir, "previews", asset.id, "preview.mp4")
      ];
      await Promise.all(cachedFiles.map(writeFixtureFile));
      await rm(sourceFile);

      const result = await scanLibrary(
        db,
        config.mediaRoots,
        undefined,
        config.cacheDir
      );

      expect(result.removedAssets).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM assets").get()).toEqual({
        count: 0
      });
      for (const cachedFile of cachedFiles) {
        await expect(access(cachedFile)).rejects.toMatchObject({
          code: "ENOENT"
        });
      }
    } finally {
      db.close();
    }
  });

  it("reports cache cleanup warnings without misreporting committed reconciliation", async () => {
    const fixtureDirectory = await createFixtureDirectory();
    const mediaDirectory = path.join(fixtureDirectory, "media");
    const sourceFile = path.join(mediaDirectory, "removed-photo.jpg");
    const outsideCache = path.join(fixtureDirectory, "outside-cache");
    await Promise.all([
      writeFixtureFile(sourceFile),
      writeFixtureFile(path.join(outsideCache, "sentinel.webp"))
    ]);
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: mediaDirectory,
        AETHER_DATA_DIR: path.join(fixtureDirectory, "aether-data"),
        NODE_ENV: "test"
      },
      fixtureDirectory
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots, undefined, config.cacheDir);
      await rm(sourceFile);
      await rm(config.cacheDir, { recursive: true });
      await symlink(outsideCache, config.cacheDir);

      const result = await scanLibrary(
        db,
        config.mediaRoots,
        undefined,
        config.cacheDir
      );

      expect(result).toMatchObject({
        outcome: "completed",
        incompleteReason: null,
        removedAssets: 1,
        errors: 0,
        warnings: ["derivative_cache_cleanup_failed"]
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM assets").get()).toEqual({
        count: 0
      });
      await expect(
        access(path.join(outsideCache, "sentinel.webp"))
      ).resolves.toBeUndefined();
    } finally {
      db.close();
    }
  });
});

async function createFixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(process.cwd(), ".privacy-lifecycle-")
  );
  fixtureDirectories.push(directory);
  return directory;
}

async function writeFixtureFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "fixture");
}

function insertAsset(
  db: ReturnType<typeof openDatabase>,
  assetId: string,
  name = "media"
): void {
  db.prepare(
    `INSERT INTO roots (id, label, real_path, created_at)
     VALUES ('root-test', 'Test', '/media', '2026-10-11T00:00:00.000Z')
     ON CONFLICT(id) DO NOTHING`
  ).run();
  db.prepare(
    `INSERT INTO assets
      (id, root_id, folder_id, relative_path, name, extension, media_type,
       mime_type, size_bytes, mtime_ms, fingerprint, content_sha256,
       indexed_at, status, error)
     VALUES
      (?, 'root-test', NULL, ?, ?, '.jpg', 'image', 'image/jpeg',
       1, 1, '1:1:1', 'hash', '2026-10-11T00:00:00.000Z', 'indexed', NULL)`
  ).run(assetId, `${name}.jpg`, `${name}.jpg`);
}
