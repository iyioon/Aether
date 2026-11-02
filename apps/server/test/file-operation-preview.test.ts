import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { buildApp } from "../src/http/app.js";
import { FileOperationsFilesystem } from "../src/library/file-operations-filesystem.js";
import {
  getLibraryRevision,
  getManagedAsset,
  getManagedFolder,
  getTrashRecord,
  listTrash
} from "../src/library/repository-management.js";
import {
  folderIdFor,
  listAssets,
  listFolders
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";
import { previewFileOperation } from "../src/library/file-operation-preview.js";
import type {
  FileOperationPreview,
  FileOperationPreviewRequest
} from "../src/library/file-operation-preview.js";
import type { FileOperationReceipt } from "../src/library/file-operations.js";

// Real disposable volumes and the production routes; every name probe is read-only.
describe.skipIf(process.platform !== "linux")(
  "file operation conflict preview",
  () => {
    let directory: string;
    let config: AppConfig;
    let db: AetherDatabase;
    let app: FastifyInstance;
    let headers: Record<string, string>;
    let firstId: string;
    let secondId: string;
    let destinationId: string;
    let sourceFolderId: string;
    let rootFolderId: string;
    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "aether-preview-"));
      for (const folder of [
        "media/Sources/A",
        "media/Sources/B",
        "media/Sources/Album/Child",
        "media/Destination/Album",
        "readonly"
      ])
        await mkdir(path.join(directory, folder), { recursive: true });
      const image = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#88aa77" }
      })
        .jpeg()
        .toBuffer();
      for (const file of [
        "media/Sources/A/photo.jpg",
        "media/Sources/B/photo.jpg",
        "media/Destination/indexed.jpg",
        "readonly/read-only.jpg"
      ])
        await writeFile(path.join(directory, file), image);
      config = await loadConfig(
        {
          AETHER_MEDIA_ROOTS: "library=./media,readonly=./readonly",
          AETHER_WRITABLE_ROOTS: "library",
          AETHER_DATA_DIR: "./data",
          AETHER_PASSWORD_HASH: await hashPassword("preview-password"),
          AETHER_SESSION_SECRET: "preview-test-session-secret-long-enough",
          AETHER_MIN_FREE_BYTES: "0",
          NODE_ENV: "test"
        },
        directory
      );
      db = openDatabase(config.configDir);
      await scanLibrary(db, config.mediaRoots);
      app = await buildApp({ config, db, logger: false });
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { password: "preview-password" }
      });
      headers = {
        cookie: login.cookies
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; "),
        "x-csrf-token": login.cookies.find(
          (cookie) => cookie.name === "aether_csrf"
        )!.value
      };
      const rootId = config.mediaRoots[0]!.id;
      rootFolderId = folderIdFor(rootId, "");
      const records = listAssets(db, {
        folderId: rootFolderId,
        recursive: true,
        sort: "filename",
        type: "all",
        limit: 100,
        offset: 0
      })!.items;
      firstId = records.find(
        (asset) =>
          getManagedAsset(db, asset.id)?.relativePath === "Sources/A/photo.jpg"
      )!.id;
      secondId = records.find(
        (asset) =>
          getManagedAsset(db, asset.id)?.relativePath === "Sources/B/photo.jpg"
      )!.id;
      destinationId = listFolders(db).find(
        (folder) => folder.relativePath === "Destination"
      )!.id;
      sourceFolderId = listFolders(db).find(
        (folder) => folder.relativePath === "Sources/Album"
      )!.id;
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await app?.close();
      db?.close();
      await rm(directory, { recursive: true, force: true });
    });
    function item(assetId = firstId, conflict?: "skip" | "keep-both") {
      return {
        assetId,
        expectedVersion: getManagedAsset(db, assetId)!.sourceVersion,
        ...(conflict ? { conflict } : {})
      };
    }
    function body(
      overrides: Partial<FileOperationPreviewRequest> = {}
    ): FileOperationPreviewRequest {
      return {
        type: "move-media",
        items: [item()],
        files: [],
        destinationFolderId: destinationId,
        expectedParentVersion: getManagedFolder(db, destinationId)!
          .sourceVersion,
        conflict: "skip",
        ...overrides
      };
    }
    async function preview(payload: object) {
      return app.inject({
        method: "POST",
        url: "/api/file-operations/preview",
        headers,
        payload
      });
    }
    async function operation(payload: Record<string, unknown>) {
      const accepted = await app.inject({
        method: "POST",
        url: "/api/file-operations",
        headers,
        payload
      });
      expect(accepted.statusCode).toBe(202);
      const id = accepted.json<{ id: string }>().id;
      let receipt: FileOperationReceipt;
      await vi.waitFor(
        async () => {
          receipt = (
            await app.inject({ url: `/api/file-operations/${id}`, headers })
          ).json<FileOperationReceipt>();
          expect(["queued", "running"]).not.toContain(receipt.status);
        },
        { timeout: 10_000 }
      );
      return receipt!;
    }
    async function unindexedCollisions() {
      await writeFile(
        path.join(directory, "media/Destination/photo.jpg"),
        "host file"
      );
      await mkdir(path.join(directory, "media/Destination/photo (2).jpg"));
      await symlink(
        "../Sources/A/photo.jpg",
        path.join(directory, "media/Destination/photo (3).jpg")
      );
    }

    it("requires authentication and CSRF without creating durable work", async () => {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/file-operations/preview",
            payload: body()
          })
        ).statusCode
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/file-operations/preview",
            headers: { cookie: headers.cookie! },
            payload: body()
          })
        ).statusCode
      ).toBe(403);
      const response = await preview(body());
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(db.prepare("SELECT id FROM file_operations").all()).toEqual([]);
      expect(db.prepare("SELECT id FROM managed_uploads").all()).toEqual([]);
    });

    it("hydrates batch sources once, reuses name probes and preserves requested order", async () => {
      const request = body({ items: [item(secondId), item(firstId)] });
      const prepare = vi.spyOn(db, "prepare");
      const response = await preview(request);
      expect(response.statusCode).toBe(200);
      const reads = prepare.mock.calls.map(([sql]) => sql.replace(/\s+/g, " "));
      expect(
        reads.filter(
          (sql) =>
            sql.includes("FROM assets a JOIN roots r") &&
            sql.includes("WHERE a.id IN")
        )
      ).toHaveLength(1);
      expect(
        reads.filter(
          (sql) =>
            sql.includes("FROM folders f JOIN roots r") &&
            sql.includes("WHERE f.id IN")
        )
      ).toHaveLength(1);
      expect(
        reads.filter((sql) => sql.includes("UNION ALL SELECT 1 FROM folders"))
      ).toHaveLength(1);
      expect(
        response.json<FileOperationPreview>().items.map((entry) => entry.key)
      ).toEqual([`asset:${secondId}`, `asset:${firstId}`]);
    });

    it("stops an aborted preview before reading sources or creating work", async () => {
      const filesystem = new FileOperationsFilesystem();
      const inspect = vi.spyOn(filesystem, "inspect");
      const unused = () => {
        throw new Error("An aborted preview must not access roots.");
      };
      await expect(
        previewFileOperation(
          db,
          filesystem,
          body(),
          {
            location: unused,
            rootLabel: unused,
            verifyAssetIdentity: unused
          },
          AbortSignal.abort()
        )
      ).rejects.toMatchObject({ code: "preview_cancelled" });
      expect(inspect).not.toHaveBeenCalled();
      expect(db.prepare("SELECT id FROM file_operations").all()).toEqual([]);
    });

    it("finds unindexed leaves and proposes the same suffixes as per-item publication", async () => {
      await unindexedCollisions();
      const items = [item(firstId, "keep-both"), item(secondId, "keep-both")];
      const revision = getLibraryRevision(db);
      const response = await preview(body({ items }));
      expect(response.statusCode).toBe(200);
      const result = response.json<FileOperationPreview>();
      expect(result.items.map((entry) => entry.proposedName)).toEqual([
        "photo (4).jpg",
        "photo (5).jpg"
      ]);
      expect(
        result.items.every((entry) => entry.hasConflict && !entry.noOp)
      ).toBe(true);
      expect(result.items[0]).toMatchObject({
        key: `asset:${firstId}`,
        index: 0,
        name: "photo.jpg",
        destinationLabel: "library/Destination",
        choice: "keep-both"
      });
      expect(response.body).not.toContain(directory);
      expect(getLibraryRevision(db)).toBe(revision);
      expect(db.prepare("SELECT id FROM file_operations").all()).toEqual([]);
      const request = {
        requestId: randomUUID(),
        type: "move-media",
        items,
        destinationFolderId: destinationId,
        expectedParentVersion: getManagedFolder(db, destinationId)!
          .sourceVersion,
        conflict: "skip"
      };
      expect((await operation(request)).status).toBe("completed");
      expect(getManagedAsset(db, firstId)?.name).toBe("photo (4).jpg");
      expect(getManagedAsset(db, secondId)?.name).toBe("photo (5).jpg");
      expect(
        await readFile(
          path.join(directory, "media/Destination/photo.jpg"),
          "utf8"
        )
      ).toBe("host file");
      const replay = await app.inject({
        method: "POST",
        url: "/api/file-operations",
        headers,
        payload: { ...request, items: [item(firstId, "skip")] }
      });
      expect(replay.statusCode).toBe(409);
      expect(replay.json()).toEqual({ error: "request_id_conflict" });
    });

    it("reserves only retained batch names and previews upload filenames without admission", async () => {
      const response = await preview(
        body({
          type: "add-media",
          items: [],
          files: [
            { clientId: "one", name: "new.jpg" },
            { clientId: "two", name: "new.jpg" },
            { clientId: "three", name: "new (2).jpg" }
          ]
        })
      );
      expect(response.statusCode).toBe(200);
      expect(
        response
          .json<FileOperationPreview>()
          .items.map((entry) => [entry.hasConflict, entry.proposedName])
      ).toEqual([
        [false, null],
        [true, "new (2).jpg"],
        [false, null]
      ]);
      const kept = await preview(
        body({
          type: "add-media",
          items: [],
          files: [
            { clientId: "one", name: "new.jpg" },
            { clientId: "two", name: "new.jpg", conflict: "keep-both" },
            { clientId: "three", name: "new (2).jpg" }
          ]
        })
      );
      expect(kept.json<FileOperationPreview>().items[2]).toMatchObject({
        hasConflict: true,
        proposedName: "new (2) (2).jpg"
      });
      expect(db.prepare("SELECT id FROM managed_uploads").all()).toEqual([]);
    });

    it("counts indexed missing records and existing folder names as occupied", async () => {
      await rm(path.join(directory, "media/Destination/indexed.jpg"));
      const response = await preview(
        body({
          type: "add-media",
          items: [],
          files: [{ clientId: "missing", name: "indexed.jpg" }]
        })
      );
      expect(response.json<FileOperationPreview>().items[0]).toMatchObject({
        hasConflict: true,
        proposedName: "indexed (2).jpg"
      });
      const folder = getManagedFolder(db, sourceFolderId)!;
      const folderPreview = await preview(
        body({
          type: "move-folder",
          items: [
            { folderId: folder.id, expectedVersion: folder.sourceVersion }
          ]
        })
      );
      expect(folderPreview.json<FileOperationPreview>().items[0]).toMatchObject(
        { name: "Album", hasConflict: true, proposedName: "Album (2)" }
      );
    });

    it("validates no-ops, folder descendants and restore's original destination", async () => {
      const source = getManagedAsset(db, firstId)!;
      const same = await preview(
        body({
          destinationFolderId: source.folderId!,
          expectedParentVersion: getManagedFolder(db, source.folderId!)!
            .sourceVersion
        })
      );
      expect(same.json<FileOperationPreview>().items[0]).toMatchObject({
        noOp: true,
        hasConflict: false,
        proposedName: null
      });
      const folder = getManagedFolder(db, sourceFolderId)!;
      const child = listFolders(db).find(
        (entry) => entry.relativePath === "Sources/Album/Child"
      )!;
      const descendant = await preview(
        body({
          type: "move-folder",
          items: [
            { folderId: folder.id, expectedVersion: folder.sourceVersion }
          ],
          destinationFolderId: child.id,
          expectedParentVersion: child.sourceVersion!
        })
      );
      expect(descendant.statusCode).toBe(400);
      const trashed = await operation({
        requestId: randomUUID(),
        type: "trash",
        items: [item()]
      });
      expect(trashed.status).toBe("completed");
      const retained = listTrash(db)[0]!;
      const restored = await preview({
        type: "restore",
        items: [
          {
            trashId: retained.id,
            expectedVersion: getTrashRecord(db, retained.id)!.sourceVersion
          }
        ]
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json<FileOperationPreview>().items[0]).toMatchObject({
        destinationFolderId: source.folderId,
        destinationLabel: "library/Sources/A",
        noOp: false
      });
    });

    it("rejects stale, read-only, unavailable and invalid inputs without leaking paths", async () => {
      expect(
        (
          await preview(
            body({
              type: "add-media",
              items: [],
              files: Array.from({ length: 101 }, (_, index) => ({
                clientId: `file-${index}`,
                name: "photo.jpg"
              }))
            })
          )
        ).statusCode
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/file-operations",
            headers,
            payload: {
              requestId: randomUUID(),
              type: "rename-media",
              name: "renamed",
              items: [item(firstId, "keep-both")]
            }
          })
        ).statusCode
      ).toBe(400);
      const staleSource = await preview(
        body({ items: [{ ...item(), expectedVersion: "old" }] })
      );
      expect(staleSource.statusCode).toBe(409);
      expect(staleSource.json()).toEqual({ error: "source_changed" });
      expect(
        (await preview(body({ expectedParentVersion: "old" }))).json()
      ).toEqual({ error: "destination_changed" });
      const readOnly = getManagedFolder(
        db,
        folderIdFor(config.mediaRoots[1]!.id, "")
      )!;
      expect(
        (
          await preview(
            body({
              destinationFolderId: readOnly.id,
              expectedParentVersion: readOnly.sourceVersion
            })
          )
        ).statusCode
      ).toBe(403);
      const readonlyAsset = listAssets(db, {
        folderId: readOnly.id,
        recursive: true,
        sort: "filename",
        type: "all",
        limit: 10,
        offset: 0
      })!.items[0]!;
      expect(
        (
          await preview(
            body({
              items: [
                {
                  assetId: readonlyAsset.id,
                  expectedVersion: readonlyAsset.sourceVersion!
                }
              ]
            })
          )
        ).statusCode
      ).toBe(403);
      const invalid = await preview(
        body({
          type: "add-media",
          items: [],
          files: [{ clientId: "path", name: "../private.jpg" }]
        })
      );
      expect(invalid.statusCode).toBe(400);
      await rename(
        path.join(directory, "media/Destination"),
        path.join(directory, "media/Disconnected")
      );
      const unavailable = await preview(body());
      expect(unavailable.statusCode).toBe(409);
      expect(unavailable.json()).toEqual({ error: "source_unavailable" });
      expect(unavailable.body).not.toContain(directory);
      expect(db.prepare("SELECT id FROM file_operations").all()).toEqual([]);
    });

    it("does not overwrite a name created after preview or at native publication", async () => {
      const request = body({
        destinationFolderId: rootFolderId,
        expectedParentVersion: getManagedFolder(db, rootFolderId)!.sourceVersion
      });
      expect(
        (await preview(request)).json<FileOperationPreview>().items[0]
          ?.hasConflict
      ).toBe(false);
      const before = await readFile(
        path.join(directory, "media/Sources/A/photo.jpg")
      );
      const originalRename = FileOperationsFilesystem.prototype.rename;
      vi.spyOn(
        FileOperationsFilesystem.prototype,
        "rename"
      ).mockImplementationOnce(async function (
        this: FileOperationsFilesystem,
        source,
        destination,
        expected
      ) {
        await writeFile(
          path.join(destination.rootPath, destination.relativePath),
          "host won",
          { flag: "wx" }
        );
        return originalRename.call(this, source, destination, expected);
      });
      const result = await operation({
        requestId: randomUUID(),
        type: request.type,
        items: request.items,
        destinationFolderId: request.destinationFolderId,
        expectedParentVersion: request.expectedParentVersion,
        conflict: "skip"
      });
      expect(result).toMatchObject({
        status: "needs_attention",
        items: [{ errorCode: "destination_exists" }]
      });
      expect(
        await readFile(path.join(directory, "media/photo.jpg"), "utf8")
      ).toBe("host won");
      expect(
        await readFile(path.join(directory, "media/Sources/A/photo.jpg"))
      ).toEqual(before);
    });
  }
);
