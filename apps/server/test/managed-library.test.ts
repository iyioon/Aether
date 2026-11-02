import { appendFile, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import {
  initializeDataDirectory,
  resolveDataPaths
} from "../src/config/data-directory.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { resolveAssetFile } from "../src/library/media-serving.js";
import { withLibraryMutationLock } from "../src/library/library-mutation-lock.js";
import { FileOperationsFilesystem } from "../src/library/file-operations-filesystem.js";
import { getComparisonGeneration } from "../src/library/comparison-generation.js";
import {
  commitAssetLocation,
  commitFolderLocation,
  createManagedOperation,
  getLibraryRevision,
  getManagedAsset,
  getManagedFolder,
  getManagedOperation,
  getWriteReconciliationRequired,
  getTrashRecord,
  ManagementConflictError,
  markTrashed,
  purgeTrashedAsset,
  restoreTrashedAsset,
  saveManagedRootOwnership,
  updateManagedOperation
} from "../src/library/repository-management.js";
import {
  folderIdFor,
  getAsset,
  listAssets,
  listFolders,
  recordComparisonDecision,
  setAssetTags,
  suggestTags,
  updateAssetScore,
  undoComparisonDecision
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";
import {
  assertNoFileManagementBlockers,
  fileManagementBlockers
} from "../src/maintenance/file-management.js";
import { createConfigBackup } from "../src/maintenance/backup.js";
import { restoreDataDirectory } from "../src/maintenance/restore.js";

describe("managed library records", () => {
  let cwd: string;
  let config: AppConfig;
  let db: AetherDatabase;
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "aether-managed-"));
    await mkdir(path.join(cwd, "media", "source", "child"), {
      recursive: true
    });
    await mkdir(path.join(cwd, "media", "destination"));
    await sharp({
      create: { width: 12, height: 8, channels: 3, background: "#55aa88" }
    })
      .jpeg()
      .toFile(path.join(cwd, "media", "source", "child", "photo.jpg"));
    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "library=./media",
        AETHER_WRITABLE_ROOTS: "library",
        AETHER_DATA_DIR: "./data"
      },
      cwd
    );
    db = openDatabase(config.configDir);
    await scanLibrary(db, config.mediaRoots);
  });
  afterEach(async () => {
    db.close();
    await rm(cwd, { recursive: true, force: true });
  });
  function assets() {
    return listAssets(db, {
      folderId: folderIdFor(config.mediaRoots[0]!.id, ""),
      offset: 0,
      limit: 100,
      sort: "filename",
      type: "all",
      recursive: true
    })!;
  }

  it("changes query revision for metadata while keeping the source version stable", () => {
    const asset = assets().items[0]!;
    const revision = getLibraryRevision(db);
    updateAssetScore(db, {
      assetId: asset.id,
      score: 8,
      updatedAt: new Date().toISOString()
    });
    expect(getLibraryRevision(db)).not.toBe(revision);
    expect(getManagedAsset(db, asset.id)?.sourceVersion).toBe(
      asset.sourceVersion
    );
    expect(assets().page.revision).toBe(getLibraryRevision(db));
  });

  it("preserves a moved asset and rejects an obsolete source version", async () => {
    const asset = assets().items[0]!;
    setAssetTags(db, asset.id, ["Travel"]);
    const destination = listFolders(db).find(
      (folder) => folder.relativePath === "destination"
    )!;
    await rename(
      path.join(cwd, "media", "source", "child", "photo.jpg"),
      path.join(cwd, "media", "destination", "photo.jpg")
    );
    const moved = commitAssetLocation(db, {
      assetId: asset.id,
      expectedVersion: asset.sourceVersion!,
      rootId: destination.rootId,
      folderId: destination.id,
      relativePath: "destination/photo.jpg",
      name: "photo.jpg"
    });
    expect(moved.id).toBe(asset.id);
    expect(moved.tags.map((tag) => tag.displayName)).toEqual(["Travel"]);
    expect(moved.sourceVersion).not.toBe(asset.sourceVersion);
    expect(() =>
      commitAssetLocation(db, {
        assetId: asset.id,
        expectedVersion: asset.sourceVersion!,
        rootId: destination.rootId,
        folderId: destination.id,
        relativePath: "destination/other.jpg",
        name: "other.jpg"
      })
    ).toThrow(ManagementConflictError);
    await scanLibrary(db, config.mediaRoots);
    expect(assets().items.map((item) => item.id)).toEqual([asset.id]);
  });

  it("keeps renamed subtree identities through a scan and recreation of its former name", async () => {
    const folder = listFolders(db).find(
      (item) => item.relativePath === "source"
    )!;
    const child = listFolders(db).find(
      (item) => item.relativePath === "source/child"
    )!;
    const asset = assets().items[0]!;
    const managed = getManagedFolder(db, folder.id)!;
    expect(managed.fsInode).toBe(
      String(
        (await stat(path.join(cwd, "media", "source"), { bigint: true })).ino
      )
    );
    await rename(
      path.join(cwd, "media", "source"),
      path.join(cwd, "media", "renamed")
    );
    commitFolderLocation(db, {
      folderId: folder.id,
      expectedVersion: managed.sourceVersion,
      rootId: folder.rootId,
      parentId: folderIdFor(folder.rootId, ""),
      relativePath: "renamed",
      name: "renamed"
    });
    await mkdir(path.join(cwd, "media", "source"));
    await scanLibrary(db, config.mediaRoots);
    expect(
      listFolders(db).find((item) => item.relativePath === "renamed")?.id
    ).toBe(folder.id);
    expect(
      listFolders(db).find((item) => item.relativePath === "renamed/child")?.id
    ).toBe(child.id);
    expect(
      listFolders(db).find((item) => item.relativePath === "source")?.id
    ).not.toBe(folder.id);
    expect(getManagedAsset(db, asset.id)?.relativePath).toBe(
      "renamed/child/photo.jpg"
    );
    expect(getAsset(db, asset.id)?.folderId).toBe(child.id);
  });

  it("excludes Trash from ordinary reads and scanning while retaining its tags and original pathname", async () => {
    const asset = assets().items[0]!;
    setAssetTags(db, asset.id, ["Retained"]);
    await mkdir(path.join(cwd, "media", ".aether-trash"));
    await rename(
      path.join(cwd, "media", "source", "child", "photo.jpg"),
      path.join(cwd, "media", ".aether-trash", "trash-one")
    );
    const trash = markTrashed(db, {
      assetId: asset.id,
      expectedVersion: asset.sourceVersion!,
      trashId: "trash-one",
      physicalRelativePath: ".aether-trash/trash-one",
      expiresAt: "2099-01-01T00:00:00Z"
    });
    expect(getAsset(db, asset.id)).toBeNull();
    expect(await resolveAssetFile(db, asset.id)).toBeNull();
    expect(assets().page.total).toBe(0);
    expect(suggestTags(db, { query: "", limit: 10 })).toEqual([]);
    expect(fileManagementBlockers(config.configDir).trash).toBe(1);
    expect(() => assertNoFileManagementBlockers(config.configDir)).toThrow(
      "Trash"
    );
    await scanLibrary(db, config.mediaRoots);
    expect(getTrashRecord(db, trash.id)?.assetId).toBe(asset.id);
    const destination = listFolders(db).find(
      (item) => item.relativePath === "destination"
    )!;
    await rename(
      path.join(cwd, "media", ".aether-trash", "trash-one"),
      path.join(cwd, "media", "destination", "restored.jpg")
    );
    const restored = restoreTrashedAsset(db, {
      trashId: trash.id,
      expectedVersion: trash.sourceVersion,
      rootId: destination.rootId,
      folderId: destination.id,
      relativePath: "destination/restored.jpg",
      name: "restored.jpg"
    });
    expect(restored.id).toBe(asset.id);
    expect(restored.tags.map((tag) => tag.displayName)).toEqual(["Retained"]);
    expect(getTrashRecord(db, trash.id)).toBeNull();
    expect(fileManagementBlockers(config.configDir).trash).toBe(0);
  });

  it("retains immutable operation receipts and blocks unresolved maintenance and scans", async () => {
    const initial = createManagedOperation(db, {
      id: "request-one",
      requestJson: '{"type":"move"}',
      stateJson: "{}"
    });
    expect(initial.created).toBe(true);
    expect(
      createManagedOperation(db, {
        id: "request-one",
        requestJson: '{"type":"move"}',
        stateJson: "{}"
      }).created
    ).toBe(false);
    expect(() =>
      createManagedOperation(db, {
        id: "request-one",
        requestJson: '{"type":"trash"}',
        stateJson: "{}"
      })
    ).toThrow("request_id_conflict");
    expect((await scanLibrary(db, config.mediaRoots)).outcome).toBe(
      "incomplete"
    );
    expect(assets().page.total).toBe(1);
    expect(() => assertNoFileManagementBlockers(config.configDir)).toThrow();
    updateManagedOperation(db, initial.record.id, {
      status: "completed",
      stateJson: '{"result":"moved"}'
    });
    expect(getManagedOperation(db, initial.record.id)?.stateJson).toBe(
      '{"result":"moved"}'
    );
    expect(() =>
      assertNoFileManagementBlockers(config.configDir)
    ).not.toThrow();
  });

  it("serializes scans with mutation work without holding a database transaction", async () => {
    const events: string[] = [];
    let release!: () => void;
    const mutation = withLibraryMutationLock(db, async () => {
      events.push("mutation");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      events.push("commit");
    });
    await Promise.resolve();
    const scan = scanLibrary(db, config.mediaRoots, () => {
      events.push("scan");
    });
    await Promise.resolve();
    expect(events).toEqual(["mutation"]);
    release();
    await Promise.all([mutation, scan]);
    expect(events.indexOf("scan")).toBeGreaterThan(events.indexOf("commit"));
  });

  it("removes metadata only for the expected trashed source", () => {
    const asset = assets().items[0]!;
    const trash = markTrashed(db, {
      assetId: asset.id,
      expectedVersion: asset.sourceVersion!,
      trashId: "purge-one",
      physicalRelativePath: ".aether-trash/purge-one",
      expiresAt: "2099-01-01T00:00:00Z"
    });
    expect(() => purgeTrashedAsset(db, trash.id, asset.sourceVersion!)).toThrow(
      ManagementConflictError
    );
    expect(purgeTrashedAsset(db, trash.id, trash.sourceVersion)).toBe(true);
    expect(getManagedAsset(db, asset.id)).toBeNull();
  });

  it("suspends inactive ranking preferences and preserves manual edits when they return", async () => {
    await sharp({
      create: { width: 12, height: 8, channels: 3, background: "#aabb22" }
    })
      .jpeg()
      .toFile(path.join(cwd, "media", "destination", "second.jpg"));
    await scanLibrary(db, config.mediaRoots);
    const [first, second] = assets().items;
    const vote = {
      leftAssetId: first!.id,
      rightAssetId: second!.id,
      winnerAssetId: first!.id,
      createdAt: new Date().toISOString(),
      mutationId: "retained-vote",
      comparisonGeneration: getComparisonGeneration(db)
    };
    const decision = recordComparisonDecision(db, vote)!;
    updateAssetScore(db, {
      assetId: first!.id,
      score: 17,
      updatedAt: new Date().toISOString()
    });
    updateAssetScore(db, {
      assetId: second!.id,
      score: 24,
      updatedAt: new Date().toISOString()
    });
    const source = getManagedAsset(db, first!.id)!;
    const trash = markTrashed(db, {
      assetId: first!.id,
      expectedVersion: source.sourceVersion,
      trashId: "ranked-trash",
      physicalRelativePath: ".aether-trash/ranked/payload",
      expiresAt: "2099-01-01T00:00:00Z"
    });
    expect(getAsset(db, second!.id)?.ranking).toBeNull();
    expect(recordComparisonDecision(db, vote)).toEqual(decision);
    expect(
      recordComparisonDecision(db, { ...vote, mutationId: "new-inactive-vote" })
    ).toBeNull();
    expect(
      undoComparisonDecision(
        db,
        decision.eventId,
        new Date().toISOString(),
        "inactive-undo",
        vote.comparisonGeneration
      )
    ).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM pair_preferences").get()
    ).toEqual({ count: 1 });
    updateAssetScore(db, {
      assetId: second!.id,
      score: 0,
      updatedAt: new Date().toISOString()
    });
    const folder = listFolders(db).find(
      (item) => item.relativePath === "destination"
    )!;
    restoreTrashedAsset(db, {
      trashId: trash.id,
      expectedVersion: trash.sourceVersion,
      rootId: folder.rootId,
      folderId: folder.id,
      relativePath: "destination/restored-ranked.jpg",
      name: "restored-ranked.jpg"
    });
    expect(getAsset(db, first!.id)?.score).toBe(17);
    expect(getAsset(db, second!.id)?.score).toBe(0);
  });

  it("rejects a backup during unresolved work and retains completed receipts without replay after restore", async () => {
    createManagedOperation(db, {
      id: "backup-operation",
      requestJson: '{"type":"move"}',
      stateJson: "{}"
    });
    await expect(
      createConfigBackup({
        configDir: config.configDir,
        outputDir: path.join(cwd, "backups")
      })
    ).rejects.toThrow("Finish or cancel");
    updateManagedOperation(db, "backup-operation", {
      status: "completed",
      stateJson: '{"items":[]}'
    });
    const backup = await createConfigBackup({
      configDir: config.configDir,
      outputDir: path.join(cwd, "backups")
    });
    const paths = resolveDataPaths({ AETHER_DATA_DIR: "restored-data" }, cwd);
    await initializeDataDirectory(paths);
    const empty = openDatabase(paths.configDir);
    empty.close();
    await restoreDataDirectory({
      paths,
      workspaceRoot: cwd,
      backupDir: backup.backupDir,
      mediaRootPaths: config.mediaRoots.map((root) => root.realPath)
    });
    const restored = openDatabase(paths.configDir);
    try {
      expect(getManagedOperation(restored, "backup-operation")?.status).toBe(
        "cancelled"
      );
      expect(
        JSON.parse(getManagedOperation(restored, "backup-operation")!.stateJson)
      ).toMatchObject({ invalidatedByRestore: true });
      expect(getWriteReconciliationRequired(restored)).toBe(true);
      await scanLibrary(restored, config.mediaRoots);
      expect(getWriteReconciliationRequired(restored)).toBe(false);
    } finally {
      restored.close();
    }
  });

  it("backs up and restores verified Trash metadata while rejecting a changed payload", async () => {
    const asset = assets().items[0]!;
    const source = getManagedAsset(db, asset.id)!;
    const root = config.mediaRoots[0]!;
    const filesystem = new FileOperationsFilesystem();
    const rootIdentity = await filesystem.inspectRoot(root.realPath);
    const location = (relativePath: string) => ({
      rootPath: root.realPath,
      relativePath,
      expectedRoot: rootIdentity
    });
    const trashDirectory = await filesystem.createDirectory(
      location(".aether-trash")
    );
    await filesystem.createDirectory(location(".aether-trash/operation"));
    saveManagedRootOwnership(db, {
      rootId: root.id,
      deviceId: rootIdentity.dev,
      inode: rootIdentity.ino,
      trashInode: trashDirectory.ino
    });
    const manifest = await filesystem.inventory(location(source.relativePath));
    const actual = await filesystem.rename(
      location(source.relativePath),
      location(".aether-trash/operation/payload"),
      manifest.entries[0]!.identity
    );
    const trash = markTrashed(db, {
      assetId: asset.id,
      expectedVersion: asset.sourceVersion!,
      trashId: "verified-trash",
      physicalRelativePath: ".aether-trash/operation/payload",
      expiresAt: "2099-01-01T00:00:00Z",
      identity: {
        sizeBytes: Number(actual.size),
        mtimeMs: Number(BigInt(actual.mtimeNs) / 1_000_000n),
        fsDeviceId: actual.dev,
        fsInode: actual.ino,
        fsBirthtimeNs: null,
        fsCtimeNs: actual.ctimeNs
      },
      contentSha256: manifest.entries[0]!.sha256!
    });
    const backup = await createConfigBackup({
      configDir: config.configDir,
      outputDir: path.join(cwd, "backups"),
      now: new Date("2026-11-02T00:00:00Z")
    });
    const paths = resolveDataPaths(
      { AETHER_DATA_DIR: "trash-restored-data" },
      cwd
    );
    await initializeDataDirectory(paths);
    const empty = openDatabase(paths.configDir);
    empty.close();
    await restoreDataDirectory({
      paths,
      workspaceRoot: cwd,
      backupDir: backup.backupDir,
      mediaRootPaths: [root.realPath]
    });
    const restored = openDatabase(paths.configDir);
    try {
      expect(getTrashRecord(restored, trash.id)?.assetId).toBe(asset.id);
    } finally {
      restored.close();
    }
    await appendFile(
      path.join(root.realPath, ".aether-trash", "operation", "payload"),
      "changed"
    );
    await expect(
      createConfigBackup({
        configDir: config.configDir,
        outputDir: path.join(cwd, "backups"),
        now: new Date("2026-11-02T00:00:01Z")
      })
    ).rejects.toThrow("could not be verified");
  });
});
