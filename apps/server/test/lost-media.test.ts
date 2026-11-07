import { createHash, randomUUID } from "node:crypto";
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
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { resolveDataPaths } from "../src/config/data-directory.js";
import { openDatabase, type AetherDatabase } from "../src/db/database.js";
import { folderIdFor, listAssets } from "../src/library/repository.js";
import {
  createManagedOperation,
  createEmptyTrashOperation,
  countTrash,
  getLibraryRevision,
  getManagedOperation,
  getManagedRootOwnership,
  getTrashRecord,
  getWriteReconciliationRequired,
  listManagedOperationItems,
  listPendingManagedOperations,
  managedOperationItemSummary,
  markTrashed,
  purgeTrashedAsset,
  saveManagedRootOwnership,
  updateManagedOperation,
  updateManagedOperationItem
} from "../src/library/repository-management.js";
import {
  createManagedUpload,
  getManagedUpload
} from "../src/library/repository-uploads.js";
import { scanLibrary } from "../src/library/scanner.js";
import {
  acknowledgeLostMedia,
  listLostMediaRecovery
} from "../src/maintenance/lost-media.js";
import { acquireRuntimeLock } from "../src/maintenance/runtime-lock.js";

describe("offline lost media acknowledgement", () => {
  let workspace: string;
  let config: AppConfig;
  let db: AetherDatabase;
  let rootId: string;
  let trashId: string;
  let assetId: string;
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "aether-lost-media-"));
    await mkdir(path.join(workspace, "media"));
    await mkdir(path.join(workspace, "other"));
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#77aa88" }
    })
      .jpeg()
      .toFile(path.join(workspace, "media", "photo.jpg"));
    config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "library=./media,other=./other",
        AETHER_DATA_DIR: "./data"
      },
      workspace
    );
    db = openDatabase(config.configDir);
    await scanLibrary(db, config.mediaRoots);
    rootId = config.mediaRoots[0]!.id;
    const info = await stat(config.mediaRoots[0]!.realPath, { bigint: true });
    saveManagedRootOwnership(db, {
      rootId,
      deviceId: String(info.dev),
      inode: String(info.ino)
    });
    const asset = listAssets(db, {
      folderId: folderIdFor(rootId, ""),
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items[0]!;
    assetId = asset.id;
    trashId = `${randomUUID()}-0`;
    await mkdir(path.join(workspace, "media", ".aether-trash", "retained"), {
      recursive: true,
      mode: 0o700
    });
    await rename(
      path.join(workspace, "media", "photo.jpg"),
      path.join(workspace, "media", ".aether-trash", "retained", "payload")
    );
    markTrashed(db, {
      assetId,
      expectedVersion: asset.sourceVersion!,
      trashId,
      physicalRelativePath: ".aether-trash/retained/payload",
      expiresAt: "2099-01-01T00:00:00Z"
    });
  });
  afterEach(async () => {
    db.close();
    await rm(workspace, { recursive: true, force: true });
  });
  function options() {
    return {
      paths: resolveDataPaths({ AETHER_DATA_DIR: "./data" }, workspace),
      workspaceRoot: workspace,
      mediaRootPaths: config.mediaRoots.map((root) => root.realPath),
      rootId,
      trashIds: [trashId],
      operationIds: [],
      confirmLostMedia: true
    };
  }
  async function disconnect() {
    await rename(
      path.join(workspace, "media"),
      path.join(workspace, "disconnected")
    );
  }

  async function addRetained(rootIndex: number, name: string) {
    const root = config.mediaRoots[rootIndex]!;
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#88aa77" }
    })
      .jpeg()
      .toFile(path.join(root.realPath, name));
    await scanLibrary(db, config.mediaRoots);
    const asset = listAssets(db, {
      folderId: folderIdFor(root.id, ""),
      offset: 0,
      limit: 10,
      sort: "filename",
      type: "all",
      recursive: true
    })!.items.find((entry) => entry.name === name)!;
    const relativePath = `.aether-trash/${randomUUID()}/payload`;
    await mkdir(path.dirname(path.join(root.realPath, relativePath)), {
      recursive: true,
      mode: 0o700
    });
    await rename(
      path.join(root.realPath, name),
      path.join(root.realPath, relativePath)
    );
    return markTrashed(db, {
      assetId: asset.id,
      expectedVersion: asset.sourceVersion!,
      trashId: `${randomUUID()}-0`,
      physicalRelativePath: relativePath,
      expiresAt: "2099-01-01T00:00:00Z"
    });
  }

  function emptySnapshot() {
    const id = randomUUID();
    return createEmptyTrashOperation(db, {
      id,
      requestJson: JSON.stringify({
        requestId: id,
        type: "empty-trash",
        items: [],
        expectedRevision: getLibraryRevision(db),
        expectedCount: countTrash(db),
        conflict: "skip"
      }),
      expectedRevision: getLibraryRevision(db),
      expectedCount: countTrash(db)
    }).record;
  }

  async function prepareEmptyItem(operationId: string, retainedId: string) {
    const stored = listManagedOperationItems(db, operationId).find(
      (entry) => JSON.parse(entry.journalJson).input.trashId === retainedId
    )!;
    const retained = getTrashRecord(db, retainedId)!;
    const payloadPath = path.join(
      retained.rootRealPath,
      retained.physicalRelativePath
    );
    const [info, bytes] = await Promise.all([
      stat(payloadPath, { bigint: true }),
      readFile(payloadPath)
    ]);
    const item = {
      ...JSON.parse(stored.journalJson),
      input: { trashId: retainedId, expectedVersion: retained.sourceVersion },
      status: "needs_attention",
      phase: "prepared",
      source: {
        rootId: retained.identity.rootId,
        relativePath: retained.physicalRelativePath
      },
      sourceAssetId: retained.assetId,
      manifest: {
        totalBytes: bytes.length,
        entries: [
          {
            relativePath: "",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            identity: {
              dev: String(info.dev),
              ino: String(info.ino),
              size: String(info.size),
              mtimeNs: String(info.mtimeNs),
              ctimeNs: String(info.ctimeNs),
              mode: Number(info.mode & 0o7777n),
              kind: "file"
            }
          }
        ]
      }
    };
    updateManagedOperationItem(
      db,
      operationId,
      stored.id,
      {
        status: item.status,
        phase: item.phase,
        journalJson: JSON.stringify(item)
      },
      {
        status: "needs_attention",
        stateJson: getManagedOperation(db, operationId)!.stateJson
      }
    );
    return stored.id;
  }

  it("requires explicit confirmation and refuses an original drive that is still available", async () => {
    await expect(
      acknowledgeLostMedia({ ...options(), confirmLostMedia: false })
    ).rejects.toThrow("--confirm-lost-media");
    await expect(acknowledgeLostMedia(options())).rejects.toThrow(
      "still available"
    );
    expect(getTrashRecord(db, trashId)).not.toBeNull();
  });

  it("lists bounded recovery IDs without exposing media locations or changing records", async () => {
    for (let index = 0; index < 101; index++) {
      const id = randomUUID();
      createManagedOperation(db, {
        id,
        requestJson: JSON.stringify({
          requestId: id,
          type: "trash",
          items: [{ assetId, expectedVersion: "version" }]
        }),
        stateJson: JSON.stringify({
          items: [{ source: { rootId, relativePath: "private-photo.jpg" } }],
          cancelRequested: false
        })
      });
    }
    const first = await listLostMediaRecovery(options());
    expect(first.records).toHaveLength(100);
    expect(first.nextCursor).toMatch(/^operation:/);
    expect(
      first.records.every(
        (record) => record.rootIds.length === 1 && record.rootIds[0] === rootId
      )
    ).toBe(true);
    const second = await listLostMediaRecovery({
      ...options(),
      after: first.nextCursor!
    });
    expect(second.records).toHaveLength(2);
    expect(second.records).toContainEqual({
      kind: "trash",
      id: trashId,
      rootIds: [rootId],
      status: "trashed"
    });
    expect(second.nextCursor).toBeNull();
    const serialized = JSON.stringify([first, second]);
    expect(serialized).not.toContain(workspace);
    expect(serialized).not.toContain("private-photo.jpg");
    expect(getTrashRecord(db, trashId)).not.toBeNull();
    await expect(
      listLostMediaRecovery({ ...options(), after: "../invalid" })
    ).rejects.toThrow("cursor");
  });

  it("refuses to acknowledge the original drive remounted at another configured root", async () => {
    await disconnect();
    await expect(
      acknowledgeLostMedia({
        ...options(),
        mediaRootPaths: [
          path.join(workspace, "media"),
          path.join(workspace, "disconnected")
        ]
      })
    ).rejects.toThrow("still available");
    expect(getTrashRecord(db, trashId)).not.toBeNull();
  });

  it("forgets only named metadata on a lost drive and never removes its files or ownership", async () => {
    const ownership = getManagedRootOwnership(db, rootId);
    await disconnect();
    await mkdir(path.join(workspace, "media"));
    await writeFile(
      path.join(workspace, "media", "replacement.jpg"),
      "replacement"
    );
    const result = await acknowledgeLostMedia(options());
    expect(result).toMatchObject({
      rootId,
      trashIds: [trashId],
      operationIds: []
    });
    expect(JSON.stringify(result)).not.toContain(workspace);
    expect(getTrashRecord(db, trashId)).toBeNull();
    expect(getManagedRootOwnership(db, rootId)).toEqual(ownership);
    expect(getWriteReconciliationRequired(db)).toBe(true);
    expect(
      (
        await readFile(
          path.join(
            workspace,
            "disconnected",
            ".aether-trash",
            "retained",
            "payload"
          )
        )
      ).length
    ).toBeGreaterThan(0);
    expect(
      await readFile(path.join(workspace, "media", "replacement.jpg"), "utf8")
    ).toBe("replacement");
    expect(
      db.prepare("SELECT root_id FROM media_loss_acknowledgements").all()
    ).toEqual([{ root_id: rootId }]);
  });

  it("rejects mismatched record IDs atomically", async () => {
    await disconnect();
    await expect(
      acknowledgeLostMedia({
        ...options(),
        trashIds: [trashId, "missing-record"]
      })
    ).rejects.toThrow("lost_media_record_mismatch");
    expect(getTrashRecord(db, trashId)).not.toBeNull();
    expect(
      db.prepare("SELECT id FROM media_loss_acknowledgements").all()
    ).toEqual([]);
  });

  it("acknowledges only unresolved operations wholly confined to the lost root", async () => {
    const id = randomUUID();
    const record = createManagedOperation(db, {
      id,
      requestJson: JSON.stringify({
        requestId: id,
        type: "trash",
        items: [{ assetId, expectedVersion: "source-version" }]
      }),
      stateJson: JSON.stringify({
        items: [
          {
            status: "needs_attention",
            source: { rootId, relativePath: "photo.jpg" },
            destination: {
              rootId,
              relativePath: ".aether-trash/pending/payload"
            }
          }
        ],
        cancelRequested: false
      })
    });
    updateManagedOperation(db, record.record.id, {
      status: "needs_attention",
      stateJson: record.record.stateJson
    });
    await disconnect();
    await acknowledgeLostMedia({
      ...options(),
      trashIds: [],
      operationIds: [id]
    });
    expect(getManagedOperation(db, id)?.status).toBe("failed");
    expect(JSON.parse(getManagedOperation(db, id)!.stateJson)).toMatchObject({
      lossAcknowledgement: { rootId, operationIds: [id] },
      items: [{ status: "failed", errorCode: "media_lost" }]
    });
    expect(getTrashRecord(db, trashId)).not.toBeNull();
  });

  it("retains guards for cross-root work and a running server", async () => {
    const id = randomUUID();
    const record = createManagedOperation(db, {
      id,
      requestJson: JSON.stringify({
        requestId: id,
        type: "trash",
        items: [{ assetId, expectedVersion: "source-version" }]
      }),
      stateJson: JSON.stringify({
        items: [
          {
            source: { rootId, relativePath: "photo.jpg" },
            destination: { rootId: "another-root", relativePath: "copy.jpg" }
          }
        ]
      })
    });
    updateManagedOperation(db, record.record.id, {
      status: "needs_attention",
      stateJson: record.record.stateJson
    });
    await disconnect();
    await expect(
      acknowledgeLostMedia({ ...options(), trashIds: [], operationIds: [id] })
    ).rejects.toThrow("crosses_roots");
    const release = await acquireRuntimeLock(options().paths, "runtime");
    try {
      await expect(acknowledgeLostMedia(options())).rejects.toThrow();
    } finally {
      await release();
    }
    expect(getTrashRecord(db, trashId)).not.toBeNull();
    expect(getManagedOperation(db, id)?.status).toBe("needs_attention");
  });

  it("requires both the Empty Trash operation and a matching retained record", async () => {
    const operation = emptySnapshot();
    await prepareEmptyItem(operation.id, trashId);
    await disconnect();
    await expect(acknowledgeLostMedia(options())).rejects.toThrow(
      "lost_media_record_mismatch"
    );
    await expect(
      acknowledgeLostMedia({
        ...options(),
        trashIds: [],
        operationIds: [operation.id]
      })
    ).rejects.toThrow("lost_media_record_mismatch");
    expect(getTrashRecord(db, trashId)).not.toBeNull();
    expect(getManagedOperation(db, operation.id)?.status).toBe(
      "needs_attention"
    );
  });

  it.each([
    { label: "a saved basename", name: "photo.jpg" },
    { label: "an earlier journal without a label", name: undefined },
    { label: "a legacy Unix basename", name: "legacy\\photo\n .jpg" },
    {
      label: "an expanded Unicode basename",
      name: `${"e\u0301".repeat(200)}.jpg`
    }
  ])(
    "acknowledges a lost Empty Trash purge with $label without touching retained bytes",
    async ({ name }) => {
      const operation = emptySnapshot();
      const itemId = await prepareEmptyItem(operation.id, trashId);
      const stored = listManagedOperationItems(db, operation.id)[0]!;
      const journal = JSON.parse(stored.journalJson) as Record<string, unknown>;
      if (name === undefined) delete journal.name;
      else journal.name = name;
      db.prepare(
        "UPDATE file_operation_items SET journal_json = ? WHERE id = ?"
      ).run(JSON.stringify(journal), itemId);
      const before = await readFile(
        path.join(workspace, "media", ".aether-trash", "retained", "payload")
      );
      const ownership = getManagedRootOwnership(db, rootId);
      await disconnect();
      await acknowledgeLostMedia({
        ...options(),
        operationIds: [operation.id]
      });
      expect(getTrashRecord(db, trashId)).toBeNull();
      expect(getManagedOperation(db, operation.id)?.status).toBe("failed");
      expect(managedOperationItemSummary(db, operation.id)).toMatchObject({
        total: 1,
        failed: 1
      });
      expect(
        JSON.parse(listManagedOperationItems(db, operation.id)[0]!.journalJson)
      ).toMatchObject({
        status: "failed",
        errorCode: "media_lost",
        snapshotRootId: rootId
      });
      expect(
        await readFile(
          path.join(
            workspace,
            "disconnected",
            ".aether-trash",
            "retained",
            "payload"
          )
        )
      ).toEqual(before);
      expect(getManagedRootOwnership(db, rootId)).toEqual(ownership);
      expect(getWriteReconciliationRequired(db)).toBe(true);
    }
  );

  it.each([
    { label: "a non-text value", name: 7 },
    { label: "a nested object", name: { source: { rootId: "another-root" } } },
    { label: "an absolute path", name: "/private/photo.jpg" },
    { label: "a relative path", name: "../photo.jpg" },
    { label: "an embedded NUL", name: "photo\0.jpg" },
    { label: "an oversized basename", name: "x".repeat(4097) }
  ])(
    "rejects an Empty Trash display label containing $label atomically",
    async ({ name }) => {
      const operation = emptySnapshot();
      const itemId = await prepareEmptyItem(operation.id, trashId);
      const stored = listManagedOperationItems(db, operation.id)[0]!;
      const journal = { ...JSON.parse(stored.journalJson), name };
      db.prepare(
        "UPDATE file_operation_items SET journal_json = ? WHERE id = ?"
      ).run(JSON.stringify(journal), itemId);
      await disconnect();
      await expect(
        acknowledgeLostMedia({ ...options(), operationIds: [operation.id] })
      ).rejects.toThrow("lost_media_operation_unsupported");
      expect(getTrashRecord(db, trashId)).not.toBeNull();
      expect(getManagedOperation(db, operation.id)?.status).toBe(
        "needs_attention"
      );
      expect(listManagedOperationItems(db, operation.id)[0]?.journalJson).toBe(
        JSON.stringify(journal)
      );
      expect(
        db.prepare("SELECT id FROM media_loss_acknowledgements").all()
      ).toEqual([]);
    }
  );

  it("forgets only supplied Trash IDs when stopping a larger lost-root snapshot", async () => {
    const retained = await addRetained(0, "second.jpg");
    const operation = emptySnapshot();
    await prepareEmptyItem(operation.id, trashId);
    await disconnect();
    await acknowledgeLostMedia({ ...options(), operationIds: [operation.id] });
    expect(getTrashRecord(db, trashId)).toBeNull();
    expect(getTrashRecord(db, retained.id)).not.toBeNull();
    expect(managedOperationItemSummary(db, operation.id)).toMatchObject({
      total: 2,
      failed: 2
    });
    expect(
      await readFile(
        path.join(workspace, "disconnected", retained.physicalRelativePath)
      )
    ).toHaveLength(retained.identity.sizeBytes);
    await acknowledgeLostMedia({ ...options(), trashIds: [retained.id] });
    expect(getTrashRecord(db, retained.id)).toBeNull();
  });

  it("preserves completed results and cancels untouched other-root work so the required scan can run", async () => {
    const other = await addRetained(1, "available.jpg");
    const done = await addRetained(0, "done.jpg");
    const operation = emptySnapshot();
    await prepareEmptyItem(operation.id, trashId);
    const rows = listManagedOperationItems(db, operation.id);
    const completed = rows.find(
      (row) => JSON.parse(row.journalJson).input.trashId === done.id
    )!;
    const doneJson = JSON.stringify({
      ...JSON.parse(completed.journalJson),
      status: "completed",
      phase: "committed"
    });
    db.prepare(
      "UPDATE file_operation_items SET status = 'completed', phase = 'committed', journal_json = ? WHERE id = ?"
    ).run(doneJson, completed.id);
    await rm(path.join(done.rootRealPath, done.physicalRelativePath));
    purgeTrashedAsset(db, done.id, done.sourceVersion);
    const otherBefore = rows.find(
      (row) => JSON.parse(row.journalJson).input.trashId === other.id
    )!;
    db.prepare(
      "UPDATE file_operation_items SET status = 'running', journal_json = ? WHERE id = ?"
    ).run(
      JSON.stringify({
        ...JSON.parse(otherBefore.journalJson),
        status: "running"
      }),
      otherBefore.id
    );
    await disconnect();
    await acknowledgeLostMedia({ ...options(), operationIds: [operation.id] });
    const after = listManagedOperationItems(db, operation.id);
    expect(after.find((row) => row.id === completed.id)?.journalJson).toBe(
      doneJson
    );
    expect(after.find((row) => row.id === otherBefore.id)).toMatchObject({
      ...otherBefore,
      status: "cancelled",
      journalJson: JSON.stringify({
        ...JSON.parse(otherBefore.journalJson),
        status: "cancelled"
      })
    });
    expect(getManagedOperation(db, operation.id)?.status).toBe("partial");
    expect(managedOperationItemSummary(db, operation.id)).toMatchObject({
      total: 3,
      completed: 1,
      failed: 1,
      cancelled: 1
    });
    expect(getTrashRecord(db, other.id)).not.toBeNull();
    expect(
      await readFile(path.join(other.rootRealPath, other.physicalRelativePath))
    ).toHaveLength(other.identity.sizeBytes);
    expect(listPendingManagedOperations(db)).toEqual([]);
    expect(
      (
        await scanLibrary(
          db,
          config.mediaRoots.filter((root) => root.id !== rootId)
        )
      ).outcome
    ).toBe("completed");
    expect(getWriteReconciliationRequired(db)).toBe(false);
  });

  it("rejects acknowledgement while an unrelated claimed operation would prevent reconciliation", async () => {
    const otherRoot = config.mediaRoots[1]!;
    const id = randomUUID();
    const state = JSON.stringify({
      items: [
        {
          input: {
            folderId: folderIdFor(otherRoot.id, ""),
            expectedVersion: "version"
          },
          status: "needs_attention",
          phase: "prepared",
          destination: { rootId: otherRoot.id, relativePath: "new-folder" },
          stage: {
            rootId: otherRoot.id,
            relativePath: `.aether-staging/${id}/folder`
          }
        }
      ],
      cancelRequested: false
    });
    createManagedOperation(db, {
      id,
      requestJson: JSON.stringify({
        requestId: id,
        type: "create-folder",
        items: [],
        destinationFolderId: folderIdFor(otherRoot.id, ""),
        expectedParentVersion: "version",
        name: "new-folder"
      }),
      stateJson: state
    });
    updateManagedOperation(db, id, {
      status: "needs_attention",
      stateJson: state
    });
    await writeFile(
      path.join(otherRoot.realPath, "keep.txt"),
      "available bytes"
    );
    await disconnect();
    await expect(acknowledgeLostMedia(options())).rejects.toThrow(
      "other roots"
    );
    expect(getWriteReconciliationRequired(db)).toBe(false);
    expect(getManagedOperation(db, id)).toMatchObject({
      status: "needs_attention",
      stateJson: state
    });
    expect(getTrashRecord(db, trashId)).not.toBeNull();
    expect(
      db.prepare("SELECT id FROM media_loss_acknowledgements").all()
    ).toEqual([]);
    expect(
      await readFile(path.join(otherRoot.realPath, "keep.txt"), "utf8")
    ).toBe("available bytes");
    updateManagedOperation(db, id, { status: "cancelled", stateJson: state });
    await acknowledgeLostMedia(options());
    expect((await scanLibrary(db, [otherRoot])).outcome).toBe("completed");
    expect(getWriteReconciliationRequired(db)).toBe(false);
  });

  it.each([
    { label: "saved names", name: "queued" },
    { label: "legacy names", name: "legacy\\folder\n " },
    { label: "expanded Unicode names", name: "e\u0301".repeat(200) },
    { label: "earlier unnamed journals", name: undefined }
  ])(
    "cancels only untouched unrelated queued requests with $label before requiring a scan",
    async ({ name }) => {
      const otherRoot = config.mediaRoots[1]!;
      const id = randomUUID();
      const input = {
        folderId: folderIdFor(otherRoot.id, ""),
        expectedVersion: "version"
      };
      createManagedOperation(db, {
        id,
        requestJson: JSON.stringify({
          requestId: id,
          type: "create-folder",
          items: [],
          destinationFolderId: input.folderId,
          expectedParentVersion: input.expectedVersion,
          name: "queued"
        }),
        stateJson: JSON.stringify({
          items: [{ input, name, status: "queued" }],
          cancelRequested: false
        })
      });
      await writeFile(
        path.join(otherRoot.realPath, "keep.txt"),
        "available bytes"
      );
      await disconnect();
      const acknowledged = await acknowledgeLostMedia(options());
      expect(getManagedOperation(db, id)?.status).toBe("cancelled");
      expect(JSON.parse(getManagedOperation(db, id)!.stateJson)).toMatchObject({
        cancelRequested: true,
        cancelledForReconciliation: acknowledged.id,
        items: [
          {
            input,
            ...(name === undefined ? {} : { name }),
            status: "cancelled"
          }
        ]
      });
      expect(listPendingManagedOperations(db)).toEqual([]);
      expect(
        await readFile(path.join(otherRoot.realPath, "keep.txt"), "utf8")
      ).toBe("available bytes");
      expect((await scanLibrary(db, [otherRoot])).outcome).toBe("completed");
      expect(getWriteReconciliationRequired(db)).toBe(false);
    }
  );

  it("preserves upload staging and requires uploads to finish or cancel before loss acknowledgement", async () => {
    const id = randomUUID();
    createManagedUpload(
      db,
      {
        id,
        requestId: randomUUID(),
        folderId: folderIdFor(config.mediaRoots[1]!.id, ""),
        expectedParentVersion: "version",
        name: "upload.jpg",
        conflict: "skip",
        size: 4,
        offset: 0,
        status: "receiving",
        expiresAt: "2099-01-01T00:00:00Z"
      },
      1024
    );
    const staging = path.join(config.dataDir, "uploads", id);
    await mkdir(path.dirname(staging), { recursive: true, mode: 0o700 });
    await writeFile(staging, "keep");
    await disconnect();
    await expect(acknowledgeLostMedia(options())).rejects.toThrow("uploads");
    expect(getManagedUpload(db, id)?.status).toBe("receiving");
    expect(await readFile(staging, "utf8")).toBe("keep");
    expect(getWriteReconciliationRequired(db)).toBe(false);
    expect(getTrashRecord(db, trashId)).not.toBeNull();
  });

  it("rejects a claimed purge on another root atomically", async () => {
    const other = await addRetained(1, "available.jpg");
    const operation = emptySnapshot();
    await prepareEmptyItem(operation.id, trashId);
    await prepareEmptyItem(operation.id, other.id);
    const before = listManagedOperationItems(db, operation.id);
    await disconnect();
    await expect(
      acknowledgeLostMedia({ ...options(), operationIds: [operation.id] })
    ).rejects.toThrow("crosses_roots");
    expect(listManagedOperationItems(db, operation.id)).toEqual(before);
    expect(getTrashRecord(db, trashId)).not.toBeNull();
    expect(getTrashRecord(db, other.id)).not.toBeNull();
    expect(
      db.prepare("SELECT id FROM media_loss_acknowledgements").all()
    ).toEqual([]);
  });

  it("retains a committed purge whose final receipt was interrupted", async () => {
    const done = await addRetained(0, "done.jpg");
    const operation = emptySnapshot();
    await prepareEmptyItem(operation.id, trashId);
    const doneRowId = await prepareEmptyItem(operation.id, done.id);
    const row = listManagedOperationItems(db, operation.id).find(
      (item) => item.id === doneRowId
    )!;
    const journal = { ...JSON.parse(row.journalJson), phase: "published" };
    db.prepare(
      "UPDATE file_operation_items SET phase = 'published', journal_json = ? WHERE id = ?"
    ).run(JSON.stringify(journal), doneRowId);
    await rm(path.join(done.rootRealPath, done.physicalRelativePath));
    purgeTrashedAsset(db, done.id, done.sourceVersion);
    await disconnect();
    await acknowledgeLostMedia({ ...options(), operationIds: [operation.id] });
    expect(getManagedOperation(db, operation.id)?.status).toBe("partial");
    expect(managedOperationItemSummary(db, operation.id)).toMatchObject({
      total: 2,
      completed: 1,
      failed: 1
    });
    expect(
      JSON.parse(
        listManagedOperationItems(db, operation.id).find(
          (item) => item.id === doneRowId
        )!.journalJson
      )
    ).toMatchObject({ status: "completed", phase: "published" });
  });

  it("refuses missing snapshot ownership and journals with another copy", async () => {
    const operation = emptySnapshot();
    const rowId = await prepareEmptyItem(operation.id, trashId);
    const original = listManagedOperationItems(db, operation.id)[0]!
      .journalJson;
    const journal = JSON.parse(original) as Record<string, unknown>;
    delete journal.snapshotRootId;
    db.prepare(
      "UPDATE file_operation_items SET journal_json = ? WHERE id = ?"
    ).run(JSON.stringify(journal), rowId);
    await disconnect();
    await expect(
      acknowledgeLostMedia({ ...options(), operationIds: [operation.id] })
    ).rejects.toThrow("unsupported");
    db.prepare(
      "UPDATE file_operation_items SET journal_json = ? WHERE id = ?"
    ).run(
      JSON.stringify({
        ...JSON.parse(original),
        destination: { rootId: "another-root", relativePath: "copy.jpg" }
      }),
      rowId
    );
    await expect(
      acknowledgeLostMedia({ ...options(), operationIds: [operation.id] })
    ).rejects.toThrow("unsupported");
    db.prepare(
      "UPDATE file_operation_items SET journal_json = ? WHERE id = ?"
    ).run(
      JSON.stringify({
        ...JSON.parse(original),
        manifest: { entries: [], totalBytes: 0 }
      }),
      rowId
    );
    await expect(
      acknowledgeLostMedia({ ...options(), operationIds: [operation.id] })
    ).rejects.toThrow("unsupported");
    expect(getTrashRecord(db, trashId)).not.toBeNull();
    expect(
      db.prepare("SELECT id FROM media_loss_acknowledgements").all()
    ).toEqual([]);
  });
});
