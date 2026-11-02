import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import {
  FileOperationFilesystemError,
  FileOperationsFilesystem,
  type FileOperationIdentity,
  type FileOperationLocation
} from "../src/library/file-operations-filesystem.js";
import {
  FileOperationManager,
  type FileOperationReceipt
} from "../src/library/file-operations.js";
import {
  FileOperationBody,
  type FileOperationRequest
} from "../src/library/file-operation-model.js";
import {
  getAsset,
  listFolders,
  setAssetTags,
  updateAssetScore
} from "../src/library/repository.js";
import {
  getManagedAsset,
  getManagedFolder,
  getManagedOperation,
  createManagedOperation,
  createEmptyTrashOperation,
  countTrash,
  getLibraryRevision,
  getTrashRecord,
  listTrash,
  updateManagedOperation
} from "../src/library/repository-management.js";
import { scanLibrary } from "../src/library/scanner.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const hasCrossDevice = statSync(repositoryRoot).dev !== statSync(tmpdir()).dev;

describe.skipIf(process.platform !== "linux")(
  "durable file operations",
  { timeout: 15_000 },
  () => {
    let directory: string;
    let externalDirectory: string;
    let config: AppConfig;
    let db: AetherDatabase;
    let manager: FileOperationManager;
    let sourceRoot: AppConfig["mediaRoots"][number];
    let targetRoot: AppConfig["mediaRoots"][number];
    let crossRoot: AppConfig["mediaRoots"][number];
    let photoId: string;
    let nestedId: string;
    let tripId: string;
    let targetFolderId: string;
    let crossFolderId: string;

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "aether-managed-files-"));
      const artifactRoot = path.join(repositoryRoot, ".local-test-artifacts");
      await mkdir(artifactRoot, { recursive: true });
      externalDirectory = await mkdtemp(
        path.join(artifactRoot, "file-operation-proof-")
      );
      await mkdir(path.join(directory, "source/trip/nested"), {
        recursive: true
      });
      await mkdir(path.join(directory, "source/trip/empty"));
      await mkdir(path.join(directory, "target"));
      await writeFile(
        path.join(directory, "source/photo.jpg"),
        "original photo"
      );
      await writeFile(
        path.join(directory, "source/trip/nested/nested.jpg"),
        "nested media"
      );
      await writeFile(
        path.join(directory, "source/trip/.sidecar"),
        "unindexed sidecar"
      );
      config = await loadConfig(
        {
          AETHER_MEDIA_ROOTS: `source=./source,target=./target,cross=${externalDirectory}`,
          AETHER_WRITABLE_ROOTS: "source,target,cross",
          AETHER_DATA_DIR: "./data",
          NODE_ENV: "test"
        },
        directory
      );
      db = openDatabase(config.configDir);
      const scan = await scanLibrary(db, config.mediaRoots);
      expect(scan.outcome).toBe("completed");
      sourceRoot = config.mediaRoots.find((root) => root.label === "source")!;
      targetRoot = config.mediaRoots.find((root) => root.label === "target")!;
      crossRoot = config.mediaRoots.find((root) => root.label === "cross")!;
      const row = (name: string) =>
        (
          db.prepare("SELECT id FROM assets WHERE name = ?").get(name) as {
            id: string;
          }
        ).id;
      photoId = row("photo.jpg");
      nestedId = row("nested.jpg");
      tripId = listFolders(db).find(
        (folder) =>
          folder.rootId === sourceRoot.id && folder.relativePath === "trip"
      )!.id;
      targetFolderId = listFolders(db).find(
        (folder) =>
          folder.rootId === targetRoot.id && folder.relativePath === ""
      )!.id;
      crossFolderId = listFolders(db).find(
        (folder) => folder.rootId === crossRoot.id && folder.relativePath === ""
      )!.id;
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.rootStatus(sourceRoot.id)).toEqual({
        writable: true,
        reason: null
      });
    });

    afterEach(async () => {
      await manager?.close();
      db?.close();
      await rm(directory, { recursive: true, force: true });
      await rm(externalDirectory, { recursive: true, force: true });
    });

    it("previews all folder contents and rejects a changed inventory before moving", async () => {
      const preview = await manager.inspectFolder(
        tripId,
        folderVersion(tripId)
      );
      expect(preview).toMatchObject({ files: 2, folders: 2 });
      expect(preview.totalBytes).toBe(
        Buffer.byteLength("nested mediaunindexed sidecar")
      );
      expect(preview.inventoryVersion).toMatch(/^[a-f0-9]{64}$/);
      await writeFile(
        path.join(sourceRoot.realPath, "trip/.sidecar"),
        "changed sidecar"
      );
      const result = await run(
        request("move-folder", {
          items: [{ folderId: tripId, expectedVersion: folderVersion(tripId) }],
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId),
          expectedInventoryVersion: preview.inventoryVersion
        })
      );
      expect(result).toMatchObject({
        status: "failed",
        items: [{ errorCode: "folder_changed" }]
      });
      expect(
        await readFile(path.join(sourceRoot.realPath, "trip/.sidecar"), "utf8")
      ).toBe("changed sidecar");
      await expect(
        stat(path.join(targetRoot.realPath, "trip"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("moves media in place and preserves IDs, score, favorite and tags through a rescan", async () => {
      updateAssetScore(db, {
        assetId: photoId,
        score: 71,
        favorite: true,
        updatedAt: new Date().toISOString()
      });
      setAssetTags(db, photoId, ["Travel"], new Date().toISOString());
      const result = await run(
        request("move-media", {
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId),
          items: [assetItem(photoId)]
        })
      );
      expect(result.status).toBe("completed");
      expect(result.items[0]?.asset).toMatchObject({
        id: photoId,
        score: 71,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Travel" })]
      });
      expect(
        await readFile(path.join(targetRoot.realPath, "photo.jpg"), "utf8")
      ).toBe("original photo");
      await expect(
        stat(path.join(sourceRoot.realPath, "photo.jpg"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await scanLibrary(db, config.mediaRoots);
      expect(getManagedAsset(db, photoId)).toMatchObject({
        rootId: targetRoot.id,
        relativePath: "photo.jpg"
      });
      expect(getAsset(db, photoId)).toMatchObject({
        score: 71,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Travel" })]
      });
    });

    it("renames media without changing its extension or ID", async () => {
      const result = await run(
        request("rename-media", { items: [assetItem(photoId)], name: "Summer" })
      );
      expect(result.status).toBe("completed");
      expect(result.items[0]?.asset).toMatchObject({
        id: photoId,
        name: "Summer.jpg"
      });
      await scanLibrary(db, config.mediaRoots);
      expect(getManagedAsset(db, photoId)?.relativePath).toBe("Summer.jpg");
    });

    it("hydrates current receipt metadata and omits assets that have since entered Trash", async () => {
      const renamed = await run(
        request("rename-media", {
          items: [assetItem(photoId)],
          name: "Current"
        })
      );
      updateAssetScore(db, {
        assetId: photoId,
        score: 83,
        updatedAt: new Date().toISOString()
      });
      setAssetTags(db, photoId, ["Current tag"]);
      expect(manager.get(renamed.id)?.items[0]?.asset).toMatchObject({
        score: 83,
        tags: [expect.objectContaining({ displayName: "Current tag" })]
      });
      const created = await run(
        request("create-folder", {
          items: [],
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId),
          name: "First"
        })
      );
      const folderId = created.items[0]!.folder!.id;
      await run(
        request("rename-folder", {
          items: [folderItem(folderId)],
          name: "Second"
        })
      );
      expect(manager.get(created.id)?.items[0]?.folder?.name).toBe("Second");
      await run(request("trash", { items: [assetItem(photoId)] }));
      expect(manager.get(renamed.id)?.items[0]).toMatchObject({
        assetId: photoId,
        status: "completed"
      });
      expect(manager.get(renamed.id)?.items[0]?.asset).toBeUndefined();
    });

    it("rejects a missing indexed folder before creation and permits a fresh request after scanning", async () => {
      const parentId = listFolders(db).find(
        (folder) =>
          folder.rootId === sourceRoot.id && folder.relativePath === ""
      )!.id;
      const destination = path.join(sourceRoot.realPath, "trip");
      await rm(destination, { recursive: true });
      const operation = request("create-folder", {
        items: [],
        destinationFolderId: parentId,
        expectedParentVersion: folderVersion(parentId),
        name: "trip"
      });
      const failed = await run(operation);
      expect(failed).toMatchObject({
        status: "failed",
        items: [{ errorCode: "destination_exists" }]
      });
      await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
      expect(getManagedFolder(db, tripId)?.relativePath).toBe("trip");
      expect(manager.submit(operation)).toMatchObject({
        id: operation.requestId,
        status: "failed"
      });
      expect((await scanLibrary(db, config.mediaRoots)).outcome).toBe(
        "completed"
      );
      expect(getManagedFolder(db, tripId)).toBeNull();
      const created = await run(
        request("create-folder", {
          items: [],
          destinationFolderId: parentId,
          expectedParentVersion: folderVersion(parentId),
          name: "trip"
        })
      );
      expect(created.status).toBe("completed");
      expect((await stat(destination)).isDirectory()).toBe(true);
      expect(created.items[0]?.folder?.id).not.toBe(tripId);
    });

    it("creates an empty managed folder that remains after rescanning", async () => {
      const result = await run(
        request("create-folder", {
          items: [],
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId),
          name: "Empty"
        })
      );
      expect(result.status).toBe("completed");
      const createdId = result.items[0]?.folder?.id;
      expect(createdId).toBeTruthy();
      await scanLibrary(db, config.mediaRoots);
      expect(getManagedFolder(db, createdId!)).toMatchObject({
        name: "Empty",
        relativePath: "Empty",
        assetCount: 0
      });
    });

    it("renames and moves a whole folder with stable subtree IDs and unindexed contents", async () => {
      const originalIds = listFolders(db)
        .filter(
          (folder) =>
            folder.rootId === sourceRoot.id &&
            folder.relativePath.startsWith("trip")
        )
        .map((folder) => folder.id)
        .sort();
      const renamed = await run(
        request("rename-folder", {
          items: [folderItem(tripId)],
          name: "Holiday"
        })
      );
      expect(renamed.status).toBe("completed");
      const moved = await run(
        request("move-folder", {
          items: [folderItem(tripId)],
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId)
        })
      );
      expect(moved.status).toBe("completed");
      expect(
        await readFile(
          path.join(targetRoot.realPath, "Holiday/.sidecar"),
          "utf8"
        )
      ).toBe("unindexed sidecar");
      expect(
        (
          await stat(path.join(targetRoot.realPath, "Holiday/empty"))
        ).isDirectory()
      ).toBe(true);
      await scanLibrary(db, config.mediaRoots);
      expect(getManagedAsset(db, nestedId)).toMatchObject({
        rootId: targetRoot.id,
        relativePath: "Holiday/nested/nested.jpg"
      });
      expect(
        listFolders(db)
          .filter(
            (folder) =>
              folder.rootId === targetRoot.id &&
              folder.relativePath.startsWith("Holiday")
          )
          .map((folder) => folder.id)
          .sort()
      ).toEqual(originalIds);
    });

    it.skipIf(!hasCrossDevice)(
      "moves a complete tree across actual filesystems before retiring only the verified original",
      async () => {
        const result = await run(
          request("move-folder", {
            items: [folderItem(tripId)],
            destinationFolderId: crossFolderId,
            expectedParentVersion: folderVersion(crossFolderId)
          })
        );
        expect(result.status).toBe("completed");
        expect(
          await readFile(
            path.join(crossRoot.realPath, "trip/nested/nested.jpg"),
            "utf8"
          )
        ).toBe("nested media");
        expect(
          await readFile(path.join(crossRoot.realPath, "trip/.sidecar"), "utf8")
        ).toBe("unindexed sidecar");
        await expect(
          stat(path.join(sourceRoot.realPath, "trip"))
        ).rejects.toMatchObject({ code: "ENOENT" });
        await scanLibrary(db, config.mediaRoots);
        expect(getManagedAsset(db, nestedId)).toMatchObject({
          rootId: crossRoot.id,
          relativePath: "trip/nested/nested.jpg"
        });
      }
    );

    it("does not replace colliding names and uses a new request for keep-both", async () => {
      await writeFile(
        path.join(targetRoot.realPath, "photo.jpg"),
        "destination original"
      );
      const skipped = await run(
        request("move-media", {
          items: [assetItem(photoId)],
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId)
        })
      );
      expect(skipped).toMatchObject({
        status: "failed",
        items: [{ errorCode: "destination_exists" }]
      });
      expect(
        await readFile(path.join(targetRoot.realPath, "photo.jpg"), "utf8")
      ).toBe("destination original");
      const kept = await run(
        request("move-media", {
          items: [assetItem(photoId)],
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId),
          conflict: "keep-both"
        })
      );
      expect(kept.status).toBe("completed");
      expect(kept.items[0]?.asset?.name).toBe("photo (2).jpg");
    });

    it("replays identical requests without repeating writes and rejects a changed intent", async () => {
      const original = request("rename-media", {
        items: [assetItem(photoId)],
        name: "Summer"
      });
      const result = await run(original);
      expect(manager.submit(original)).toEqual(result);
      expect(() => manager.submit({ ...original, name: "Winter" })).toThrow(
        "request_id_conflict"
      );
      expect(
        await readFile(path.join(sourceRoot.realPath, "Summer.jpg"), "utf8")
      ).toBe("original photo");
      await expect(
        stat(path.join(sourceRoot.realPath, "Winter.jpg"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects stale API versions and a replaced source that has not been rescanned", async () => {
      const stale = assetItem(photoId);
      await run(request("rename-media", { items: [stale], name: "Summer" }));
      expect(() =>
        manager.submit(request("trash", { items: [stale] }))
      ).toThrow("source_changed");
      await rename(
        path.join(sourceRoot.realPath, "Summer.jpg"),
        path.join(sourceRoot.realPath, "preserved.jpg")
      );
      await writeFile(
        path.join(sourceRoot.realPath, "Summer.jpg"),
        "replacement"
      );
      const result = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      expect(result).toMatchObject({
        status: "failed",
        items: [{ errorCode: "source_changed" }]
      });
      expect(
        await readFile(path.join(sourceRoot.realPath, "Summer.jpg"), "utf8")
      ).toBe("replacement");
      expect(
        await readFile(path.join(sourceRoot.realPath, "preserved.jpg"), "utf8")
      ).toBe("original photo");
    });

    it("returns queued when accepting recovery of the original request so clients keep watching", async () => {
      await manager.close();
      class LostRenameOnce extends FileOperationsFilesystem {
        fail = true;
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          const moved = await super.rename(source, destination, expected);
          if (this.fail) {
            this.fail = false;
            throw new Error("lost acknowledgement");
          }
          return moved;
        }
      }
      manager = new FileOperationManager(config, db, new LostRenameOnce());
      await manager.initialize();
      const operation = request("rename-media", {
        items: [assetItem(photoId)],
        name: "Summer"
      });
      expect((await run(operation)).status).toBe("needs_attention");
      expect(manager.retry(operation.requestId)).toMatchObject({
        id: operation.requestId,
        status: "queued"
      });
      expect((await finished(operation.requestId)).status).toBe("completed");
      expect(getManagedAsset(db, photoId)?.relativePath).toBe("Summer.jpg");
    });

    it("recovers an acknowledged-lost rename from its original durable request", async () => {
      await manager.close();
      class LostRename extends FileOperationsFilesystem {
        fail = true;
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          const moved = await super.rename(source, destination, expected);
          if (this.fail) {
            this.fail = false;
            throw new Error("lost acknowledgement");
          }
          return moved;
        }
      }
      manager = new FileOperationManager(config, db, new LostRename());
      await manager.initialize();
      const operation = request("rename-media", {
        items: [assetItem(photoId)],
        name: "Summer"
      });
      expect((await run(operation)).status).toBe("needs_attention");
      await manager.close();
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.get(operation.requestId)?.status).toBe("completed");
      expect(getManagedAsset(db, photoId)?.relativePath).toBe("Summer.jpg");
    });

    it("retains a source subtree when new host files appear after cross-filesystem publication", async () => {
      if (!hasCrossDevice) return;
      await manager.close();
      class SourceChangesAfterPublication extends FileOperationsFilesystem {
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          const moved = await super.rename(source, destination, expected);
          if (
            source.relativePath.startsWith(".aether-staging/") &&
            destination.relativePath === "trip"
          )
            await writeFile(
              path.join(sourceRoot.realPath, "trip/nested/new-file"),
              "host addition"
            );
          return moved;
        }
      }
      manager = new FileOperationManager(
        config,
        db,
        new SourceChangesAfterPublication()
      );
      await manager.initialize();
      const operation = request("move-folder", {
        items: [folderItem(tripId)],
        destinationFolderId: crossFolderId,
        expectedParentVersion: folderVersion(crossFolderId)
      });
      expect(await run(operation)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "source_changed" }]
      });
      expect(
        await readFile(
          path.join(sourceRoot.realPath, "trip/nested/new-file"),
          "utf8"
        )
      ).toBe("host addition");
      expect(
        await readFile(
          path.join(sourceRoot.realPath, "trip/nested/nested.jpg"),
          "utf8"
        )
      ).toBe("nested media");
      expect(
        await readFile(
          path.join(crossRoot.realPath, "trip/nested/nested.jpg"),
          "utf8"
        )
      ).toBe("nested media");
    });

    it("persists cancellation received during an in-flight item and leaves following items untouched", async () => {
      await manager.close();
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      class PausedRename extends FileOperationsFilesystem {
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          const moved = await super.rename(source, destination, expected);
          entered();
          await blocked;
          return moved;
        }
      }
      manager = new FileOperationManager(config, db, new PausedRename());
      await manager.initialize();
      const operation = request("move-media", {
        items: [assetItem(photoId), assetItem(nestedId)],
        destinationFolderId: targetFolderId,
        expectedParentVersion: folderVersion(targetFolderId)
      });
      manager.submit(operation);
      await started;
      manager.cancel(operation.requestId);
      release();
      const result = await finished(operation.requestId);
      expect(result).toMatchObject({
        status: "partial",
        items: [{ status: "completed" }, { status: "cancelled" }]
      });
      expect(
        await readFile(
          path.join(sourceRoot.realPath, "trip/nested/nested.jpg"),
          "utf8"
        )
      ).toBe("nested media");
    });

    it.skipIf(!hasCrossDevice)(
      "drains committed work on shutdown while rejecting new submissions",
      async () => {
        await manager.close();
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        class PausedCopy extends FileOperationsFilesystem {
          override async copy(
            ...args: Parameters<FileOperationsFilesystem["copy"]>
          ) {
            entered();
            await blocked;
            return super.copy(...args);
          }
        }
        manager = new FileOperationManager(config, db, new PausedCopy());
        await manager.initialize();
        const operation = request("move-media", {
          items: [assetItem(photoId)],
          destinationFolderId: crossFolderId,
          expectedParentVersion: folderVersion(crossFolderId)
        });
        manager.submit(operation);
        await started;
        const closing = manager.close();
        expect(manager.canWrite(sourceRoot.id)).toBe(false);
        expect(() =>
          manager.submit(request("trash", { items: [assetItem(nestedId)] }))
        ).toThrow("server_closing");
        release();
        await closing;
        expect(manager.get(operation.requestId)?.status).toBe("completed");
        expect(
          await readFile(path.join(crossRoot.realPath, "photo.jpg"), "utf8")
        ).toBe("original photo");
      }
    );

    it("trashes, restores and permanently deletes media while keeping restore metadata", async () => {
      updateAssetScore(db, {
        assetId: photoId,
        score: 92,
        favorite: true,
        updatedAt: new Date().toISOString()
      });
      setAssetTags(db, photoId, ["Keep"], new Date().toISOString());
      const trashed = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      expect(trashed.status).toBe("completed");
      const trashId = trashed.items[0]!.trashId!;
      expect(getAsset(db, photoId)).toBeNull();
      const record = getTrashRecord(db, trashId)!;
      expect(record.assetId).toBe(photoId);
      expect(
        await readFile(
          path.join(sourceRoot.realPath, record.physicalRelativePath),
          "utf8"
        )
      ).toBe("original photo");
      const restored = await run(
        request("restore", {
          items: [{ trashId, expectedVersion: record.sourceVersion }]
        })
      );
      expect(restored.status).toBe("completed");
      expect(getAsset(db, photoId)).toMatchObject({
        score: 92,
        favorite: true,
        tags: [expect.objectContaining({ displayName: "Keep" })]
      });
      const secondTrash = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      const secondId = secondTrash.items[0]!.trashId!;
      const secondRecord = getTrashRecord(db, secondId)!;
      const purged = await run(
        request("purge", {
          items: [
            { trashId: secondId, expectedVersion: secondRecord.sourceVersion }
          ]
        })
      );
      expect(purged.status).toBe("completed");
      expect(getManagedAsset(db, photoId)).toBeNull();
      expect(listTrash(db)).toHaveLength(0);
      await expect(
        stat(path.join(sourceRoot.realPath, secondRecord.physicalRelativePath))
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(manager.get(trashed.id)).toBeTruthy();
    });

    it("snapshots every retained item beyond the first page and replays the same Empty Trash receipt", async () => {
      for (let index = 0; index < 103; index++)
        await writeFile(
          path.join(sourceRoot.realPath, `bulk-${index}.jpg`),
          `media ${index}`
        );
      await scanLibrary(db, config.mediaRoots);
      const ids = (
        db
          .prepare("SELECT id FROM assets WHERE lifecycle = 'active'")
          .all() as Array<{ id: string }>
      ).map(({ id }) => id);
      expect(ids).toHaveLength(105);
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = await run(
          request("trash", {
            items: ids.slice(offset, offset + 100).map(assetItem)
          })
        );
        expect(result.status).toBe("completed");
      }
      expect(listTrash(db)).toHaveLength(100);
      expect(listTrash(db, 100, 0, "bulk-")).toHaveLength(100);
      const input = {
        requestId: randomUUID(),
        expectedRevision: getLibraryRevision(db),
        expectedCount: 105
      };
      expect(() =>
        manager.submitEmptyTrash({ ...input, expectedCount: 104 })
      ).toThrow("snapshot_changed");
      expect(getManagedOperation(db, input.requestId)).toBeNull();
      const accepted = manager.submitEmptyTrash(input);
      expect(accepted.summary).toEqual({
        total: 105,
        completed: 0,
        failed: 0,
        cancelled: 0,
        needsAttention: 0
      });
      expect(accepted.items).toHaveLength(100);
      await vi.waitFor(
        () => expect(manager.get(input.requestId)?.status).toBe("completed"),
        { timeout: 30_000, interval: 20 }
      );
      expect(countTrash(db)).toBe(0);
      const replay = manager.submitEmptyTrash(input);
      expect(replay.summary).toEqual({
        total: 105,
        completed: 105,
        failed: 0,
        cancelled: 0,
        needsAttention: 0
      });
      expect(replay.items).toHaveLength(100);
      expect(() =>
        manager.submitEmptyTrash({ ...input, expectedCount: 0 })
      ).toThrow("request_id_conflict");
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM file_operation_items WHERE operation_id = ?"
          )
          .get(input.requestId)
      ).toEqual({ count: 105 });
    }, 60_000);

    it("cancels all unstarted Empty Trash items while retaining every payload", async () => {
      await run(
        request("trash", { items: [assetItem(photoId), assetItem(nestedId)] })
      );
      const input = {
        requestId: randomUUID(),
        expectedRevision: getLibraryRevision(db),
        expectedCount: 2
      };
      manager.submitEmptyTrash(input);
      manager.cancel(input.requestId);
      const result = await finished(input.requestId);
      expect(result).toMatchObject({
        status: "cancelled",
        summary: { total: 2, completed: 0, cancelled: 2 }
      });
      expect(countTrash(db)).toBe(2);
      for (const retained of listTrash(db))
        expect(
          (
            await stat(
              path.join(retained.rootRealPath, retained.physicalRelativePath)
            )
          ).isFile()
        ).toBe(true);
    });

    it("recovers a durable Empty Trash snapshot after restart and excludes later Trash", async () => {
      await run(request("trash", { items: [assetItem(photoId)] }));
      await manager.close();
      const operation = request("empty-trash", {
        expectedRevision: getLibraryRevision(db),
        expectedCount: 1
      });
      createEmptyTrashOperation(db, {
        id: operation.requestId,
        requestJson: JSON.stringify(operation),
        expectedRevision: operation.expectedRevision!,
        expectedCount: 1
      });
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.get(operation.requestId)).toMatchObject({
        status: "completed",
        summary: { total: 1, completed: 1 }
      });
      const later = await run(
        request("trash", { items: [assetItem(nestedId)] })
      );
      expect(later.status).toBe("completed");
      expect(
        manager.submitEmptyTrash({
          requestId: operation.requestId,
          expectedRevision: operation.expectedRevision!,
          expectedCount: 1
        }).summary?.total
      ).toBe(1);
      expect(countTrash(db)).toBe(1);
    });

    it("reports unavailable Empty Trash items while purging available items", async () => {
      await run(
        request("move-media", {
          items: [assetItem(nestedId)],
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId)
        })
      );
      await run(
        request("trash", { items: [assetItem(photoId), assetItem(nestedId)] })
      );
      const retained = listTrash(db).find(
        (record) => record.assetId === nestedId
      )!;
      const disconnected = `${targetRoot.realPath}-disconnected`;
      await rename(targetRoot.realPath, disconnected);
      await manager.refreshCapabilities();
      const accepted = manager.submitEmptyTrash({
        requestId: randomUUID(),
        expectedRevision: getLibraryRevision(db),
        expectedCount: 2
      });
      const result = await finished(accepted.id);
      expect(result).toMatchObject({
        status: "partial",
        summary: { total: 2, completed: 1, failed: 1 }
      });
      expect(countTrash(db)).toBe(1);
      expect(getTrashRecord(db, retained.id)).not.toBeNull();
      expect(
        await readFile(
          path.join(disconnected, retained.physicalRelativePath),
          "utf8"
        )
      ).toBe("nested media");
    });

    it.each(["restore", "purge"] as const)(
      "refuses a replaced Trash payload during %s",
      async (type) => {
        const trashed = await run(
          request("trash", { items: [assetItem(photoId)] })
        );
        const record = getTrashRecord(db, trashed.items[0]!.trashId!)!;
        const payload = path.join(
          record.rootRealPath,
          record.physicalRelativePath
        );
        await rename(payload, `${payload}-original`);
        await writeFile(payload, "original photo");
        const result = await run(
          request(type, {
            items: [
              { trashId: record.id, expectedVersion: record.sourceVersion }
            ]
          })
        );
        expect(result).toMatchObject({
          status: "failed",
          items: [{ errorCode: "source_changed" }]
        });
        expect(getTrashRecord(db, record.id)).not.toBeNull();
        expect(await readFile(payload, "utf8")).toBe("original photo");
        expect(await readFile(`${payload}-original`, "utf8")).toBe(
          "original photo"
        );
      }
    );

    it("recovers restore after its database commit without losing the asset receipt", async () => {
      const trashed = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      const trashId = trashed.items[0]!.trashId!;
      const restored = await run(
        request("restore", {
          items: [
            {
              trashId,
              expectedVersion: getTrashRecord(db, trashId)!.sourceVersion
            }
          ]
        })
      );
      expect(restored.status).toBe("completed");
      const operation = getManagedOperation(db, restored.id)!;
      const journal = JSON.parse(operation.stateJson) as {
        items: Array<{ phase: string; status: string; asset?: unknown }>;
      };
      journal.items[0]!.phase = "published";
      journal.items[0]!.status = "running";
      delete journal.items[0]!.asset;
      updateManagedOperation(db, operation.id, {
        status: "running",
        stateJson: JSON.stringify(journal)
      });
      await manager.close();
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.get(restored.id)).toMatchObject({
        status: "completed",
        items: [{ asset: { id: photoId } }]
      });
    });

    it("does not treat an unexplained missing prepared Trash file as successful purge", async () => {
      const trashed = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      const trashId = trashed.items[0]!.trashId!;
      const trash = getTrashRecord(db, trashId)!;
      const filesystem = new FileOperationsFilesystem();
      const source = {
        rootPath: sourceRoot.realPath,
        relativePath: trash.physicalRelativePath
      };
      const manifest = await filesystem.inventory(source);
      const operation = request("purge", {
        items: [{ trashId, expectedVersion: trash.sourceVersion }]
      });
      db.prepare(
        "INSERT INTO file_operations (id, request_id, type, request_json, status, state_json, created_at, updated_at) VALUES (?, ?, 'purge', ?, 'running', ?, ?, ?)"
      ).run(
        operation.requestId,
        operation.requestId,
        JSON.stringify(operation),
        JSON.stringify({
          cancelRequested: false,
          items: [
            {
              input: operation.items[0],
              status: "running",
              phase: "prepared",
              source: {
                rootId: sourceRoot.id,
                relativePath: trash.physicalRelativePath
              },
              sourceAssetId: photoId,
              manifest
            }
          ]
        }),
        new Date().toISOString(),
        new Date().toISOString()
      );
      await rename(
        path.join(sourceRoot.realPath, trash.physicalRelativePath),
        path.join(directory, "retained-original.jpg")
      );
      await manager.close();
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.get(operation.requestId)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "source_changed" }]
      });
      expect(getTrashRecord(db, trashId)).toBeTruthy();
      expect(
        await readFile(path.join(directory, "retained-original.jpg"), "utf8")
      ).toBe("original photo");
    });

    it("keeps roots read-only when their no-replace capability probe fails", async () => {
      await manager.close();
      class UnsupportedVolume extends FileOperationsFilesystem {
        override async probe(): Promise<void> {
          throw new FileOperationFilesystemError("unsupported_filesystem");
        }
      }
      manager = new FileOperationManager(config, db, new UnsupportedVolume());
      await manager.initialize();
      expect(manager.rootStatus(sourceRoot.id)).toEqual({
        writable: false,
        reason: "unsupported_filesystem"
      });
      expect(() =>
        manager.submit(request("trash", { items: [assetItem(photoId)] }))
      ).toThrow("read_only");
      expect(
        await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
      ).toBe("original photo");
    });

    it("publishes private uploads as new assets without inheriting duplicate-content metadata", async () => {
      updateAssetScore(db, {
        assetId: photoId,
        score: 99,
        favorite: true,
        updatedAt: new Date().toISOString()
      });
      setAssetTags(
        db,
        photoId,
        ["Private annotation"],
        new Date().toISOString()
      );
      const uploadId = randomUUID();
      await mkdir(path.join(config.dataDir, "uploads"), { mode: 0o700 });
      await writeFile(
        path.join(config.dataDir, "uploads", uploadId),
        "original photo",
        { mode: 0o600 }
      );
      const input = {
        requestId: randomUUID(),
        uploadId,
        destinationFolderId: targetFolderId,
        expectedParentVersion: folderVersion(targetFolderId),
        name: "Added.jpg",
        conflict: "skip" as const
      };
      const accepted = manager.publishUpload(input);
      const completed = await finished(accepted.id);
      expect(completed.status).toBe("completed");
      const added = completed.items[0]!.asset!;
      expect(added.id).not.toBe(photoId);
      expect(added).toMatchObject({
        name: "Added.jpg",
        score: 0,
        favorite: false,
        tags: []
      });
      expect(
        await readFile(path.join(targetRoot.realPath, "Added.jpg"), "utf8")
      ).toBe("original photo");
      expect(
        await readFile(path.join(config.dataDir, "uploads", uploadId), "utf8")
      ).toBe("original photo");
      expect(manager.publishUpload(input)).toEqual(completed);
      await scanLibrary(db, config.mediaRoots);
      expect(getManagedAsset(db, added.id)).toMatchObject({
        rootId: targetRoot.id,
        relativePath: "Added.jpg"
      });
      expect(getAsset(db, photoId)).toMatchObject({
        score: 99,
        favorite: true
      });
    });

    it("recovers an upload publication with a lost acknowledgement using its saved asset ID", async () => {
      await manager.close();
      class LostUploadRename extends FileOperationsFilesystem {
        fail = true;
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          const moved = await super.rename(source, destination, expected);
          if (this.fail) {
            this.fail = false;
            throw new Error("lost acknowledgement");
          }
          return moved;
        }
      }
      manager = new FileOperationManager(config, db, new LostUploadRename());
      await manager.initialize();
      const uploadId = randomUUID();
      await mkdir(path.join(config.dataDir, "uploads"), { mode: 0o700 });
      await writeFile(
        path.join(config.dataDir, "uploads", uploadId),
        "upload original",
        { mode: 0o600 }
      );
      const operation = manager.publishUpload({
        requestId: randomUUID(),
        uploadId,
        destinationFolderId: targetFolderId,
        expectedParentVersion: folderVersion(targetFolderId),
        name: "Added.jpg",
        conflict: "skip"
      });
      expect((await finished(operation.id)).status).toBe("needs_attention");
      const state = JSON.parse(
        getManagedOperation(db, operation.id)!.stateJson
      ) as { items: Array<{ sourceAssetId: string }> };
      await manager.close();
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.get(operation.id)).toMatchObject({
        status: "completed",
        items: [{ asset: { id: state.items[0]!.sourceAssetId } }]
      });
      expect(
        await readFile(path.join(targetRoot.realPath, "Added.jpg"), "utf8")
      ).toBe("upload original");
    });

    it.skipIf(!hasCrossDevice)(
      "recovers a fully copied stage when the copy acknowledgement was lost",
      async () => {
        await manager.close();
        class LostCopy extends FileOperationsFilesystem {
          override async copy(
            ...args: Parameters<FileOperationsFilesystem["copy"]>
          ): ReturnType<FileOperationsFilesystem["copy"]> {
            await super.copy(...args);
            throw new Error("lost copy acknowledgement");
          }
        }
        manager = new FileOperationManager(config, db, new LostCopy());
        await manager.initialize();
        const operation = request("move-media", {
          items: [assetItem(photoId)],
          destinationFolderId: crossFolderId,
          expectedParentVersion: folderVersion(crossFolderId)
        });
        expect((await run(operation)).status).toBe("needs_attention");
        expect(
          await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
        ).toBe("original photo");
        await manager.close();
        manager = new FileOperationManager(config, db);
        await manager.initialize();
        expect(manager.get(operation.requestId)?.status).toBe("completed");
        expect(getManagedAsset(db, photoId)?.rootId).toBe(crossRoot.id);
      }
    );

    it("rejects asset operations on a trashed lifecycle before touching its private file", async () => {
      const trashed = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      const record = getTrashRecord(db, trashed.items[0]!.trashId!)!;
      expect(() =>
        manager.submit(
          request("move-media", {
            items: [
              { assetId: photoId, expectedVersion: record.sourceVersion }
            ],
            destinationFolderId: targetFolderId,
            expectedParentVersion: folderVersion(targetFolderId)
          })
        )
      ).toThrow("source_not_found");
      expect(
        await readFile(
          path.join(sourceRoot.realPath, record.physicalRelativePath),
          "utf8"
        )
      ).toBe("original photo");
    });

    it("requires a complete reconciliation scan before re-enabling restored writes", async () => {
      db.prepare(
        "UPDATE library_state SET writes_need_scan = 1 WHERE id = 1"
      ).run();
      expect(manager.canWrite(sourceRoot.id)).toBe(false);
      expect(() =>
        manager.submit(request("trash", { items: [assetItem(photoId)] }))
      ).toThrow("read_only");
      expect((await scanLibrary(db, config.mediaRoots)).outcome).toBe(
        "completed"
      );
      expect(manager.canWrite(sourceRoot.id)).toBe(true);
    });

    it.skipIf(!hasCrossDevice)(
      "cancels a verified unpublished collision and offers only the unchanged item for retry",
      async () => {
        await manager.close();
        class LateCollision extends FileOperationsFilesystem {
          override async rename(
            source: FileOperationLocation,
            destination: FileOperationLocation,
            expected: FileOperationIdentity
          ) {
            if (
              source.relativePath.startsWith(".aether-staging/") &&
              destination.relativePath === "photo.jpg"
            )
              await writeFile(
                path.join(destination.rootPath, destination.relativePath),
                "unrelated destination",
                { flag: "wx" }
              );
            return super.rename(source, destination, expected);
          }
        }
        manager = new FileOperationManager(config, db, new LateCollision());
        await manager.initialize();
        const operation = request("move-media", {
          items: [assetItem(photoId)],
          destinationFolderId: crossFolderId,
          expectedParentVersion: folderVersion(crossFolderId)
        });
        expect(await run(operation)).toMatchObject({
          status: "needs_attention",
          canCancel: true
        });
        expect(manager.cancel(operation.requestId)?.status).toBe("queued");
        await vi.waitFor(() =>
          expect(manager.get(operation.requestId)?.status).toBe("cancelled")
        );
        expect(manager.get(operation.requestId)?.retryInput?.items).toEqual(
          operation.items
        );
        expect(
          await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
        ).toBe("original photo");
        expect(
          await readFile(path.join(crossRoot.realPath, "photo.jpg"), "utf8")
        ).toBe("unrelated destination");
        await expect(
          stat(
            path.join(
              crossRoot.realPath,
              ".aether-staging",
              operation.requestId,
              "0"
            )
          )
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
    );

    it.skipIf(!hasCrossDevice)(
      "retains an unrecognized partial stage instead of discarding it on cancellation",
      async () => {
        await manager.close();
        class UnknownPartialStage extends FileOperationsFilesystem {
          override async copy(
            source: FileOperationLocation,
            destination: FileOperationLocation
          ): ReturnType<FileOperationsFilesystem["copy"]> {
            await writeFile(
              path.join(destination.rootPath, destination.relativePath),
              "unknown partial",
              { flag: "wx", mode: 0o600 }
            );
            throw new Error("no durable stage identity");
          }
        }
        manager = new FileOperationManager(
          config,
          db,
          new UnknownPartialStage()
        );
        await manager.initialize();
        const operation = request("move-media", {
          items: [assetItem(photoId)],
          destinationFolderId: crossFolderId,
          expectedParentVersion: folderVersion(crossFolderId)
        });
        expect((await run(operation)).status).toBe("needs_attention");
        manager.cancel(operation.requestId);
        await vi.waitFor(() =>
          expect(manager.get(operation.requestId)?.items[0]?.errorCode).toBe(
            "unknown_reserved_storage"
          )
        );
        expect(manager.get(operation.requestId)?.status).toBe(
          "needs_attention"
        );
        expect(
          await readFile(
            path.join(
              crossRoot.realPath,
              ".aether-staging",
              operation.requestId,
              "0"
            ),
            "utf8"
          )
        ).toBe("unknown partial");
        expect(
          await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
        ).toBe("original photo");
      }
    );

    it("re-enables an unavailable configured volume only after its original identities return", async () => {
      const originalRoot = `${sourceRoot.realPath}-offline`;
      await rename(sourceRoot.realPath, originalRoot);
      await mkdir(sourceRoot.realPath);
      await manager.refreshCapabilities();
      expect(manager.canWrite(sourceRoot.id)).toBe(false);
      await rm(sourceRoot.realPath, { recursive: true });
      await rename(originalRoot, sourceRoot.realPath);
      await manager.refreshCapabilities();
      expect(manager.rootStatus(sourceRoot.id)).toEqual({
        writable: true,
        reason: null
      });
    });

    it("expires verified Trash through the durable operation path", async () => {
      const trashed = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      const record = getTrashRecord(db, trashed.items[0]!.trashId!)!;
      db.prepare("UPDATE trash_records SET expires_at = ? WHERE id = ?").run(
        new Date(Date.now() - 1).toISOString(),
        record.id
      );
      await manager.runMaintenance();
      expect(getTrashRecord(db, record.id)).toBeNull();
      expect(getManagedAsset(db, photoId)).toBeNull();
      expect(
        manager
          .list()
          .some(
            (operation) =>
              operation.type === "purge" && operation.status === "completed"
          )
      ).toBe(true);
      expect(manager.get(trashed.id)).toBeTruthy();
      await expect(
        stat(path.join(sourceRoot.realPath, record.physicalRelativePath))
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps expired Trash on an unavailable drive until the original drive returns", async () => {
      const trashed = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      const trashId = trashed.items[0]!.trashId!;
      db.prepare("UPDATE trash_records SET expires_at = ? WHERE id = ?").run(
        new Date(Date.now() - 1).toISOString(),
        trashId
      );
      const originalRoot = `${sourceRoot.realPath}-offline`;
      await rename(sourceRoot.realPath, originalRoot);
      await mkdir(sourceRoot.realPath);
      await manager.runMaintenance();
      expect(getTrashRecord(db, trashId)).toBeTruthy();
      await rm(sourceRoot.realPath, { recursive: true });
      await rename(originalRoot, sourceRoot.realPath);
      await manager.runMaintenance();
      expect(getTrashRecord(db, trashId)).toBeNull();
    });

    it("removes old terminal receipts only after their journal-owned empty staging folders are cleaned", async () => {
      const operation = await run(
        request("create-folder", {
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId),
          name: "Empty"
        })
      );
      const stageParent = path.join(
        targetRoot.realPath,
        ".aether-staging",
        operation.id
      );
      expect((await stat(stageParent)).isDirectory()).toBe(true);
      db.prepare(
        "UPDATE file_operations SET created_at = ?, updated_at = ? WHERE id = ?"
      ).run(
        new Date(Date.now() - 8 * 86400_000).toISOString(),
        new Date(Date.now() - 8 * 86400_000).toISOString(),
        operation.id
      );
      await manager.runMaintenance();
      expect(manager.get(operation.id)).toBeNull();
      await expect(stat(stageParent)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        (await stat(path.join(targetRoot.realPath, "Empty"))).isDirectory()
      ).toBe(true);
    });

    it("retains cleanup receipts and unexpected private contents for review", async () => {
      const operation = await run(
        request("create-folder", {
          destinationFolderId: targetFolderId,
          expectedParentVersion: folderVersion(targetFolderId),
          name: "Empty"
        })
      );
      const unknown = path.join(
        targetRoot.realPath,
        ".aether-staging",
        operation.id,
        "unexpected"
      );
      await writeFile(unknown, "keep unknown contents");
      db.prepare(
        "UPDATE file_operations SET created_at = ?, updated_at = ? WHERE id = ?"
      ).run(
        new Date(Date.now() - 8 * 86400_000).toISOString(),
        new Date(Date.now() - 8 * 86400_000).toISOString(),
        operation.id
      );
      await manager.runMaintenance();
      expect(manager.get(operation.id)).toBeTruthy();
      expect(await readFile(unknown, "utf8")).toBe("keep unknown contents");
    });

    it("recovers pending work even when more than one hundred newer terminal receipts exist", async () => {
      await manager.close();
      const operation = request("rename-media", {
        items: [assetItem(photoId)],
        name: "Recovered"
      });
      createManagedOperation(db, {
        id: operation.requestId,
        requestJson: JSON.stringify(operation),
        stateJson: JSON.stringify({
          items: [{ input: operation.items[0], status: "queued" }],
          cancelRequested: false
        })
      });
      const insert = db.prepare(
        "INSERT INTO file_operations (id, request_id, type, request_json, status, state_json, created_at, updated_at) VALUES (?, ?, 'rename-media', ?, 'completed', ?, ?, ?)"
      );
      for (let index = 0; index < 101; index++) {
        const id = randomUUID();
        insert.run(
          id,
          id,
          JSON.stringify({ ...operation, requestId: id }),
          JSON.stringify({ items: [], cancelRequested: false }),
          "2999-01-01T00:00:00.000Z",
          "2999-01-01T00:00:00.000Z"
        );
      }
      expect(manager.list()).toHaveLength(100);
      expect(manager.list()[0]?.id).toBe(operation.requestId);
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.get(operation.requestId)?.status).toBe("completed");
      expect(getManagedAsset(db, photoId)?.name).toBe("Recovered.jpg");
    });

    function assetItem(id: string) {
      return {
        assetId: id,
        expectedVersion: getManagedAsset(db, id)!.sourceVersion
      };
    }
    function folderItem(id: string) {
      return { folderId: id, expectedVersion: folderVersion(id) };
    }
    function folderVersion(id: string) {
      return getManagedFolder(db, id)!.sourceVersion;
    }
    function request(
      type: FileOperationRequest["type"],
      input: Partial<FileOperationRequest>
    ): FileOperationRequest {
      return FileOperationBody.parse({
        requestId: randomUUID(),
        type,
        conflict: "skip",
        items: [],
        ...input
      });
    }
    async function run(
      operation: FileOperationRequest
    ): Promise<FileOperationReceipt> {
      manager.submit(operation);
      return finished(operation.requestId);
    }
    async function finished(id: string): Promise<FileOperationReceipt> {
      await vi.waitFor(
        () => {
          expect(["queued", "running"]).not.toContain(manager.get(id)?.status);
        },
        { timeout: 10_000, interval: 5 }
      );
      return manager.get(id)!;
    }
  }
);
