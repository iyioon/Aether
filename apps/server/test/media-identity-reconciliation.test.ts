import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { openDatabase } from "../src/db/database.js";
import {
  getAsset,
  setAssetTags,
  updateAssetScore
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";

describe("media identity reconciliation", () => {
  it("preserves identity and metadata when a named root changes path", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-root-move-"));
    const originalRoot = path.join(cwd, "original-library");
    const movedRoot = path.join(cwd, "moved-library");
    await mkdir(originalRoot);
    await writeFile(path.join(originalRoot, "kept.jpg"), "stable media bytes");

    const originalConfig = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "archive=./original-library",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(originalConfig.configDir);

    try {
      await scanLibrary(db, originalConfig.mediaRoots);
      const original = db
        .prepare("SELECT id FROM assets WHERE name = ?")
        .get("kept.jpg") as { id: string };
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: original.id,
        score: 88,
        favorite: true,
        updatedAt
      });
      setAssetTags(db, original.id, ["Archive"], updatedAt);

      await rename(originalRoot, movedRoot);
      const movedConfig = await loadConfig(
        {
          AETHER_MEDIA_ROOTS: "archive=./moved-library",
          AETHER_DATA_DIR: "./aether-data"
        },
        cwd
      );

      expect(movedConfig.mediaRoots[0]?.id).toBe(
        originalConfig.mediaRoots[0]?.id
      );
      await scanLibrary(db, movedConfig.mediaRoots);

      expect(getAsset(db, original.id)).toMatchObject({
        id: original.id,
        score: 88,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Archive" })]
      });
      expect(
        db
          .prepare(
            `SELECT a.id, a.root_id, a.relative_path, roots.real_path
             FROM assets a
             JOIN roots ON roots.id = a.root_id`
          )
          .get()
      ).toEqual({
        id: original.id,
        root_id: movedConfig.mediaRoots[0]!.id,
        relative_path: "kept.jpg",
        real_path: movedConfig.mediaRoots[0]!.realPath
      });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps duplicate-content IDs on their relative paths when a named root moves", async () => {
    const cwd = await mkdtemp(
      path.join(tmpdir(), "aether-duplicate-root-move-")
    );
    const originalRoot = path.join(cwd, "original-library");
    const movedRoot = path.join(cwd, "moved-library");
    await mkdir(originalRoot);
    await writeFile(path.join(originalRoot, "first.jpg"), "identical bytes");
    await writeFile(path.join(originalRoot, "second.jpg"), "identical bytes");

    const originalConfig = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "archive=./original-library",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(originalConfig.configDir);

    try {
      await scanLibrary(db, originalConfig.mediaRoots);
      const originalAssets = db
        .prepare("SELECT id, relative_path FROM assets ORDER BY relative_path")
        .all() as Array<{ id: string; relative_path: string }>;
      const firstId = originalAssets.find(
        (asset) => asset.relative_path === "first.jpg"
      )!.id;
      const secondId = originalAssets.find(
        (asset) => asset.relative_path === "second.jpg"
      )!.id;
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: firstId,
        score: 93,
        updatedAt
      });
      updateAssetScore(db, {
        assetId: secondId,
        score: 28,
        updatedAt
      });
      setAssetTags(db, firstId, ["First path"], updatedAt);
      setAssetTags(db, secondId, ["Second path"], updatedAt);

      await rename(originalRoot, movedRoot);
      const movedConfig = await loadConfig(
        {
          AETHER_MEDIA_ROOTS: "archive=./moved-library",
          AETHER_DATA_DIR: "./aether-data"
        },
        cwd
      );
      await scanLibrary(db, movedConfig.mediaRoots);

      expect(
        db
          .prepare(
            "SELECT id, relative_path FROM assets ORDER BY relative_path"
          )
          .all()
      ).toEqual([
        { id: firstId, relative_path: "first.jpg" },
        { id: secondId, relative_path: "second.jpg" }
      ]);
      expect(getAsset(db, firstId)).toMatchObject({
        score: 93,
        tags: [expect.objectContaining({ displayName: "First path" })]
      });
      expect(getAsset(db, secondId)).toMatchObject({
        score: 28,
        tags: [expect.objectContaining({ displayName: "Second path" })]
      });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps identical files distinct when a named root is copied onto new filesystem identities", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-copied-root-"));
    const originalRoot = path.join(cwd, "original-library");
    const copiedRoot = path.join(cwd, "copied-library");
    await mkdir(originalRoot);
    await writeFile(path.join(originalRoot, "first.jpg"), "identical bytes");
    await writeFile(path.join(originalRoot, "second.jpg"), "identical bytes");

    const originalConfig = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "archive=./original-library",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(originalConfig.configDir);

    try {
      await scanLibrary(db, originalConfig.mediaRoots);
      const originalAssets = db
        .prepare("SELECT id, relative_path FROM assets ORDER BY relative_path")
        .all() as Array<{ id: string; relative_path: string }>;
      const firstId = originalAssets[0]!.id;
      const secondId = originalAssets[1]!.id;
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: firstId,
        score: 96,
        favorite: true,
        updatedAt
      });
      updateAssetScore(db, {
        assetId: secondId,
        score: 31,
        updatedAt
      });
      setAssetTags(db, firstId, ["First copy identity"], updatedAt);
      setAssetTags(db, secondId, ["Second copy identity"], updatedAt);

      await mkdir(copiedRoot);
      for (const name of ["first.jpg", "second.jpg"]) {
        const source = path.join(originalRoot, name);
        const copied = path.join(copiedRoot, name);
        await copyFile(source, copied);
        const [sourceStats, copiedStats] = await Promise.all([
          stat(source, { bigint: true }),
          stat(copied, { bigint: true })
        ]);
        expect(copiedStats.ino).not.toBe(sourceStats.ino);
      }

      const copiedConfig = await loadConfig(
        {
          AETHER_MEDIA_ROOTS: "archive=./copied-library",
          AETHER_DATA_DIR: "./aether-data"
        },
        cwd
      );
      const result = await scanLibrary(db, copiedConfig.mediaRoots);

      expect(result).toMatchObject({ errors: 0, removedAssets: 0 });
      expect(
        db
          .prepare(
            "SELECT id, relative_path FROM assets ORDER BY relative_path"
          )
          .all()
      ).toEqual([
        { id: firstId, relative_path: "first.jpg" },
        { id: secondId, relative_path: "second.jpg" }
      ]);
      expect(getAsset(db, firstId)).toMatchObject({
        score: 96,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "First copy identity" })]
      });
      expect(getAsset(db, secondId)).toMatchObject({
        score: 31,
        tags: [expect.objectContaining({ displayName: "Second copy identity" })]
      });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("adopts a legacy plain root into a stable named root without losing metadata", async () => {
    const cwd = await mkdtemp(
      path.join(tmpdir(), "aether-named-root-upgrade-")
    );
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);
    await writeFile(
      path.join(mediaRoot, "existing.jpg"),
      "media indexed before named roots"
    );

    const legacyConfig = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(legacyConfig.configDir);

    try {
      await scanLibrary(db, legacyConfig.mediaRoots);
      const legacyRootId = legacyConfig.mediaRoots[0]!.id;
      const original = db
        .prepare("SELECT id FROM assets WHERE name = ?")
        .get("existing.jpg") as { id: string };
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: original.id,
        score: 76,
        favorite: true,
        updatedAt
      });
      setAssetTags(db, original.id, ["Pre-upgrade"], updatedAt);

      const namedConfig = await loadConfig(
        {
          AETHER_MEDIA_ROOTS: "archive=./media",
          AETHER_DATA_DIR: "./aether-data"
        },
        cwd
      );
      const namedRoot = namedConfig.mediaRoots[0]!;
      expect(namedRoot.id).not.toBe(legacyRootId);

      const result = await scanLibrary(db, namedConfig.mediaRoots);

      expect(result).toMatchObject({ errors: 0, removedAssets: 0 });
      expect(getAsset(db, original.id)).toMatchObject({
        id: original.id,
        name: "existing.jpg",
        score: 76,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Pre-upgrade" })]
      });
      expect(
        db.prepare("SELECT id, label, real_path FROM roots ORDER BY id").all()
      ).toEqual([
        {
          id: namedRoot.id,
          label: "archive",
          real_path: namedRoot.realPath
        }
      ]);
      expect(
        db.prepare("SELECT root_id FROM assets WHERE id = ?").get(original.id)
      ).toEqual({ root_id: namedRoot.id });
      expect(
        db.prepare("SELECT id FROM roots WHERE id = ?").get(legacyRootId)
      ).toBeUndefined();
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves identity and metadata when media moves between roots", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-cross-root-"));
    const sourceRoot = path.join(cwd, "source");
    const destinationRoot = path.join(cwd, "destination");
    await mkdir(sourceRoot);
    await mkdir(destinationRoot);
    const sourcePath = path.join(sourceRoot, "original.jpg");
    const destinationPath = path.join(destinationRoot, "moved.jpg");
    await writeFile(sourcePath, "cross-root media bytes");

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "source=./source,destination=./destination",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots);
      const original = db
        .prepare("SELECT id FROM assets WHERE name = ?")
        .get("original.jpg") as { id: string };
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: original.id,
        score: 71,
        favorite: true,
        updatedAt
      });
      setAssetTags(db, original.id, ["Moved"], updatedAt);

      await rename(sourcePath, destinationPath);
      await scanLibrary(db, config.mediaRoots);

      const destinationRootId = config.mediaRoots.find(
        (root) => root.label === "destination"
      )!.id;
      expect(
        db
          .prepare("SELECT id, root_id, relative_path FROM assets WHERE id = ?")
          .get(original.id)
      ).toEqual({
        id: original.id,
        root_id: destinationRootId,
        relative_path: "moved.jpg"
      });
      expect(getAsset(db, original.id)).toMatchObject({
        score: 71,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Moved" })]
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM assets").get()).toEqual({
        count: 1
      });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves a uniquely matching legacy v13 identity moved before hash backfill", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-legacy-move-"));
    const mediaRoot = path.join(cwd, "media");
    const movedDirectory = path.join(mediaRoot, "archive");
    const originalPath = path.join(mediaRoot, "legacy-name.jpg");
    const movedPath = path.join(movedDirectory, "renamed-before-backfill.jpg");
    await mkdir(mediaRoot);
    await writeFile(originalPath, "legacy media bytes with a unique size");

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots);
      const legacy = db
        .prepare(
          `SELECT id, size_bytes, mtime_ms
           FROM assets
           WHERE name = ?`
        )
        .get("legacy-name.jpg") as {
        id: string;
        size_bytes: number;
        mtime_ms: number;
      };

      // A v13 row has no strong content digest and stores size + mtime as its
      // weak fingerprint. The file then moves before v14 can baseline it.
      db.prepare(
        `UPDATE assets
         SET content_sha256 = NULL, fingerprint = ?
         WHERE id = ?`
      ).run(`${legacy.size_bytes}:${legacy.mtime_ms}`, legacy.id);
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: legacy.id,
        score: 82,
        favorite: true,
        updatedAt
      });
      setAssetTags(db, legacy.id, ["Legacy metadata"], updatedAt);

      await mkdir(movedDirectory);
      await rename(originalPath, movedPath);
      const result = await scanLibrary(db, config.mediaRoots);

      expect(result).toMatchObject({ errors: 0, removedAssets: 0 });
      expect(getAsset(db, legacy.id)).toMatchObject({
        id: legacy.id,
        name: "renamed-before-backfill.jpg",
        score: 82,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Legacy metadata" })]
      });
      expect(
        db
          .prepare(
            `SELECT relative_path, content_sha256
             FROM assets
             WHERE id = ?`
          )
          .get(legacy.id)
      ).toEqual({
        relative_path: "archive/renamed-before-backfill.jpg",
        content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM assets").get()).toEqual({
        count: 1
      });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("lets two byte-identical identities safely swap paths in one scan", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-path-swap-"));
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);
    const alphaPath = path.join(mediaRoot, "alpha.jpg");
    const bravoPath = path.join(mediaRoot, "bravo.jpg");
    const temporaryPath = path.join(mediaRoot, "swap-in-progress.tmp");
    await writeFile(alphaPath, "identical content for both assets");
    await writeFile(bravoPath, "identical content for both assets");

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots);
      const originalAssets = db
        .prepare("SELECT id, name FROM assets ORDER BY name")
        .all() as Array<{ id: string; name: string }>;
      const alphaId = originalAssets.find(
        (asset) => asset.name === "alpha.jpg"
      )!.id;
      const bravoId = originalAssets.find(
        (asset) => asset.name === "bravo.jpg"
      )!.id;
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: alphaId,
        score: 91,
        updatedAt
      });
      updateAssetScore(db, {
        assetId: bravoId,
        score: 37,
        updatedAt
      });
      setAssetTags(db, alphaId, ["Alpha identity"], updatedAt);
      setAssetTags(db, bravoId, ["Bravo identity"], updatedAt);

      await rename(alphaPath, temporaryPath);
      await rename(bravoPath, alphaPath);
      await rename(temporaryPath, bravoPath);

      await expect(scanLibrary(db, config.mediaRoots)).resolves.toMatchObject({
        errors: 0
      });

      expect(getAsset(db, alphaId)).toMatchObject({
        id: alphaId,
        name: "bravo.jpg",
        score: 91,
        tags: [expect.objectContaining({ displayName: "Alpha identity" })]
      });
      expect(getAsset(db, bravoId)).toMatchObject({
        id: bravoId,
        name: "alpha.jpg",
        score: 37,
        tags: [expect.objectContaining({ displayName: "Bravo identity" })]
      });
      expect(
        db
          .prepare(
            "SELECT asset_id, relative_path FROM asset_search ORDER BY asset_id"
          )
          .all()
      ).toEqual(
        [
          { asset_id: alphaId, relative_path: "bravo.jpg" },
          { asset_id: bravoId, relative_path: "alpha.jpg" }
        ].sort((left, right) => left.asset_id.localeCompare(right.asset_id))
      );
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps separate IDs and metadata when identical media moves together", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-ambiguous-move-"));
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);
    const firstPath = path.join(mediaRoot, "first.jpg");
    const secondPath = path.join(mediaRoot, "second.jpg");
    await writeFile(firstPath, "identical media bytes");
    await writeFile(secondPath, "identical media bytes");

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots);
      const originalAssets = db
        .prepare("SELECT id, name FROM assets ORDER BY name")
        .all() as Array<{ id: string; name: string }>;
      const firstId = originalAssets.find(
        (asset) => asset.name === "first.jpg"
      )!.id;
      const secondId = originalAssets.find(
        (asset) => asset.name === "second.jpg"
      )!.id;
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: firstId,
        score: 99,
        favorite: true,
        updatedAt
      });
      updateAssetScore(db, {
        assetId: secondId,
        score: 44,
        favorite: true,
        updatedAt
      });
      setAssetTags(db, firstId, ["First old identity"], updatedAt);
      setAssetTags(db, secondId, ["Second old identity"], updatedAt);

      const movedDirectory = path.join(mediaRoot, "moved");
      await mkdir(movedDirectory);
      await rename(firstPath, path.join(movedDirectory, "renamed-one.jpg"));
      await rename(secondPath, path.join(movedDirectory, "renamed-two.jpg"));
      const result = await scanLibrary(db, config.mediaRoots);

      expect(result).toMatchObject({ errors: 0, removedAssets: 0 });
      expect(getAsset(db, firstId)).toMatchObject({
        id: firstId,
        name: "renamed-one.jpg",
        score: 99,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "First old identity" })]
      });
      expect(getAsset(db, secondId)).toMatchObject({
        id: secondId,
        name: "renamed-two.jpg",
        score: 44,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Second old identity" })]
      });
      expect(
        db
          .prepare(
            "SELECT id, relative_path FROM assets ORDER BY relative_path"
          )
          .all()
      ).toEqual([
        { id: firstId, relative_path: "moved/renamed-one.jpg" },
        { id: secondId, relative_path: "moved/renamed-two.jpg" }
      ]);
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not delete metadata when a file crosses directories during discovery", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-scan-race-"));
    const mediaRoot = path.join(cwd, "media");
    const destinationDirectory = path.join(mediaRoot, "a-destination");
    const sourceDirectory = path.join(mediaRoot, "z-source");
    const originalPath = path.join(sourceDirectory, "original.jpg");
    const movedPath = path.join(destinationDirectory, "moved.jpg");
    await mkdir(destinationDirectory, { recursive: true });
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(originalPath, "media moved during discovery");
    const canonicalDestinationDirectory = await realpath(destinationDirectory);

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots);
      const original = db
        .prepare("SELECT id FROM assets WHERE relative_path = ?")
        .get("z-source/original.jpg") as { id: string };
      const updatedAt = new Date().toISOString();
      updateAssetScore(db, {
        assetId: original.id,
        score: 87,
        favorite: true,
        updatedAt
      });
      setAssetTags(db, original.id, ["Race-safe"], updatedAt);

      let moved = false;
      const raced = await scanLibrary(
        db,
        config.mediaRoots,
        undefined,
        undefined,
        undefined,
        {
          afterDirectorySnapshot: async (absolutePath) => {
            if (!moved && absolutePath === canonicalDestinationDirectory) {
              moved = true;
              await rename(originalPath, movedPath);
            }
          }
        }
      );

      expect(moved).toBe(true);
      expect(raced.errors).toBeGreaterThan(0);
      expect(raced.removedAssets).toBe(0);
      expect(
        db
          .prepare("SELECT id, relative_path FROM assets WHERE id = ?")
          .get(original.id)
      ).toEqual({ id: original.id, relative_path: "z-source/original.jpg" });
      expect(getAsset(db, original.id)).toMatchObject({
        score: 87,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Race-safe" })]
      });

      const clean = await scanLibrary(db, config.mediaRoots);
      expect(clean).toMatchObject({ errors: 0, removedAssets: 0 });
      expect(
        db
          .prepare("SELECT id, relative_path FROM assets WHERE id = ?")
          .get(original.id)
      ).toEqual({ id: original.id, relative_path: "a-destination/moved.jpg" });
      expect(getAsset(db, original.id)).toMatchObject({
        score: 87,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Race-safe" })]
      });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("updates tag usage and removes orphaned tags after genuine deletion", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-tag-cleanup-"));
    const mediaRoot = path.join(cwd, "media");
    await mkdir(mediaRoot);
    const removedPath = path.join(mediaRoot, "removed.jpg");
    await writeFile(removedPath, "removed media bytes");
    await writeFile(path.join(mediaRoot, "survivor.jpg"), "surviving media");

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data"
      },
      cwd
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots);
      const assets = db.prepare("SELECT id, name FROM assets").all() as Array<{
        id: string;
        name: string;
      }>;
      const removedId = assets.find(
        (asset) => asset.name === "removed.jpg"
      )!.id;
      const survivorId = assets.find(
        (asset) => asset.name === "survivor.jpg"
      )!.id;
      const updatedAt = new Date().toISOString();
      setAssetTags(db, removedId, ["Shared", "Only removed"], updatedAt);
      setAssetTags(db, survivorId, ["Shared"], updatedAt);

      expect(
        db
          .prepare(
            "SELECT display_name, usage_count FROM tags ORDER BY display_name"
          )
          .all()
      ).toEqual([
        { display_name: "Only removed", usage_count: 1 },
        { display_name: "Shared", usage_count: 2 }
      ]);

      await rm(removedPath);
      const result = await scanLibrary(db, config.mediaRoots);

      expect(result.removedAssets).toBe(1);
      expect(
        db
          .prepare(
            "SELECT display_name, usage_count FROM tags ORDER BY display_name"
          )
          .all()
      ).toEqual([{ display_name: "Shared", usage_count: 1 }]);
      expect(db.prepare("SELECT asset_id FROM asset_tags").all()).toEqual([
        { asset_id: survivorId }
      ]);
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
