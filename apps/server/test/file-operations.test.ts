import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
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
  type FileOperationLocation,
  type FileOperationLimits
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

describe.skipIf(!["linux", "darwin"].includes(process.platform))(
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

    // Exercise alias lookup on a case-sensitive host too. Publication still
    // uses the actual native no-replacement rename against disposable files.
    class AliasLookupFilesystem extends FileOperationsFilesystem {
      private async resolveAlias(location: FileOperationLocation) {
        if (await super.entryExists(location)) return location;
        const parent = path.posix.dirname(location.relativePath);
        const name = path.posix.basename(location.relativePath);
        const names = await readdir(path.join(location.rootPath, parent));
        const existing = names.find(
          (entry) => entry.toLowerCase() === name.toLowerCase()
        );
        return existing
          ? { ...location, relativePath: path.posix.join(parent, existing) }
          : location;
      }
      override async entryExists(location: FileOperationLocation) {
        return super.entryExists(await this.resolveAlias(location));
      }
      override async inspect(location: FileOperationLocation) {
        return super.inspect(await this.resolveAlias(location));
      }
      override async inventory(
        location: FileOperationLocation,
        limits?: FileOperationLimits
      ) {
        return super.inventory(await this.resolveAlias(location), limits);
      }
    }

    // Model inode metadata changed by a Darwin rename while exercising real
    // native publication, byte hashing and path checks on every test host.
    class RenameMetadataFilesystem extends FileOperationsFilesystem {
      constructor(
        private readonly inode: string,
        private generation = 0
      ) {
        super();
      }
      private withMetadata(identity: FileOperationIdentity) {
        return identity.ino === this.inode
          ? {
              ...identity,
              metadataSha256: this.generation.toString(16).padStart(64, "0"),
              metadataBytes: 32 + this.generation
            }
          : identity;
      }
      override async inspect(location: FileOperationLocation) {
        return this.withMetadata(await super.inspect(location));
      }
      override async inventory(
        location: FileOperationLocation,
        limits?: FileOperationLimits
      ) {
        const manifest = await super.inventory(location, limits);
        const entries = manifest.entries.map((entry) => ({
          ...entry,
          identity: this.withMetadata(entry.identity)
        }));
        return {
          entries,
          totalBytes:
            manifest.totalBytes +
            entries.reduce(
              (bytes, entry, index) =>
                bytes +
                (entry.identity.metadataBytes ?? 0) -
                (manifest.entries[index]!.identity.metadataBytes ?? 0),
              0
            )
        };
      }
      override async rename(
        source: FileOperationLocation,
        destination: FileOperationLocation,
        expected: FileOperationIdentity
      ) {
        const moved = await super.rename(source, destination, expected);
        if (moved.ino === this.inode) this.generation++;
        return this.withMetadata(moved);
      }
    }

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

    it.each(["media", "folder"] as const)(
      "changes a %s name's case when the destination resolves to the source",
      async (kind) => {
        await manager.close();
        const filesystem = new AliasLookupFilesystem();
        const renameEntry = vi.spyOn(filesystem, "rename");
        manager = new FileOperationManager(config, db, filesystem);
        await manager.initialize();
        updateAssetScore(db, {
          assetId: photoId,
          score: 71,
          favorite: true,
          updatedAt: new Date().toISOString()
        });
        setAssetTags(db, photoId, ["Travel"]);
        const operation =
          kind === "media"
            ? request("rename-media", {
                items: [assetItem(photoId)],
                name: "PHOTO"
              })
            : request("rename-folder", {
                items: [folderItem(tripId)],
                name: "TRIP"
              });
        const result = await run(operation);
        expect(result.status).toBe("completed");
        expect(renameEntry).toHaveBeenCalledTimes(1);
        const names = await readdir(sourceRoot.realPath);
        expect(names).toContain(kind === "media" ? "PHOTO.jpg" : "TRIP");
        expect(names).not.toContain(kind === "media" ? "photo.jpg" : "trip");
        expect((await scanLibrary(db, config.mediaRoots)).outcome).toBe(
          "completed"
        );
        if (kind === "media") {
          expect(getManagedAsset(db, photoId)?.relativePath).toBe("PHOTO.jpg");
          expect(getAsset(db, photoId)).toMatchObject({
            id: photoId,
            score: 71,
            favorite: true,
            tags: [expect.objectContaining({ displayName: "Travel" })]
          });
        } else {
          expect(getManagedFolder(db, tripId)?.relativePath).toBe("TRIP");
          expect(getManagedAsset(db, nestedId)?.relativePath).toBe(
            "TRIP/nested/nested.jpg"
          );
          expect(
            await readFile(
              path.join(sourceRoot.realPath, "TRIP/.sidecar"),
              "utf8"
            )
          ).toBe("unindexed sidecar");
        }
      }
    );

    it.each(["media", "folder"] as const)(
      "recovers a case-only %s rename after losing publication acknowledgement",
      async (kind) => {
        await manager.close();
        class LostAliasRename extends AliasLookupFilesystem {
          override async rename(
            ...args: Parameters<FileOperationsFilesystem["rename"]>
          ): Promise<FileOperationIdentity> {
            await super.rename(...args);
            throw new Error("lost acknowledgement");
          }
        }
        manager = new FileOperationManager(config, db, new LostAliasRename());
        await manager.initialize();
        const operation =
          kind === "media"
            ? request("rename-media", {
                items: [assetItem(photoId)],
                name: "PHOTO"
              })
            : request("rename-folder", {
                items: [folderItem(tripId)],
                name: "TRIP"
              });
        expect((await run(operation)).status).toBe("needs_attention");
        await manager.close();
        const filesystem = new FileOperationsFilesystem();
        const renameEntry = vi.spyOn(filesystem, "rename");
        manager = new FileOperationManager(config, db, filesystem);
        await manager.initialize();
        expect(manager.get(operation.requestId)?.status).toBe("completed");
        expect(renameEntry).not.toHaveBeenCalled();
        expect(await readdir(sourceRoot.realPath)).toContain(
          kind === "media" ? "PHOTO.jpg" : "TRIP"
        );
        expect(
          kind === "media"
            ? getManagedAsset(db, photoId)?.relativePath
            : getManagedFolder(db, tripId)?.relativePath
        ).toBe(kind === "media" ? "PHOTO.jpg" : "TRIP");
      }
    );

    it("keeps a different file when a renamed destination resolves to its alias", async () => {
      await writeFile(
        path.join(sourceRoot.realPath, "Taken.jpg"),
        "existing destination"
      );
      await manager.close();
      manager = new FileOperationManager(
        config,
        db,
        new AliasLookupFilesystem()
      );
      await manager.initialize();
      const result = await run(
        request("rename-media", { items: [assetItem(photoId)], name: "TAKEN" })
      );
      expect(result).toMatchObject({
        status: "failed",
        items: [{ errorCode: "destination_exists" }]
      });
      expect(
        await readFile(path.join(sourceRoot.realPath, "Taken.jpg"), "utf8")
      ).toBe("existing destination");
      expect(
        await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
      ).toBe("original photo");
      expect(getManagedAsset(db, photoId)?.name).toBe("photo.jpg");
    });

    it("cancels an unpublished case-only rename without mistaking its alias for a publication", async () => {
      await manager.close();
      class InterruptedAliasRename extends AliasLookupFilesystem {
        override async rename(): Promise<FileOperationIdentity> {
          throw new Error("interrupted before publication");
        }
      }
      const filesystem = new InterruptedAliasRename();
      const renameEntry = vi.spyOn(filesystem, "rename");
      manager = new FileOperationManager(config, db, filesystem);
      await manager.initialize();
      const operation = request("rename-media", {
        items: [assetItem(photoId)],
        name: "PHOTO"
      });
      expect((await run(operation)).status).toBe("needs_attention");
      expect(manager.cancel(operation.requestId)?.status).toBe("queued");
      expect((await finished(operation.requestId)).status).toBe("cancelled");
      expect(renameEntry).toHaveBeenCalledTimes(1);
      expect(await readdir(sourceRoot.realPath)).toContain("photo.jpg");
      expect(await readdir(sourceRoot.realPath)).not.toContain("PHOTO.jpg");
      expect(getManagedAsset(db, photoId)?.relativePath).toBe("photo.jpg");
    });

    it("retains operation names while hydrating current metadata and omitting inactive assets", async () => {
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
      await run(
        request("rename-media", {
          items: [assetItem(photoId)],
          name: "Latest"
        })
      );
      expect(manager.get(renamed.id)?.items[0]).toMatchObject({
        name: "Current.jpg",
        asset: { name: "Latest.jpg" }
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
      expect(manager.get(created.id)?.items[0]?.name).toBe("First");
      await run(request("trash", { items: [assetItem(photoId)] }));
      expect(manager.get(renamed.id)?.items[0]).toMatchObject({
        assetId: photoId,
        name: "Current.jpg",
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
      expect(kept.items[0]?.name).toBe("photo (2).jpg");
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

    it.each(["retry", "restart", "cancel remaining"] as const)(
      "recovers a published Trash item after a lost acknowledgement through %s",
      async (recovery) => {
        updateAssetScore(db, {
          assetId: photoId,
          score: 83,
          favorite: true,
          updatedAt: new Date().toISOString()
        });
        setAssetTags(db, photoId, ["Keep"], new Date().toISOString());
        const original = getManagedAsset(db, photoId)!;
        await manager.close();
        class LostTrashPublication extends FileOperationsFilesystem {
          fail = true;
          override async rename(
            source: FileOperationLocation,
            destination: FileOperationLocation,
            expected: FileOperationIdentity
          ) {
            const moved = await super.rename(source, destination, expected);
            if (
              this.fail &&
              destination.relativePath.startsWith(".aether-trash/")
            ) {
              this.fail = false;
              throw new FileOperationFilesystemError("needs_review");
            }
            return moved;
          }
        }
        manager = new FileOperationManager(
          config,
          db,
          new LostTrashPublication()
        );
        await manager.initialize();
        const operation = request("trash", {
          items:
            recovery === "cancel remaining"
              ? [assetItem(photoId), assetItem(nestedId)]
              : [assetItem(photoId)]
        });
        const retainedPath = `.aether-trash/${operation.requestId}/0`;
        const retainedFile = path.join(sourceRoot.realPath, retainedPath);
        const pending = await run(operation);
        expect(pending.status).toBe("needs_attention");
        expect(pending.items[0]).toMatchObject({
          assetId: photoId,
          errorCode: "needs_review"
        });
        expect(getManagedAsset(db, photoId)).toMatchObject({
          lifecycle: "active",
          relativePath: "photo.jpg"
        });
        expect(getAsset(db, photoId)).toMatchObject({ id: photoId, score: 83 });
        expect(listTrash(db)).toHaveLength(0);
        expect(await readFile(retainedFile, "utf8")).toBe("original photo");
        expect(String((await stat(retainedFile, { bigint: true })).ino)).toBe(
          original.fsInode
        );
        await expect(
          stat(path.join(sourceRoot.realPath, "photo.jpg"))
        ).rejects.toMatchObject({ code: "ENOENT" });

        if (recovery === "restart") {
          await manager.close();
          manager = new FileOperationManager(config, db);
          await manager.initialize();
        } else if (recovery === "cancel remaining") {
          expect(manager.cancel(operation.requestId)?.status).toBe("queued");
        } else {
          expect(manager.retry(operation.requestId)?.status).toBe("queued");
        }
        const recovered = await finished(operation.requestId);
        expect(recovered).toMatchObject({
          id: operation.requestId,
          status: recovery === "cancel remaining" ? "partial" : "completed"
        });
        expect(recovered.items[0]).toMatchObject({
          assetId: photoId,
          status: "completed"
        });
        if (recovery === "cancel remaining") {
          expect(recovered.items[1]).toMatchObject({
            assetId: nestedId,
            status: "cancelled"
          });
          expect(getAsset(db, nestedId)?.id).toBe(nestedId);
          expect(
            await readFile(
              path.join(sourceRoot.realPath, "trip/nested/nested.jpg"),
              "utf8"
            )
          ).toBe("nested media");
        }
        expect(getAsset(db, photoId)).toBeNull();
        expect(getManagedAsset(db, photoId)).toMatchObject({
          id: photoId,
          lifecycle: "trashed",
          relativePath: retainedPath
        });
        const records = listTrash(db);
        expect(records).toHaveLength(1);
        const record = records[0]!;
        expect(record).toMatchObject({
          id: `${operation.requestId}-0`,
          assetId: photoId,
          physicalRelativePath: retainedPath
        });
        expect(await readFile(retainedFile, "utf8")).toBe("original photo");
        expect(manager.submit(operation)).toEqual(recovered);
        expect(
          (
            await run(
              request("restore", {
                items: [
                  { trashId: record.id, expectedVersion: record.sourceVersion }
                ]
              })
            )
          ).status
        ).toBe("completed");
        expect(getAsset(db, photoId)).toMatchObject({
          id: photoId,
          score: 83,
          favorite: true,
          tags: [expect.objectContaining({ displayName: "Keep" })]
        });
        expect(listTrash(db)).toHaveLength(0);
        expect(
          await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
        ).toBe("original photo");
      }
    );

    it("commits a verified Trash rename when only its root metadata changes during publication", async () => {
      const original = getManagedAsset(db, photoId)!;
      await manager.close();
      const filesystem = new RenameMetadataFilesystem(original.fsInode!);
      manager = new FileOperationManager(config, db, filesystem);
      await manager.initialize();
      const operation = request("trash", { items: [assetItem(photoId)] });
      const before = await filesystem.inventory({
        rootPath: sourceRoot.realPath,
        relativePath: "photo.jpg"
      });
      expect((await run(operation)).status).toBe("completed");
      const records = listTrash(db);
      expect(records).toHaveLength(1);
      const retained = records[0]!;
      const after = await filesystem.inventory({
        rootPath: sourceRoot.realPath,
        relativePath: retained.physicalRelativePath
      });
      expect(after.entries[0]!.identity).toMatchObject({
        dev: before.entries[0]!.identity.dev,
        ino: before.entries[0]!.identity.ino,
        size: before.entries[0]!.identity.size,
        mode: before.entries[0]!.identity.mode,
        mtimeNs: before.entries[0]!.identity.mtimeNs
      });
      expect(after.entries[0]!.sha256).toBe(before.entries[0]!.sha256);
      expect(after.entries[0]!.identity.metadataSha256).not.toBe(
        before.entries[0]!.identity.metadataSha256
      );
      expect(after.totalBytes).toBe(before.totalBytes + 1);
      expect(getAsset(db, photoId)).toBeNull();
      expect(
        await readFile(
          path.join(sourceRoot.realPath, retained.physicalRelativePath),
          "utf8"
        )
      ).toBe("original photo");
    });

    it.each(["retry", "restart", "cancel remaining"] as const)(
      "recovers an earlier prepared Trash journal after rename metadata changes through %s",
      async (recovery) => {
        updateAssetScore(db, {
          assetId: photoId,
          score: 83,
          favorite: true,
          updatedAt: new Date().toISOString()
        });
        setAssetTags(db, photoId, ["Keep"], new Date().toISOString());
        const original = getManagedAsset(db, photoId)!;
        await manager.close();
        const filesystem = new RenameMetadataFilesystem(original.fsInode!);
        manager = new FileOperationManager(config, db, filesystem);
        await manager.initialize();
        const operation = request("trash", {
          items:
            recovery === "cancel remaining"
              ? [assetItem(photoId), assetItem(nestedId)]
              : [assetItem(photoId)]
        });
        const source = {
          rootPath: sourceRoot.realPath,
          relativePath: "photo.jpg"
        };
        const destination = {
          rootPath: sourceRoot.realPath,
          relativePath: `.aether-trash/${operation.requestId}/0`
        };
        const expected = await filesystem.inspect(source);
        const manifest = await filesystem.inventory(source);
        await filesystem.createDirectory({
          rootPath: sourceRoot.realPath,
          relativePath: `.aether-trash/${operation.requestId}`
        });
        const published = await filesystem.rename(
          source,
          destination,
          expected
        );
        const publishedManifest = await filesystem.inventory(destination);
        const stateJson = JSON.stringify({
          cancelRequested: false,
          items: [
            {
              input: operation.items[0],
              status: "needs_attention",
              phase: "prepared",
              source: { rootId: sourceRoot.id, relativePath: "photo.jpg" },
              destination: {
                rootId: sourceRoot.id,
                relativePath: destination.relativePath
              },
              expected,
              manifest,
              published,
              publishedManifest,
              sourceAssetId: photoId,
              trashId: `${operation.requestId}-0`,
              errorCode: "destination_exists"
            },
            ...(recovery === "cancel remaining"
              ? [{ input: operation.items[1], status: "queued" }]
              : [])
          ]
        });
        createManagedOperation(db, {
          id: operation.requestId,
          requestJson: JSON.stringify(operation),
          stateJson
        });
        updateManagedOperation(db, operation.requestId, {
          status: "needs_attention",
          stateJson
        });
        expect(listTrash(db)).toHaveLength(0);
        expect(getManagedAsset(db, photoId)).toMatchObject({
          lifecycle: "active",
          relativePath: "photo.jpg"
        });

        if (recovery === "restart") {
          await manager.close();
          manager = new FileOperationManager(
            config,
            db,
            new RenameMetadataFilesystem(original.fsInode!, 1)
          );
          await manager.initialize();
        } else if (recovery === "cancel remaining") {
          manager.cancel(operation.requestId);
        } else manager.retry(operation.requestId);
        const recovered = await finished(operation.requestId);
        expect(recovered).toMatchObject({
          status: recovery === "cancel remaining" ? "partial" : "completed"
        });
        expect(recovered.items[0]).toMatchObject({
          assetId: photoId,
          status: "completed"
        });
        if (recovery === "cancel remaining") {
          expect(recovered.items[1]).toMatchObject({
            assetId: nestedId,
            status: "cancelled"
          });
          expect(getAsset(db, nestedId)?.id).toBe(nestedId);
          expect(
            await readFile(
              path.join(sourceRoot.realPath, "trip/nested/nested.jpg"),
              "utf8"
            )
          ).toBe("nested media");
        }
        expect(getAsset(db, photoId)).toBeNull();
        const records = listTrash(db);
        expect(records).toHaveLength(1);
        const record = records[0]!;
        expect(record).toMatchObject({
          id: `${operation.requestId}-0`,
          assetId: photoId,
          physicalRelativePath: destination.relativePath
        });
        expect(
          await readFile(
            path.join(sourceRoot.realPath, record.physicalRelativePath),
            "utf8"
          )
        ).toBe("original photo");
        expect(
          (
            await run(
              request("restore", {
                items: [
                  { trashId: record.id, expectedVersion: record.sourceVersion }
                ]
              })
            )
          ).status
        ).toBe("completed");
        expect(getAsset(db, photoId)).toMatchObject({
          id: photoId,
          score: 83,
          favorite: true,
          tags: [expect.objectContaining({ displayName: "Keep" })]
        });
        expect(listTrash(db)).toHaveLength(0);
        expect(
          await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
        ).toBe("original photo");
      }
    );

    it("reports a changed retained Trash item separately from a destination collision", async () => {
      await manager.close();
      class ChangedTrashPublication extends FileOperationsFilesystem {
        fail = true;
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          const moved = await super.rename(source, destination, expected);
          if (
            this.fail &&
            destination.relativePath.startsWith(".aether-trash/")
          ) {
            this.fail = false;
            const retainedFile = path.join(
              destination.rootPath,
              destination.relativePath
            );
            const times = await stat(retainedFile);
            await utimes(retainedFile, times.atime, times.mtimeMs / 1000 + 1);
            throw new FileOperationFilesystemError("needs_review");
          }
          return moved;
        }
      }
      manager = new FileOperationManager(
        config,
        db,
        new ChangedTrashPublication()
      );
      await manager.initialize();
      const original = getManagedAsset(db, photoId)!;
      const operation = request("trash", { items: [assetItem(photoId)] });
      const retainedFile = path.join(
        sourceRoot.realPath,
        `.aether-trash/${operation.requestId}/0`
      );
      expect(await run(operation)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "needs_review" }]
      });
      expect(String((await stat(retainedFile, { bigint: true })).ino)).toBe(
        original.fsInode
      );
      manager.retry(operation.requestId);
      expect(await finished(operation.requestId)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "source_changed" }]
      });
      expect(getManagedAsset(db, photoId)).toMatchObject({
        lifecycle: "active",
        relativePath: "photo.jpg"
      });
      expect(listTrash(db)).toHaveLength(0);
      expect(await readFile(retainedFile, "utf8")).toBe("original photo");
      await expect(
        stat(path.join(sourceRoot.realPath, "photo.jpg"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it.each(["content", "mode"] as const)(
      "retains a published Trash item when its %s changes after rename",
      async (change) => {
        const sourceFile = path.join(sourceRoot.realPath, "photo.jpg");
        await chmod(sourceFile, 0o640);
        await utimes(sourceFile, 1_700_000_000, 1_700_000_000);
        await scanLibrary(db, config.mediaRoots);
        await manager.close();
        class ChangedPublication extends FileOperationsFilesystem {
          override async rename(
            source: FileOperationLocation,
            destination: FileOperationLocation,
            expected: FileOperationIdentity
          ) {
            const moved = await super.rename(source, destination, expected);
            const retainedFile = path.join(
              destination.rootPath,
              destination.relativePath
            );
            if (change === "content") {
              await writeFile(retainedFile, "modified photo");
              await utimes(retainedFile, 1_700_000_000, 1_700_000_000);
            } else await chmod(retainedFile, 0o600);
            return moved;
          }
        }
        const filesystem = new ChangedPublication();
        manager = new FileOperationManager(config, db, filesystem);
        await manager.initialize();
        const operation = request("trash", { items: [assetItem(photoId)] });
        const before = await filesystem.inspect({
          rootPath: sourceRoot.realPath,
          relativePath: "photo.jpg"
        });
        expect(await run(operation)).toMatchObject({
          status: "needs_attention",
          items: [{ errorCode: "source_changed" }]
        });
        const retainedFile = path.join(
          sourceRoot.realPath,
          `.aether-trash/${operation.requestId}/0`
        );
        const after = await filesystem.inspect({
          rootPath: sourceRoot.realPath,
          relativePath: `.aether-trash/${operation.requestId}/0`
        });
        expect(after).toMatchObject({
          dev: before.dev,
          ino: before.ino,
          size: before.size,
          mtimeNs: before.mtimeNs
        });
        if (change === "mode") expect(after.mode).not.toBe(before.mode);
        manager.retry(operation.requestId);
        expect(await finished(operation.requestId)).toMatchObject({
          status: "needs_attention",
          items: [{ errorCode: "source_changed" }]
        });
        expect(getManagedAsset(db, photoId)).toMatchObject({
          lifecycle: "active",
          relativePath: "photo.jpg"
        });
        expect(listTrash(db)).toHaveLength(0);
        expect(await readFile(retainedFile, "utf8")).toBe(
          change === "content" ? "modified photo" : "original photo"
        );
      }
    );

    it("retains both paths when a source is recreated after a lost Trash acknowledgement", async () => {
      await manager.close();
      class RecreatedSource extends FileOperationsFilesystem {
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ): Promise<FileOperationIdentity> {
          await super.rename(source, destination, expected);
          await writeFile(
            path.join(source.rootPath, source.relativePath),
            "replacement source"
          );
          throw new FileOperationFilesystemError("needs_review");
        }
      }
      manager = new FileOperationManager(config, db, new RecreatedSource());
      await manager.initialize();
      const operation = request("trash", { items: [assetItem(photoId)] });
      expect(await run(operation)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "needs_review" }]
      });
      manager.retry(operation.requestId);
      expect(await finished(operation.requestId)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "source_changed" }]
      });
      expect(getManagedAsset(db, photoId)).toMatchObject({
        lifecycle: "active",
        relativePath: "photo.jpg"
      });
      expect(listTrash(db)).toHaveLength(0);
      expect(
        await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
      ).toBe("replacement source");
      expect(
        await readFile(
          path.join(
            sourceRoot.realPath,
            `.aether-trash/${operation.requestId}/0`
          ),
          "utf8"
        )
      ).toBe("original photo");
    });

    it("retains a moved folder when a child's metadata changes during publication", async () => {
      await manager.close();
      class ChangedChildMetadata extends FileOperationsFilesystem {
        published = false;
        override async inventory(
          location: FileOperationLocation,
          limits?: FileOperationLimits
        ) {
          const manifest = await super.inventory(location, limits);
          let totalBytes = manifest.totalBytes;
          const entries = manifest.entries.map((entry) => {
            if (entry.relativePath !== "nested/nested.jpg") return entry;
            totalBytes += 1 - (entry.identity.metadataBytes ?? 0);
            return {
              ...entry,
              identity: {
                ...entry.identity,
                metadataSha256: (this.published ? "b" : "a").repeat(64),
                metadataBytes: 1
              }
            };
          });
          return { entries, totalBytes };
        }
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          const moved = await super.rename(source, destination, expected);
          this.published = true;
          return moved;
        }
      }
      manager = new FileOperationManager(
        config,
        db,
        new ChangedChildMetadata()
      );
      await manager.initialize();
      const operation = request("rename-folder", {
        items: [folderItem(tripId)],
        name: "Holiday"
      });
      expect(await run(operation)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "source_changed" }]
      });
      manager.retry(operation.requestId);
      expect(await finished(operation.requestId)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "source_changed" }]
      });
      expect(getManagedFolder(db, tripId)?.relativePath).toBe("trip");
      expect(getManagedAsset(db, nestedId)?.relativePath).toBe(
        "trip/nested/nested.jpg"
      );
      expect(
        await readFile(
          path.join(sourceRoot.realPath, "Holiday/nested/nested.jpg"),
          "utf8"
        )
      ).toBe("nested media");
      expect(
        await readFile(
          path.join(sourceRoot.realPath, "Holiday/.sidecar"),
          "utf8"
        )
      ).toBe("unindexed sidecar");
    });

    it("retains both files when an unrelated item occupies the reserved Trash destination", async () => {
      await manager.close();
      class OccupiedTrashDestination extends FileOperationsFilesystem {
        inserted = false;
        override async rename(
          source: FileOperationLocation,
          destination: FileOperationLocation,
          expected: FileOperationIdentity
        ) {
          if (
            !this.inserted &&
            destination.relativePath.startsWith(".aether-trash/")
          ) {
            this.inserted = true;
            await writeFile(
              path.join(destination.rootPath, destination.relativePath),
              "unrelated retained file"
            );
          }
          return super.rename(source, destination, expected);
        }
      }
      manager = new FileOperationManager(
        config,
        db,
        new OccupiedTrashDestination()
      );
      await manager.initialize();
      const operation = request("trash", { items: [assetItem(photoId)] });
      const retainedFile = path.join(
        sourceRoot.realPath,
        `.aether-trash/${operation.requestId}/0`
      );
      expect(await run(operation)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "destination_exists" }]
      });
      manager.retry(operation.requestId);
      expect(await finished(operation.requestId)).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "destination_exists" }]
      });
      expect(getManagedAsset(db, photoId)).toMatchObject({
        lifecycle: "active",
        relativePath: "photo.jpg"
      });
      expect(getAsset(db, photoId)?.id).toBe(photoId);
      expect(listTrash(db)).toHaveLength(0);
      expect(await readFile(retainedFile, "utf8")).toBe(
        "unrelated retained file"
      );
      expect(
        await readFile(path.join(sourceRoot.realPath, "photo.jpg"), "utf8")
      ).toBe("original photo");
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
      expect(trashed).toMatchObject({
        status: "completed",
        items: [{ name: "photo.jpg", assetId: photoId }]
      });
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
      expect(restored).toMatchObject({
        status: "completed",
        items: [{ name: "photo.jpg", assetId: photoId }]
      });
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
      expect(purged).toMatchObject({
        status: "completed",
        items: [{ name: "photo.jpg", assetId: photoId }]
      });
      expect(getManagedAsset(db, photoId)).toBeNull();
      expect(listTrash(db)).toHaveLength(0);
      await expect(
        stat(path.join(sourceRoot.realPath, secondRecord.physicalRelativePath))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await manager.close();
      db.close();
      db = openDatabase(config.configDir);
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      for (const operation of [trashed, restored, secondTrash, purged]) {
        const receipt = manager.get(operation.id)!;
        expect(receipt).toMatchObject({
          status: "completed",
          items: [{ name: "photo.jpg", assetId: photoId }]
        });
        expect(receipt.items[0]?.asset).toBeUndefined();
        expect(JSON.stringify(receipt)).not.toContain(sourceRoot.realPath);
        expect(JSON.stringify(receipt)).not.toContain(".aether-trash/");
        expect(
          manager.list().find(({ id }) => id === operation.id)?.items
        ).toEqual(receipt.items);
      }
    });

    it("identifies earlier completed Trash receipts from the retained original name and journal", async () => {
      const trashed = await run(
        request("trash", { items: [assetItem(photoId)] })
      );
      const operation = getManagedOperation(db, trashed.id)!;
      const journal = JSON.parse(operation.stateJson) as {
        items: Array<{ name?: string }>;
      };
      delete journal.items[0]!.name;
      updateManagedOperation(db, operation.id, {
        status: operation.status,
        stateJson: JSON.stringify(journal)
      });
      expect(manager.get(trashed.id)?.items[0]?.name).toBe("photo.jpg");
      const record = getTrashRecord(db, trashed.items[0]!.trashId!)!;
      await run(
        request("purge", {
          items: [{ trashId: record.id, expectedVersion: record.sourceVersion }]
        })
      );
      await manager.close();
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(getTrashRecord(db, record.id)).toBeNull();
      expect(manager.get(trashed.id)).toMatchObject({
        status: "completed",
        items: [{ name: "photo.jpg", assetId: photoId }]
      });
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
      const names = new Set(ids.map((id) => getAsset(db, id)!.name));
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
      expect(accepted.items.every((item) => names.has(item.name!))).toBe(true);
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
      expect(replay.items.map((item) => item.name)).toEqual(
        accepted.items.map((item) => item.name)
      );
      await manager.close();
      manager = new FileOperationManager(config, db);
      await manager.initialize();
      expect(manager.get(replay.id)?.items).toEqual(replay.items);
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
