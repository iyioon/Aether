import { createHash, randomUUID } from "node:crypto";
import { realpath, statfs } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, MediaRootConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import {
  FileOperationsFilesystem,
  FileOperationFilesystemError,
  DEFAULT_FILE_OPERATION_LIMITS,
  type FileOperationIdentity,
  type FileOperationLocation,
  type FileOperationManifest
} from "./file-operations-filesystem.js";
import {
  FileManagementError,
  FileOperationBody,
  validateManagedName,
  type FileOperationRequest,
  type FileOperationRequestItem,
  type FileOperationStatus
} from "./file-operation-model.js";
import { withLibraryMutationLock } from "./library-mutation-lock.js";
import {
  managedConflictName,
  previewFileOperation,
  type FileOperationPreviewRequest,
  type FileOperationPreview
} from "./file-operation-preview.js";
import { getAsset, getAssetsByIds } from "./repository.js";
import { getFoldersByIds } from "./repository-folders.js";
import {
  commitAssetLocation,
  commitFolderLocation,
  commitUploadedAsset,
  createManagedFolder,
  createManagedOperation,
  createEmptyTrashOperation,
  cancelEmptyTrashOperation,
  getLibraryRevision,
  getManagedAsset,
  getManagedAssetsByIds,
  getManagedFolder,
  getManagedFoldersByIds,
  getManagedOperation,
  getManagedRootOwnership,
  getWriteReconciliationRequired,
  getTrashRecord,
  getTrashRecordsByIds,
  createManagedDestinationProbe,
  getTrashNamesByIds,
  listManagedOperations,
  listPendingManagedOperations,
  listExpiredTrash,
  listManagedOperationItems,
  managedOperationItemSummary,
  hasCancellableManagedOperationItems,
  listPrunableManagedOperations,
  pruneManagedOperationReceipts,
  markTrashed,
  purgeTrashedAsset,
  restoreTrashedAsset,
  saveManagedRootOwnership,
  updateManagedOperation,
  updateManagedOperationItem,
  type ManagedAsset,
  type ManagedFileIdentity,
  type ManagedOperationRecord,
  type ManagedOperationItemRecord,
  type ManagedOperationSummary
} from "./repository-management.js";
import { sourceVersion } from "./source-version.js";
import type { AssetRecord, FolderRecord } from "./repository-types.js";
import { detectMediaType } from "./media-types.js";
import {
  captureTrashThumbnail,
  removeTrashThumbnail
} from "./trash-thumbnails.js";
import { uploadVolumeReservations } from "./repository-uploads.js";

interface Location {
  rootId: string;
  relativePath: string;
}
interface ItemJournal {
  input: FileOperationRequestItem;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "needs_attention";
  phase?:
    "prepared" | "copied" | "published" | "committed" | "retired" | "purging";
  source?: Location;
  destination?: Location;
  expected?: FileOperationIdentity;
  published?: FileOperationIdentity;
  manifest?: FileOperationManifest;
  publishedManifest?: FileOperationManifest;
  retiredManifest?: FileOperationManifest;
  sourceAssetId?: string;
  destinationFolderId?: string;
  destinationParent?: FileOperationIdentity;
  uploadRootIdentity?: { dev: string; ino: string };
  stage?: Location;
  stageIdentity?: FileOperationIdentity;
  quarantine?: Location;
  crossDevice?: boolean;
  errorCode?: string;
  asset?: AssetRecord;
  folder?: FolderRecord;
  trashId?: string;
}
interface OperationJournal {
  items: ItemJournal[];
  cancelRequested: boolean;
}

export interface FileOperationReceipt {
  id: string;
  type: FileOperationRequest["type"];
  status: FileOperationStatus;
  items: Array<{
    assetId?: string;
    folderId?: string;
    trashId?: string;
    status: ItemJournal["status"];
    errorCode?: string;
    name?: string;
    asset?: AssetRecord;
    folder?: FolderRecord;
  }>;
  revision: string;
  createdAt: string;
  updatedAt: string;
  canCancel?: boolean;
  retryInput?: Omit<FileOperationRequest, "requestId">;
  progress?: { bytes: number; totalBytes: number };
  summary?: ManagedOperationSummary;
}

/** One server-owned worker. Its journal survives disconnects and each publication
 * boundary; the scanner shares the same lock, never a transfer-long SQL transaction. */
export class FileOperationManager {
  private readonly writable = new Set<string>();
  private readonly unavailable = new Map<string, string>();
  private worker: Promise<void> = Promise.resolve();
  private closing = false;
  private active = false;
  private capabilityRefresh: Promise<void> | null = null;
  private maintenance: Promise<void> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly progress = new Map<
    string,
    { bytes: number; totalBytes: number }
  >();

  constructor(
    private readonly config: AppConfig,
    private readonly db: AetherDatabase,
    private readonly filesystem = new FileOperationsFilesystem()
  ) {}

  get busy(): boolean {
    return this.active;
  }
  canWrite(rootId: string): boolean {
    return (
      this.writable.has(rootId) &&
      !this.closing &&
      !getWriteReconciliationRequired(this.db)
    );
  }
  rootStatus(rootId: string): { writable: boolean; reason: string | null } {
    return {
      writable: this.canWrite(rootId),
      reason: getWriteReconciliationRequired(this.db)
        ? "scan_required"
        : (this.unavailable.get(rootId) ?? null)
    };
  }

  async preview(
    input: FileOperationPreviewRequest,
    signal?: AbortSignal
  ): Promise<FileOperationPreview> {
    if (this.closing) throw new FileManagementError("server_closing");
    return withLibraryMutationLock(this.db, async () => {
      const roots = new Map<
        string,
        {
          root: MediaRootConfig;
          expectedRoot: { dev: string; ino: string };
        }
      >();
      const rootContext = (id: string) => {
        let context = roots.get(id);
        if (!context) {
          const root = this.requireRoot(id);
          const ownership = getManagedRootOwnership(this.db, id);
          if (!ownership) throw new FileManagementError("read_only");
          context = {
            root,
            expectedRoot: { dev: ownership.deviceId, ino: ownership.inode }
          };
          roots.set(id, context);
        }
        return context;
      };
      try {
        return await previewFileOperation(
          this.db,
          this.filesystem,
          input,
          {
            location: (rootId, relativePath) => {
              const context = rootContext(rootId);
              return {
                rootPath: context.root.realPath,
                relativePath,
                expectedRoot: context.expectedRoot
              };
            },
            verifyAssetIdentity: verifyIndexedIdentity,
            rootLabel: (id) => rootContext(id).root.label
          },
          signal
        );
      } catch (error) {
        if (error instanceof FileManagementError) throw error;
        throw new FileManagementError(errorCode(error));
      }
    });
  }

  async inspectFolder(folderId: string, expectedVersion: string) {
    return withLibraryMutationLock(this.db, async () => {
      const folder = getManagedFolder(this.db, folderId);
      if (!folder) throw new FileManagementError("source_not_found");
      this.requireRoot(folder.rootId);
      if (!folder.relativePath) throw new FileManagementError("protected_root");
      if (folder.sourceVersion !== expectedVersion)
        throw new FileManagementError("source_changed");
      try {
        const manifest = await this.filesystem.inventory(
          this.location({
            rootId: folder.rootId,
            relativePath: folder.relativePath
          })
        );
        const identity = manifest.entries[0]?.identity;
        if (
          !identity ||
          identity.dev !== folder.fsDeviceId ||
          identity.ino !== folder.fsInode
        )
          throw new FileManagementError("source_changed");
        return {
          sourceVersion: folder.sourceVersion,
          inventoryVersion: inventoryVersion(manifest),
          files: manifest.entries.filter(
            (entry) => entry.identity.kind === "file"
          ).length,
          folders: manifest.entries.filter(
            (entry) => entry.relativePath && entry.identity.kind === "directory"
          ).length,
          totalBytes: manifest.totalBytes
        };
      } catch (error) {
        if (error instanceof FileOperationFilesystemError)
          throw new FileManagementError(error.code);
        throw error;
      }
    });
  }

  async initialize(): Promise<void> {
    await this.initializeCapabilities();
    for (const operation of listPendingManagedOperations(this.db)) {
      if (["queued", "running", "needs_attention"].includes(operation.status))
        this.enqueue(operation.id);
    }
    await this.worker;
    await this.runMaintenance();
    if (!this.closing && !this.maintenanceTimer) {
      this.maintenanceTimer = setInterval(() => {
        void this.runMaintenance().catch(() => undefined);
      }, 60_000);
      this.maintenanceTimer.unref();
    }
  }

  async runMaintenance(now = new Date()): Promise<void> {
    if (this.closing) return;
    if (this.maintenance) return this.maintenance;
    const maintenance = (async () => {
      if (this.active || listPendingManagedOperations(this.db).length) return;
      await this.refreshCapabilities();
      await withLibraryMutationLock(this.db, async () => {
        const before = new Date(now.getTime() - 7 * 86400_000).toISOString();
        const cleaned: string[] = [];
        for (const operation of listPrunableManagedOperations(
          this.db,
          before
        )) {
          if (this.closing) return;
          const journal = this.journal(operation);
          const roots = new Set(
            journal.items.flatMap((item) =>
              [
                item.source,
                item.destination,
                item.stage,
                item.quarantine
              ].flatMap((location) => (location ? [location.rootId] : []))
            )
          );
          let safe = true;
          for (const rootId of roots)
            for (const reserved of [".aether-staging", ".aether-trash"]) {
              try {
                const location = this.location({
                  rootId,
                  relativePath: `${reserved}/${operation.id}`
                });
                const existing = await this.optionalInspect(location);
                if (!existing) continue;
                const manifest = await this.filesystem.inventory(location);
                if (
                  manifest.entries.length !== 1 ||
                  existing.kind !== "directory" ||
                  existing.mode !== 0o700
                ) {
                  safe = false;
                  continue;
                }
                await this.filesystem.purgeOwned(location, manifest);
              } catch {
                safe = false;
              }
            }
          if (safe) cleaned.push(operation.id);
        }
        pruneManagedOperationReceipts(this.db, before, cleaned);
      });
      if (this.closing || listPendingManagedOperations(this.db).length) return;
      const expired = listExpiredTrash(this.db, now.toISOString()).filter(
        (record) => this.canWrite(record.identity.rootId)
      );
      if (expired.length) {
        this.submit(
          FileOperationBody.parse({
            requestId: randomUUID(),
            type: "purge",
            items: expired.map((record) => ({
              trashId: record.id,
              expectedVersion: record.sourceVersion
            }))
          })
        );
        await this.worker;
      }
    })();
    this.maintenance = maintenance;
    try {
      await maintenance;
    } finally {
      if (this.maintenance === maintenance) this.maintenance = null;
    }
  }

  async refreshCapabilities(): Promise<void> {
    if (
      this.closing ||
      this.active ||
      listPendingManagedOperations(this.db).some(
        (operation) =>
          operation.status === "queued" || operation.status === "running"
      )
    )
      return;
    if (this.capabilityRefresh) return this.capabilityRefresh;
    const refresh = withLibraryMutationLock(this.db, () =>
      this.initializeCapabilities(true)
    );
    this.capabilityRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (this.capabilityRefresh === refresh) this.capabilityRefresh = null;
    }
  }

  private async initializeCapabilities(
    retryUnavailable = false
  ): Promise<void> {
    for (const root of this.config.mediaRoots.filter(
      (entry) => entry.writable
    )) {
      try {
        const identity = await this.filesystem.inspectRoot(root.realPath);
        const previous = getManagedRootOwnership(this.db, root.id);
        if (
          previous &&
          (previous.deviceId !== identity.dev ||
            previous.inode !== identity.ino)
        )
          throw new FileManagementError("root_identity_changed");
        if (retryUnavailable && this.writable.has(root.id)) continue;
        let ownership = previous ?? {
          rootId: root.id,
          deviceId: identity.dev,
          inode: identity.ino
        };
        saveManagedRootOwnership(this.db, ownership);
        for (const [directory, key] of [
          [".aether-staging", "stageInode"],
          [".aether-trash", "trashInode"]
        ] as const) {
          const location = {
            rootPath: root.realPath,
            relativePath: directory,
            expectedRoot: identity
          };
          let entry = await this.optionalInspect(location);
          if (entry && entry.ino !== ownership[key])
            throw new FileManagementError("unknown_reserved_storage");
          if (!entry) {
            if (ownership[key])
              throw new FileManagementError("reserved_storage_missing");
            entry = await this.filesystem.createDirectory(location);
            ownership = { ...ownership, [key]: entry.ino };
            saveManagedRootOwnership(this.db, ownership);
          }
          if (entry.kind !== "directory" || entry.mode !== 0o700)
            throw new FileManagementError("unsafe_reserved_storage");
        }
        const probe = {
          rootPath: root.realPath,
          relativePath: `.aether-staging/probe-${randomUUID()}`,
          expectedRoot: identity
        };
        await this.filesystem.createDirectory(probe);
        await this.filesystem.probe(probe);
        await this.filesystem.purgeOwned(
          probe,
          await this.filesystem.inventory(probe)
        );
        this.writable.add(root.id);
        this.unavailable.delete(root.id);
      } catch (error) {
        this.writable.delete(root.id);
        this.unavailable.set(root.id, errorCode(error));
      }
    }
  }

  submit(input: FileOperationRequest): FileOperationReceipt {
    if (this.closing) throw new FileManagementError("server_closing");
    const request = FileOperationBody.parse(input);
    if (request.type === "empty-trash")
      return this.submitEmptyTrash({
        requestId: request.requestId,
        expectedRevision: request.expectedRevision!,
        expectedCount: request.expectedCount!
      });
    const existing = getManagedOperation(this.db, request.requestId);
    if (!existing) {
      if (
        listPendingManagedOperations(this.db).some(
          (entry) => entry.status === "needs_attention"
        )
      )
        throw new FileManagementError("recovery_required");
      if (
        listPendingManagedOperations(this.db).filter(
          (entry) => entry.status === "queued" || entry.status === "running"
        ).length >= 32
      )
        throw new FileManagementError("operation_queue_full");
      if (request.name) validateManagedName(request.name);
      if (request.type === "create-folder" || request.destinationFolderId)
        this.destinationFolder(
          request.destinationFolderId!,
          request.expectedParentVersion
        );
      const assets = getManagedAssetsByIds(
        this.db,
        request.items.flatMap((item) => (item.assetId ? [item.assetId] : []))
      );
      const folders = getManagedFoldersByIds(
        this.db,
        request.items.flatMap((item) => (item.folderId ? [item.folderId] : []))
      );
      const trash = getTrashRecordsByIds(
        this.db,
        request.items.flatMap((item) => (item.trashId ? [item.trashId] : []))
      );
      const checkedRoots = new Set<string>();
      for (const item of request.items) {
        const source = item.assetId
          ? assets.get(item.assetId)
          : item.folderId
            ? folders.get(item.folderId)
            : trash.get(item.trashId!);
        if (!source) throw new FileManagementError("source_not_found");
        if ("lifecycle" in source && source.lifecycle !== "active")
          throw new FileManagementError("source_not_found");
        const rootId =
          "rootId" in source ? source.rootId : source.identity.rootId;
        if (!checkedRoots.has(rootId)) {
          this.requireRoot(rootId);
          checkedRoots.add(rootId);
        }
        if (source.sourceVersion !== item.expectedVersion)
          throw new FileManagementError("source_changed");
      }
    }
    const journal: OperationJournal = {
      items:
        request.type === "create-folder" || request.type === "add-media"
          ? [
              {
                input: {
                  folderId: request.destinationFolderId!,
                  expectedVersion: request.expectedParentVersion!
                },
                status: "queued"
              }
            ]
          : request.items.map((item) => ({ input: item, status: "queued" })),
      cancelRequested: false
    };
    const created = createManagedOperation(this.db, {
      id: request.requestId,
      requestJson: JSON.stringify(request),
      stateJson: JSON.stringify(journal)
    });
    let record = created.record;
    if (record.status === "needs_attention")
      record = updateManagedOperation(this.db, record.id, {
        status: "queued",
        stateJson: record.stateJson
      });
    if (created.created || created.record.status === "needs_attention")
      this.enqueue(request.requestId);
    return this.receipt(record);
  }

  submitEmptyTrash(input: {
    requestId: string;
    expectedRevision: string;
    expectedCount: number;
  }): FileOperationReceipt {
    if (this.closing) throw new FileManagementError("server_closing");
    const request = FileOperationBody.parse({ ...input, type: "empty-trash" });
    const previous = getManagedOperation(this.db, request.requestId);
    if (!previous) {
      const pending = listPendingManagedOperations(this.db);
      if (pending.some((entry) => entry.status === "needs_attention"))
        throw new FileManagementError("recovery_required");
      if (pending.length >= 32)
        throw new FileManagementError("operation_queue_full");
    }
    const created = createEmptyTrashOperation(this.db, {
      id: request.requestId,
      requestJson: JSON.stringify(request),
      expectedRevision: request.expectedRevision!,
      expectedCount: request.expectedCount!
    });
    let record = created.record;
    if (record.status === "needs_attention")
      record = updateManagedOperation(this.db, record.id, {
        status: "queued",
        stateJson: record.stateJson
      });
    if (created.created || created.record.status === "needs_attention")
      this.enqueue(record.id);
    return this.receipt(record);
  }

  /** Called only after the upload service has verified the complete private file. */
  publishUpload(input: {
    requestId: string;
    uploadId: string;
    destinationFolderId: string;
    expectedParentVersion: string;
    name: string;
    conflict: "skip" | "keep-both";
  }): FileOperationReceipt {
    return this.submit(
      FileOperationBody.parse({ ...input, type: "add-media", items: [] })
    );
  }

  get(id: string): FileOperationReceipt | null {
    const record = getManagedOperation(this.db, id);
    return record ? this.receipt(record) : null;
  }
  list(): FileOperationReceipt[] {
    return listManagedOperations(this.db, 100).map((record) =>
      this.receipt(record)
    );
  }
  retry(id: string): FileOperationReceipt | null {
    const record = getManagedOperation(this.db, id);
    if (!record) return null;
    return record.status === "needs_attention"
      ? this.submit(FileOperationBody.parse(JSON.parse(record.requestJson)))
      : this.receipt(record);
  }
  cancel(id: string): FileOperationReceipt | null {
    if (this.closing) throw new FileManagementError("server_closing");
    const record = getManagedOperation(this.db, id);
    if (!record) return null;
    if (
      record.status === "queued" ||
      record.status === "running" ||
      record.status === "needs_attention"
    ) {
      const state = this.journal(record);
      state.cancelRequested = true;
      const update =
        (JSON.parse(record.requestJson) as { type?: unknown }).type ===
        "empty-trash"
          ? cancelEmptyTrashOperation
          : updateManagedOperation;
      update(this.db, id, {
        status: record.status === "needs_attention" ? "queued" : record.status,
        stateJson: JSON.stringify(state)
      });
      if (record.status === "needs_attention") this.enqueue(id);
    }
    return this.get(id);
  }
  async close(): Promise<void> {
    this.closing = true;
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
    await this.maintenance;
    await this.worker;
    await this.capabilityRefresh;
  }

  private enqueue(id: string): void {
    this.worker = this.worker
      .then(() => withLibraryMutationLock(this.db, () => this.execute(id)))
      .catch(() => {
        const record = getManagedOperation(this.db, id);
        if (record)
          updateManagedOperation(this.db, id, {
            status: "needs_attention",
            stateJson: record.stateJson
          });
      });
  }

  private async execute(id: string): Promise<void> {
    const record = getManagedOperation(this.db, id);
    if (!record) return;
    const request = FileOperationBody.parse(JSON.parse(record.requestJson));
    if (request.type === "empty-trash") return this.executeEmptyTrash(record);
    const journal = this.journal(record);
    const persist = (status: FileOperationStatus = "running") => {
      const current = getManagedOperation(this.db, id);
      if (current && this.journal(current).cancelRequested)
        journal.cancelRequested = true;
      return updateManagedOperation(this.db, id, {
        status,
        stateJson: JSON.stringify(journal)
      });
    };
    this.active = true;
    try {
      persist();
      for (let index = 0; index < journal.items.length; index++) {
        const item = journal.items[index]!;
        if (
          item.status === "completed" ||
          item.status === "failed" ||
          item.status === "cancelled"
        )
          continue;
        const current = getManagedOperation(this.db, id)!;
        if (this.journal(current).cancelRequested)
          journal.cancelRequested = true;
        if (journal.cancelRequested && !item.phase) {
          item.status = "cancelled";
          persist();
          continue;
        }
        item.status = "running";
        this.progress.delete(id);
        persist();
        try {
          await this.cancelUnpublished(request, item);
          if (request.type === "create-folder")
            await this.createFolder(request, item, persist);
          else if (request.type === "add-media")
            await this.addMedia(request, item, persist);
          else if (request.type === "purge") await this.purge(item, persist);
          else await this.relocate(request, item, index, persist);
          item.status = "completed";
          item.errorCode = undefined;
        } catch (error) {
          item.errorCode = errorCode(error);
          // Any uncertain filesystem boundary retains its reservations for review.
          item.status =
            item.errorCode === "operation_cancelled"
              ? "cancelled"
              : item.phase
                ? "needs_attention"
                : "failed";
        }
        persist();
        if (item.status === "needs_attention") break;
      }
      const states = journal.items.map((item) => item.status);
      persist(
        states.includes("needs_attention")
          ? "needs_attention"
          : states.every((status) => status === "completed")
            ? "completed"
            : states.includes("completed")
              ? "partial"
              : states.every((status) => status === "cancelled")
                ? "cancelled"
                : "failed"
      );
    } finally {
      this.progress.delete(id);
      this.active = false;
    }
  }

  private async executeEmptyTrash(
    record: ManagedOperationRecord
  ): Promise<void> {
    const request = FileOperationBody.parse(JSON.parse(record.requestJson));
    const journal = this.journal(record);
    const persistOperation = (status: FileOperationStatus = "running") => {
      const current = getManagedOperation(this.db, record.id);
      if (current && this.journal(current).cancelRequested)
        journal.cancelRequested = true;
      return updateManagedOperation(this.db, record.id, {
        status,
        stateJson: JSON.stringify(journal)
      });
    };
    this.active = true;
    try {
      persistOperation();
      let attention = false;
      let afterIndex = -1;
      while (!attention) {
        const batch = listManagedOperationItems(
          this.db,
          record.id,
          true,
          100,
          afterIndex
        );
        if (!batch.length) break;
        for (const stored of batch) {
          const item = this.managedItem(stored);
          const persist = () => {
            const current = getManagedOperation(this.db, record.id);
            if (current && this.journal(current).cancelRequested)
              journal.cancelRequested = true;
            return updateManagedOperationItem(
              this.db,
              record.id,
              stored.id,
              {
                status: item.status,
                phase: item.phase,
                journalJson: JSON.stringify(item),
                errorCode: item.errorCode
              },
              { status: "running", stateJson: JSON.stringify(journal) }
            );
          };
          persistOperation();
          if (journal.cancelRequested && !item.phase) {
            item.status = "cancelled";
            persist();
            afterIndex = stored.itemIndex;
            continue;
          }
          item.status = "running";
          persist();
          afterIndex = stored.itemIndex;
          try {
            await this.cancelUnpublished(request, item);
            await this.purge(item, persist);
            item.status = "completed";
            item.errorCode = undefined;
          } catch (error) {
            item.errorCode = errorCode(error);
            item.status =
              item.errorCode === "operation_cancelled"
                ? "cancelled"
                : item.phase
                  ? "needs_attention"
                  : "failed";
          }
          persist();
          if (item.status === "needs_attention") {
            attention = true;
            break;
          }
        }
      }
      const summary = managedOperationItemSummary(this.db, record.id);
      persistOperation(
        summary.needsAttention
          ? "needs_attention"
          : summary.completed === summary.total
            ? "completed"
            : summary.completed
              ? "partial"
              : summary.cancelled === summary.total
                ? "cancelled"
                : "failed"
      );
    } finally {
      this.active = false;
    }
  }

  private managedItem(record: ManagedOperationItemRecord): ItemJournal {
    const item = JSON.parse(record.journalJson) as ItemJournal & {
      sourceRevision?: number;
    };
    if (!item.input.expectedVersion && item.sourceRevision !== undefined)
      item.input.expectedVersion = sourceVersion(
        record.assetId,
        item.sourceRevision
      );
    return item;
  }

  private async addMedia(
    request: FileOperationRequest,
    item: ItemJournal,
    persist: () => unknown
  ): Promise<void> {
    const uploadRootPath = await realpath(this.config.dataDir);
    const source: FileOperationLocation = {
      rootPath: uploadRootPath,
      relativePath: `uploads/${request.uploadId!}`,
      expectedRoot: item.uploadRootIdentity
    };
    if (!item.phase) {
      const parent = this.destinationFolder(
        request.destinationFolderId!,
        request.expectedParentVersion
      );
      const name = validateManagedName(request.name!);
      if (!detectMediaType(path.posix.extname(name)))
        throw new FileManagementError("unsupported_media");
      item.uploadRootIdentity =
        await this.filesystem.inspectRoot(uploadRootPath);
      source.expectedRoot = item.uploadRootIdentity;
      item.expected = await this.filesystem.inspect(source);
      if (item.expected.kind !== "file")
        throw new FileManagementError("unsupported_media");
      item.manifest = await this.filesystem.inventory(source);
      if (!sameExactEntry(item.expected, item.manifest.entries[0]!.identity))
        throw new FileManagementError("source_changed");
      item.destinationFolderId = parent.id;
      item.destinationParent = await this.verifyDestinationParent(parent.id);
      item.destination = await this.chooseDestination(
        {
          rootId: parent.rootId,
          relativePath: path.posix.join(parent.relativePath, name)
        },
        request.conflict,
        false
      );
      item.sourceAssetId = `asset_${randomUUID()}`;
      await this.ensureOperationDirectory(
        parent.rootId,
        ".aether-staging",
        request.requestId
      );
      item.stage = {
        rootId: parent.rootId,
        relativePath: `.aether-staging/${request.requestId}/0`
      };
      if (await this.optionalInspect(this.location(item.stage)))
        throw new FileManagementError("unknown_reserved_storage");
      item.phase = "prepared";
      persist();
    }
    if (item.phase === "prepared") {
      if (
        !sameExactManifest(
          item.manifest!,
          await this.filesystem.inventory(source)
        )
      )
        throw new FileManagementError("source_changed");
      const staged = await this.optionalInspect(this.location(item.stage!));
      if (staged) {
        if (!item.stageIdentity || !sameObject(staged, item.stageIdentity))
          throw new FileManagementError("unknown_reserved_storage");
        const manifest = await this.filesystem.inventory(
          this.location(item.stage!)
        );
        if (sameManifestContents(item.manifest!, manifest)) {
          item.published = staged;
          item.publishedManifest = manifest;
        } else await this.discardVerifiedStage(item, manifest);
      }
      if (!item.publishedManifest) {
        await this.ensureCopySpace(
          item.destination!.rootId,
          item.manifest!.totalBytes,
          request.uploadId
        );
        const copied = await this.filesystem.copy(
          source,
          this.location(item.stage!),
          item.expected!,
          DEFAULT_FILE_OPERATION_LIMITS,
          async (identity) => {
            item.stageIdentity = identity;
            persist();
          },
          (bytes, totalBytes) =>
            this.progress.set(request.requestId, { bytes, totalBytes })
        );
        item.published = copied.identity;
        item.publishedManifest = copied.manifest;
      }
      item.phase = "copied";
      persist();
    }
    if (item.phase === "copied") {
      await this.cancelUnpublished(request, item);
      await this.verifyDestinationParent(
        item.destinationFolderId!,
        item.destinationParent
      );
      const existing = await this.optionalInspect(
        this.location(item.destination!)
      );
      if (existing && !sameEntry(existing, item.published!))
        throw new FileManagementError("destination_exists");
      item.published =
        existing ??
        (await this.filesystem.rename(
          this.location(item.stage!),
          this.location(item.destination!),
          item.published!
        ));
      item.publishedManifest = await this.filesystem.inventory(
        this.location(item.destination!)
      );
      if (!sameManifestContents(item.manifest!, item.publishedManifest))
        throw new FileManagementError("source_changed");
      item.phase = "published";
      persist();
    }
    if (item.phase === "published") {
      await this.verifyPublishedManifest(item);
      await this.verifyDestinationParent(
        item.destinationFolderId!,
        item.destinationParent
      );
      const destination = item.destination!;
      const name = path.posix.basename(destination.relativePath);
      const media = detectMediaType(path.posix.extname(name));
      const identity = item.published!;
      const sha256 = item.publishedManifest!.entries[0]!.sha256;
      if (!media || !sha256 || !item.sourceAssetId)
        throw new FileManagementError("unsupported_media");
      item.asset = commitUploadedAsset(this.db, {
        id: item.sourceAssetId,
        rootId: destination.rootId,
        folderId: item.destinationFolderId!,
        relativePath: destination.relativePath,
        name,
        extension: path.posix.extname(name).toLowerCase(),
        ...media,
        ...fileIdentity(identity),
        fingerprint: `${identity.size}:${identity.mtimeNs}:${identity.ctimeNs}`,
        contentSha256: sha256,
        seenAt: new Date().toISOString()
      });
      item.phase = "committed";
      persist();
    }
  }

  private async createFolder(
    request: FileOperationRequest,
    item: ItemJournal,
    persist: () => unknown
  ): Promise<void> {
    const parent = this.destinationFolder(
      request.destinationFolderId!,
      item.phase ? undefined : request.expectedParentVersion
    );
    const name = validateManagedName(request.name!);
    const relativePath = path.posix.join(parent.relativePath, name);
    if (!item.phase) {
      item.destination = { rootId: parent.rootId, relativePath };
      item.destinationFolderId = parent.id;
      item.destinationParent = await this.verifyDestinationParent(parent.id);
      if (
        createManagedDestinationProbe(this.db)(parent.rootId, relativePath) ||
        (await this.optionalInspect(this.location(item.destination)))
      )
        throw new FileManagementError("destination_exists");
      await this.ensureOperationDirectory(
        parent.rootId,
        ".aether-staging",
        request.requestId
      );
      item.stage = {
        rootId: parent.rootId,
        relativePath: `.aether-staging/${request.requestId}/folder`
      };
      if (await this.optionalInspect(this.location(item.stage)))
        throw new FileManagementError("unknown_reserved_storage");
      item.phase = "prepared";
      persist();
    }
    if (item.phase === "prepared") {
      if (!item.stage || !item.destination)
        throw new FileManagementError("needs_review");
      if (await this.optionalInspect(this.location(item.destination)))
        throw new FileManagementError("destination_exists");
      const staged = await this.optionalInspect(this.location(item.stage));
      if (staged) {
        const manifest = await this.filesystem.inventory(
          this.location(item.stage)
        );
        if (
          staged.kind !== "directory" ||
          staged.mode !== 0o700 ||
          manifest.entries.length !== 1
        )
          throw new FileManagementError("unknown_reserved_storage");
        item.published = staged;
      } else
        item.published = await this.filesystem.createDirectory(
          this.location(item.stage)
        );
      item.stageIdentity = item.published;
      item.phase = "copied";
      persist();
    }
    if (item.phase === "copied") {
      await this.cancelUnpublished(request, item);
      await this.verifyDestinationParent(
        item.destinationFolderId!,
        item.destinationParent
      );
      const existing = await this.optionalInspect(
        this.location(item.destination!)
      );
      if (existing && !sameEntry(existing, item.published!))
        throw new FileManagementError("destination_exists");
      item.published =
        existing ??
        (await this.filesystem.rename(
          this.location(item.stage!),
          this.location(item.destination!),
          item.published!
        ));
      item.phase = "published";
      persist();
    }
    if (!item.published || !item.destination)
      throw new FileManagementError("needs_review");
    const actual = await this.filesystem.inspect(
      this.location(item.destination)
    );
    if (
      !sameEntry(actual, item.published) ||
      (await this.filesystem.inventory(this.location(item.destination))).entries
        .length !== 1
    )
      throw new FileManagementError("source_changed");
    await this.verifyDestinationParent(
      item.destinationFolderId!,
      item.destinationParent
    );
    const folderId = `folder_${request.requestId}`;
    const existing = getManagedFolder(this.db, folderId);
    item.folder =
      existing ??
      createManagedFolder(this.db, {
        id: folderId,
        rootId: parent.rootId,
        parentId: parent.id,
        relativePath,
        name,
        identity: directoryIdentity(actual)
      });
    item.phase = "committed";
    persist();
  }

  private async relocate(
    request: FileOperationRequest,
    item: ItemJournal,
    index: number,
    persist: () => unknown
  ): Promise<void> {
    const folder = Boolean(item.input.folderId);
    if (!item.phase) {
      const source = item.input.assetId
        ? getManagedAsset(this.db, item.input.assetId)
        : folder
          ? getManagedFolder(this.db, item.input.folderId!)
          : getTrashRecord(this.db, item.input.trashId!);
      if (!source || source.sourceVersion !== item.input.expectedVersion)
        throw new FileManagementError("source_changed");
      if ("lifecycle" in source && source.lifecycle !== "active")
        throw new FileManagementError("source_not_found");
      if (folder && "relativePath" in source && !source.relativePath)
        throw new FileManagementError("protected_root");
      const trash = item.input.trashId
        ? getTrashRecord(this.db, item.input.trashId)
        : null;
      const sourceRootId = trash
        ? trash.identity.rootId
        : (source as ManagedAsset).rootId;
      item.sourceAssetId = trash?.assetId ?? item.input.assetId;
      item.source = {
        rootId: sourceRootId,
        relativePath: trash
          ? trash.physicalRelativePath
          : (source as ManagedAsset).relativePath
      };
      const expected = await this.filesystem.inspect(
        this.location(item.source)
      );
      if (item.input.assetId)
        verifyIndexedIdentity(source as ManagedAsset, expected);
      if (trash) verifyIndexedIdentity(trash.identity, expected);
      if (folder) {
        const stored = getManagedFolder(this.db, item.input.folderId!)!;
        if (
          !stored.fsDeviceId ||
          !stored.fsInode ||
          expected.dev !== stored.fsDeviceId ||
          expected.ino !== stored.fsInode
        )
          throw new FileManagementError("source_changed");
      }
      item.expected = expected;
      item.manifest = await this.filesystem.inventory(
        this.location(item.source)
      );
      if (
        folder &&
        request.expectedInventoryVersion &&
        request.expectedInventoryVersion !== inventoryVersion(item.manifest)
      )
        throw new FileManagementError("folder_changed");
      if (!sameExactEntry(item.manifest.entries[0]!.identity, expected))
        throw new FileManagementError("source_changed");
      if (
        (item.input.assetId || trash) &&
        (trash?.identity ?? (source as ManagedAsset)).contentSha256 &&
        item.manifest.entries[0]?.sha256 !==
          (trash?.identity ?? (source as ManagedAsset)).contentSha256
      )
        throw new FileManagementError("source_changed");
      let destination: Location;
      if (request.type === "trash") {
        await this.ensureOperationDirectory(
          sourceRootId,
          ".aether-trash",
          request.requestId
        );
        destination = {
          rootId: sourceRootId,
          relativePath: `.aether-trash/${request.requestId}/${index}`
        };
        item.trashId = `${request.requestId}-${index}`;
        await captureTrashThumbnail(
          this.config,
          this.db,
          item.input.assetId!,
          item.trashId
        ).catch(() => undefined);
      } else {
        let destinationFolderId = request.destinationFolderId;
        if (request.type.startsWith("rename"))
          destinationFolderId = folder
            ? (getManagedFolder(this.db, item.input.folderId!)!.parentId ??
              undefined)
            : ((source as ManagedAsset).folderId ?? undefined);
        if (trash && !destinationFolderId)
          destinationFolderId = trash.originalFolderId ?? undefined;
        if (!destinationFolderId)
          throw new FileManagementError("choose_destination");
        const parent = this.destinationFolder(
          destinationFolderId,
          request.expectedParentVersion
        );
        item.destinationFolderId = parent.id;
        item.destinationParent = await this.verifyDestinationParent(parent.id);
        const originalName = trash
          ? trash.originalName
          : (source as ManagedAsset).name;
        const name =
          request.type === "rename-media"
            ? `${validateManagedName(request.name!)}${path.posix.extname(originalName)}`
            : request.type === "rename-folder"
              ? validateManagedName(request.name!)
              : originalName;
        validateManagedName(name);
        destination = {
          rootId: parent.rootId,
          relativePath: path.posix.join(parent.relativePath, name)
        };
        if (
          folder &&
          destination.rootId === sourceRootId &&
          (destination.relativePath === item.source.relativePath ||
            destination.relativePath.startsWith(`${item.source.relativePath}/`))
        ) {
          if (destination.relativePath === item.source.relativePath) {
            item.folder = getManagedFolder(this.db, item.input.folderId!)!;
            return;
          }
          throw new FileManagementError("invalid_destination");
        }
        if (
          destination.rootId === sourceRootId &&
          destination.relativePath === item.source.relativePath
        ) {
          if (item.input.assetId)
            item.asset = getAsset(this.db, item.input.assetId)!;
          return;
        }
        destination = await this.chooseDestination(
          destination,
          item.input.conflict ?? request.conflict,
          folder,
          request.type === "rename-media" || request.type === "rename-folder"
            ? { location: item.source, identity: expected }
            : undefined
        );
      }
      item.destination = destination;
      item.phase = "prepared";
      persist();
    }
    const source = item.source!;
    const destination = item.destination!;
    const expected = item.expected!;
    if (item.phase === "prepared") {
      if (item.destinationFolderId)
        await this.verifyDestinationParent(
          item.destinationFolderId,
          item.destinationParent
        );
      const alreadyPublished = await this.optionalInspect(
        this.location(destination)
      );
      const matchesPublished =
        !item.crossDevice &&
        alreadyPublished &&
        sameEntry(alreadyPublished, expected);
      // A case-insensitive volume may resolve both spellings before a rename.
      // The exact directory entry distinguishes that alias from a publication
      // whose acknowledgement was lost. Never infer this from letter casing.
      const renameAlias =
        matchesPublished &&
        (request.type === "rename-media" || request.type === "rename-folder") &&
        siblingLocations(source, destination);
      const sourceStillNamed =
        renameAlias &&
        (await this.filesystem.hasExactEntryName(this.location(source)));
      if (renameAlias) {
        const destinationNamed = await this.filesystem.hasExactEntryName(
          this.location(destination)
        );
        if (sourceStillNamed === destinationNamed)
          throw new FileManagementError(
            sourceStillNamed ? "destination_exists" : "source_changed"
          );
      }
      if (matchesPublished && !sourceStillNamed) {
        const actual = await this.filesystem.inventory(
          this.location(destination)
        );
        if (!sameMovedManifest(item.manifest!, actual))
          throw new FileManagementError("source_changed");
        item.published = alreadyPublished;
        item.publishedManifest = actual;
      } else {
        if (alreadyPublished && !sourceStillNamed)
          throw new FileManagementError("destination_exists");
        const current = await this.filesystem.inventory(this.location(source));
        if (!sameExactManifest(item.manifest!, current))
          throw new FileManagementError("source_changed");
        if (!item.crossDevice)
          try {
            item.published = await this.filesystem.rename(
              this.location(source),
              this.location(destination),
              expected
            );
          } catch (error) {
            if (
              !(error instanceof FileOperationFilesystemError) ||
              error.code !== "cross_device"
            )
              throw error;
            item.crossDevice = true;
            await this.ensureOperationDirectory(
              destination.rootId,
              ".aether-staging",
              request.requestId
            );
            item.stage = {
              rootId: destination.rootId,
              relativePath: `.aether-staging/${request.requestId}/${index}`
            };
            persist();
          }
        if (item.crossDevice) {
          if (!item.stage) throw new FileManagementError("needs_review");
          const staged = await this.optionalInspect(this.location(item.stage));
          if (staged) {
            if (!item.stageIdentity || !sameObject(staged, item.stageIdentity))
              throw new FileManagementError("unknown_reserved_storage");
            const stagedManifest = await this.filesystem.inventory(
              this.location(item.stage)
            );
            if (sameManifestContents(item.manifest!, stagedManifest)) {
              item.published = staged;
              item.publishedManifest = stagedManifest;
            } else {
              // A partial private stage can be removed only while the complete
              // original source is still the verified journaled copy.
              if (
                !sameExactManifest(
                  item.manifest!,
                  await this.filesystem.inventory(this.location(source))
                )
              )
                throw new FileManagementError("source_changed");
              await this.discardVerifiedStage(item, stagedManifest);
            }
          }
          if (!item.publishedManifest) {
            await this.ensureCopySpace(
              destination.rootId,
              item.manifest!.totalBytes
            );
            const copied = await this.filesystem.copy(
              this.location(source),
              this.location(item.stage),
              expected,
              DEFAULT_FILE_OPERATION_LIMITS,
              async (identity) => {
                item.stageIdentity = identity;
                persist();
              },
              (bytes, totalBytes) =>
                this.progress.set(request.requestId, { bytes, totalBytes })
            );
            item.published = copied.identity;
            item.publishedManifest = copied.manifest;
          }
          item.phase = "copied";
          persist();
        }
      }
      if (!item.crossDevice) {
        item.publishedManifest ??= await this.filesystem.inventory(
          this.location(destination)
        );
        if (!sameMovedManifest(item.manifest!, item.publishedManifest))
          throw new FileManagementError("source_changed");
        item.phase = "published";
        persist();
      }
    }
    if (item.phase === "copied") {
      await this.cancelUnpublished(request, item);
      if (item.destinationFolderId)
        await this.verifyDestinationParent(
          item.destinationFolderId,
          item.destinationParent
        );
      const existing = await this.optionalInspect(this.location(destination));
      if (existing && !sameEntry(existing, item.published!))
        throw new FileManagementError("destination_exists");
      item.published =
        existing && sameEntry(existing, item.published!)
          ? existing
          : await this.filesystem.rename(
              this.location(item.stage!),
              this.location(destination),
              item.published!
            );
      item.phase = "published";
      item.publishedManifest = await this.filesystem.inventory(
        this.location(destination)
      );
      if (!sameManifestContents(item.manifest!, item.publishedManifest))
        throw new FileManagementError("source_changed");
      persist();
    }
    if (item.phase === "published") {
      const actual = await this.filesystem.inspect(this.location(destination));
      if (!sameEntry(actual, item.published!))
        throw new FileManagementError("source_changed");
      const publishedManifest = await this.filesystem.inventory(
        this.location(destination)
      );
      if (
        !item.publishedManifest ||
        !sameExactManifest(item.publishedManifest, publishedManifest)
      )
        throw new FileManagementError("source_changed");
      if (item.destinationFolderId)
        await this.verifyDestinationParent(
          item.destinationFolderId,
          item.destinationParent
        );
      const destinationFolder =
        request.type === "trash"
          ? null
          : this.findDestinationFolder(request, item);
      if (request.type === "trash") {
        const existing = getTrashRecord(this.db, item.trashId!);
        if (!existing)
          markTrashed(this.db, {
            assetId: item.input.assetId!,
            expectedVersion: item.input.expectedVersion,
            trashId: item.trashId!,
            identity: fileIdentity(actual),
            contentSha256: item.publishedManifest.entries[0]!.sha256!,
            physicalRelativePath: destination.relativePath,
            expiresAt: new Date(
              Date.now() +
                (this.config.fileManagement?.trashRetentionDays ?? 30) *
                  86400_000
            ).toISOString()
          });
      } else if (folder) {
        const current = getManagedFolder(this.db, item.input.folderId!);
        if (
          current?.relativePath !== destination.relativePath ||
          current.rootId !== destination.rootId
        ) {
          const manifest = await this.filesystem.inventory(
            this.location(destination)
          );
          const identities = Object.fromEntries(
            manifest.entries
              .filter((entry) => entry.identity.kind === "file")
              .map((entry) => [
                entry.relativePath,
                fileIdentity(entry.identity)
              ])
          );
          const folderIdentities = Object.fromEntries(
            manifest.entries
              .filter(
                (entry) =>
                  entry.identity.kind === "directory" && entry.relativePath
              )
              .map((entry) => [
                entry.relativePath,
                directoryIdentity(entry.identity)
              ])
          );
          item.folder = commitFolderLocation(this.db, {
            folderId: item.input.folderId!,
            expectedVersion: item.input.expectedVersion,
            rootId: destination.rootId,
            parentId: destinationFolder!.id,
            relativePath: destination.relativePath,
            name: path.posix.basename(destination.relativePath),
            identity: directoryIdentity(actual),
            identities,
            folderIdentities
          });
        } else item.folder = current;
      } else if (item.input.trashId) {
        const record = getTrashRecord(this.db, item.input.trashId);
        item.asset = record
          ? restoreTrashedAsset(this.db, {
              trashId: record.id,
              expectedVersion: item.input.expectedVersion,
              rootId: destination.rootId,
              folderId: destinationFolder!.id,
              relativePath: destination.relativePath,
              name: path.posix.basename(destination.relativePath),
              identity: fileIdentity(actual)
            })
          : (getAsset(this.db, item.sourceAssetId ?? "") ?? undefined);
        const restored = item.asset
          ? getManagedAsset(this.db, item.asset.id)
          : null;
        if (
          !restored ||
          restored.rootId !== destination.rootId ||
          restored.relativePath !== destination.relativePath
        )
          throw new FileManagementError("source_changed");
      } else {
        const current = getManagedAsset(this.db, item.input.assetId!);
        item.asset =
          current?.rootId === destination.rootId &&
          current.relativePath === destination.relativePath
            ? getAsset(this.db, current.id)!
            : commitAssetLocation(this.db, {
                assetId: item.input.assetId!,
                expectedVersion: item.input.expectedVersion,
                rootId: destination.rootId,
                folderId: destinationFolder!.id,
                relativePath: destination.relativePath,
                name: path.posix.basename(destination.relativePath),
                identity: fileIdentity(actual)
              });
      }
      item.phase = "committed";
      persist();
    }
    if (
      request.type === "restore" &&
      (item.phase === "committed" || item.phase === "retired")
    )
      await removeTrashThumbnail(this.config, item.input.trashId!).catch(
        () => undefined
      );
    if (item.phase === "committed" && item.crossDevice) {
      await this.verifyPublishedManifest(item);
      await this.ensureOperationDirectory(
        source.rootId,
        ".aether-staging",
        request.requestId
      );
      item.quarantine = {
        rootId: source.rootId,
        relativePath: `.aether-staging/${request.requestId}/retired-${index}`
      };
      persist();
      const existing = await this.optionalInspect(
        this.location(item.quarantine)
      );
      if (!existing) {
        const current = await this.filesystem.inventory(this.location(source));
        if (!sameExactManifest(item.manifest!, current))
          throw new FileManagementError("source_changed");
        await this.filesystem.retire(
          this.location(source),
          this.location(item.quarantine),
          expected
        );
      } else if (!sameEntry(existing, expected))
        throw new FileManagementError("source_changed");
      const retired = await this.filesystem.inventory(
        this.location(item.quarantine)
      );
      if (!sameMovedManifest(item.manifest!, retired))
        throw new FileManagementError("source_changed");
      item.retiredManifest = retired;
      item.phase = "retired";
      persist();
    }
    if (item.phase === "retired") {
      await this.verifyPublishedManifest(item);
      if (!item.retiredManifest) throw new FileManagementError("needs_review");
      await this.filesystem.purgeOwned(
        this.location(item.quarantine!),
        item.retiredManifest
      );
    }
  }

  private async purge(
    item: ItemJournal,
    persist: () => unknown
  ): Promise<void> {
    const record = getTrashRecord(this.db, item.input.trashId!);
    if (!record) {
      if (
        item.phase === "committed" ||
        (item.phase === "published" &&
          item.sourceAssetId &&
          !getManagedAsset(this.db, item.sourceAssetId))
      ) {
        item.phase = "committed";
        persist();
        await removeTrashThumbnail(this.config, item.input.trashId!).catch(
          () => undefined
        );
        return;
      }
      throw new FileManagementError("source_not_found");
    }
    if (record.sourceVersion !== item.input.expectedVersion)
      throw new FileManagementError("source_changed");
    const location = {
      rootId: record.identity.rootId,
      relativePath: record.physicalRelativePath
    };
    if (!item.phase) {
      item.source = location;
      item.sourceAssetId = record.assetId;
      item.manifest = await this.filesystem.inventory(this.location(location));
      const entry = item.manifest.entries[0];
      if (
        !entry ||
        entry.identity.kind !== "file" ||
        item.manifest.entries.length !== 1
      )
        throw new FileManagementError("source_changed");
      verifyIndexedIdentity(record.identity, entry.identity);
      if (
        record.identity.contentSha256 &&
        entry.sha256 !== record.identity.contentSha256
      )
        throw new FileManagementError("source_changed");
      item.phase = "prepared";
      persist();
    }
    if (item.phase === "prepared") {
      const actual = await this.optionalInspect(this.location(location));
      if (
        !actual ||
        !sameExactManifest(
          item.manifest!,
          await this.filesystem.inventory(this.location(location))
        )
      )
        throw new FileManagementError("source_changed");
      item.phase = "purging";
      persist();
    }
    if (item.phase === "purging") {
      await this.filesystem.purgeOwned(this.location(location), item.manifest!);
      item.phase = "published";
      persist();
    }
    purgeTrashedAsset(this.db, record.id, item.input.expectedVersion);
    item.phase = "committed";
    persist();
    await removeTrashThumbnail(this.config, item.input.trashId!).catch(
      () => undefined
    );
  }

  private destinationFolder(id: string, expectedVersion?: string) {
    const folder = getManagedFolder(this.db, id);
    if (
      !folder ||
      (expectedVersion && folder.sourceVersion !== expectedVersion)
    )
      throw new FileManagementError("destination_changed");
    this.requireRoot(folder.rootId);
    if (folder.relativePath.split("/").some((part) => part.startsWith(".")))
      throw new FileManagementError("invalid_destination");
    return folder;
  }
  private async verifyDestinationParent(
    id: string,
    expected?: FileOperationIdentity
  ): Promise<FileOperationIdentity> {
    const folder = this.destinationFolder(id);
    const actual = await this.filesystem.inspect(
      this.location({
        rootId: folder.rootId,
        relativePath: folder.relativePath
      })
    );
    const ownership = getManagedRootOwnership(this.db, folder.rootId)!;
    const device = folder.relativePath ? folder.fsDeviceId : ownership.deviceId;
    const inode = folder.relativePath ? folder.fsInode : ownership.inode;
    if (
      actual.kind !== "directory" ||
      actual.dev !== device ||
      actual.ino !== inode ||
      (expected && (expected.dev !== actual.dev || expected.ino !== actual.ino))
    )
      throw new FileManagementError("destination_changed");
    return actual;
  }

  private async verifyPublishedManifest(item: ItemJournal): Promise<void> {
    if (!item.destination || !item.publishedManifest)
      throw new FileManagementError("needs_review");
    const actual = await this.filesystem.inventory(
      this.location(item.destination)
    );
    if (!sameExactManifest(item.publishedManifest, actual))
      throw new FileManagementError("destination_changed");
  }

  private async ensureCopySpace(
    rootId: string,
    bytes: number,
    excludeUploadId?: string
  ): Promise<void> {
    const root = this.requireRoot(rootId);
    const device = getManagedRootOwnership(this.db, rootId)!.deviceId;
    const space = await statfs(root.realPath, { bigint: true });
    const reserved =
      uploadVolumeReservations(this.db, excludeUploadId).get(device) ?? 0n;
    const minimum = BigInt(
      this.config.fileManagement?.minFreeBytes ?? 2 * 1024 ** 3
    );
    if (space.bavail * space.bsize < BigInt(bytes) + minimum + reserved)
      throw new FileManagementError("insufficient_space");
  }

  private async discardVerifiedStage(
    item: ItemJournal,
    manifest: FileOperationManifest
  ): Promise<void> {
    const first = manifest.entries[0];
    if (
      !item.stage ||
      !item.stageIdentity ||
      !first ||
      !sameObject(first.identity, item.stageIdentity)
    )
      throw new FileManagementError("unknown_reserved_storage");
    const allowed = new Map(
      item.manifest?.entries.map((entry) => [entry.relativePath, entry]) ?? []
    );
    if (
      item.manifest &&
      manifest.entries.some((entry) => {
        const expected = allowed.get(entry.relativePath);
        return (
          !expected ||
          entry.identity.kind !== expected.identity.kind ||
          (entry.identity.kind === "file" &&
            BigInt(entry.identity.size) > BigInt(expected.identity.size))
        );
      })
    )
      throw new FileManagementError("source_changed");
    if (
      !item.manifest &&
      (first.identity.kind !== "directory" || manifest.entries.length !== 1)
    )
      throw new FileManagementError("source_changed");
    await this.filesystem.purgeOwned(this.location(item.stage), manifest);
  }

  private async cancelUnpublished(
    request: FileOperationRequest,
    item: ItemJournal
  ): Promise<void> {
    if (!item.phase || !["prepared", "copied"].includes(item.phase)) return;
    const operation = getManagedOperation(this.db, request.requestId);
    if (!operation || !this.journal(operation).cancelRequested) return;
    const destination = item.destination
      ? await this.optionalInspect(this.location(item.destination))
      : null;
    if (
      destination &&
      (item.published ?? item.expected) &&
      sameObject(destination, (item.published ?? item.expected)!)
    ) {
      if (
        (request.type === "rename-media" || request.type === "rename-folder") &&
        item.source &&
        item.destination &&
        siblingLocations(item.source, item.destination)
      ) {
        const sourceNamed = await this.filesystem.hasExactEntryName(
          this.location(item.source)
        );
        const destinationNamed = await this.filesystem.hasExactEntryName(
          this.location(item.destination)
        );
        if (!sourceNamed && destinationNamed) return;
        if (!sourceNamed || destinationNamed)
          throw new FileManagementError("source_changed");
      } else return; // Publication may have committed; recover it rather than discard it.
    }
    if (request.type !== "create-folder") {
      const source =
        request.type === "add-media"
          ? {
              rootPath: await realpath(this.config.dataDir),
              relativePath: `uploads/${request.uploadId!}`,
              expectedRoot: item.uploadRootIdentity
            }
          : item.source
            ? this.location(item.source)
            : null;
      if (
        !source ||
        !item.manifest ||
        !sameExactManifest(
          item.manifest,
          await this.filesystem.inventory(source)
        )
      )
        throw new FileManagementError("source_changed");
    }
    if (item.stage) {
      const staged = await this.optionalInspect(this.location(item.stage));
      if (staged)
        await this.discardVerifiedStage(
          item,
          await this.filesystem.inventory(this.location(item.stage))
        );
    }
    throw new FileManagementError("operation_cancelled");
  }
  private findDestinationFolder(
    request: FileOperationRequest,
    item: ItemJournal
  ) {
    const source = item.input.folderId
      ? getManagedFolder(this.db, item.input.folderId)
      : item.input.assetId
        ? getManagedAsset(this.db, item.input.assetId)
        : null;
    const original = item.input.trashId
      ? getTrashRecord(this.db, item.input.trashId)
      : null;
    const id =
      item.destinationFolderId ??
      request.destinationFolderId ??
      (request.type.startsWith("rename")
        ? source && "parentId" in source
          ? source.parentId
          : source?.folderId
        : original?.originalFolderId);
    if (!id) throw new FileManagementError("choose_destination");
    const folder = this.destinationFolder(id);
    if (
      item.destination &&
      (folder.rootId !== item.destination.rootId ||
        folder.relativePath !==
          path.posix.dirname(item.destination.relativePath).replace(/^\.$/, ""))
    )
      throw new FileManagementError("destination_changed");
    return folder;
  }
  private requireRoot(id: string): MediaRootConfig {
    const root = this.config.mediaRoots.find((entry) => entry.id === id);
    if (
      !root ||
      !this.writable.has(id) ||
      getWriteReconciliationRequired(this.db)
    )
      throw new FileManagementError("read_only");
    return root;
  }
  private location(location: Location): FileOperationLocation {
    const root = this.requireRoot(location.rootId);
    const ownership = getManagedRootOwnership(this.db, root.id)!;
    return {
      rootPath: root.realPath,
      relativePath: location.relativePath,
      expectedRoot: { dev: ownership.deviceId, ino: ownership.inode }
    };
  }
  private async ensureOperationDirectory(
    rootId: string,
    reserved: ".aether-staging" | ".aether-trash",
    id: string
  ): Promise<void> {
    const location = this.location({
      rootId,
      relativePath: `${reserved}/${id}`
    });
    const existing = await this.optionalInspect(location);
    if (existing) {
      if (existing.kind !== "directory" || existing.mode !== 0o700)
        throw new FileManagementError("unsafe_reserved_storage");
      return;
    }
    await this.filesystem.createDirectory(location);
  }
  private async chooseDestination(
    location: Location,
    conflict: FileOperationRequest["conflict"],
    folder: boolean,
    renameSource?: { location: Location; identity: FileOperationIdentity }
  ): Promise<Location> {
    const indexedExists = createManagedDestinationProbe(this.db);
    const exists = async (candidate: Location) =>
      indexedExists(candidate.rootId, candidate.relativePath) ||
      (await this.filesystem.entryExists(this.location(candidate)));
    if (!(await exists(location))) return location;
    if (
      renameSource &&
      siblingLocations(renameSource.location, location) &&
      !indexedExists(location.rootId, location.relativePath)
    ) {
      const alias = await this.optionalInspect(this.location(location));
      if (alias && sameExactEntry(alias, renameSource.identity))
        return location;
    }
    if (conflict !== "keep-both")
      throw new FileManagementError("destination_exists");
    for (let suffix = 2; suffix <= 1000; suffix++) {
      const candidate = {
        ...location,
        relativePath: path.posix.join(
          path.posix.dirname(location.relativePath),
          managedConflictName(
            path.posix.basename(location.relativePath),
            folder,
            suffix
          )
        )
      };
      if (!(await exists(candidate))) return candidate;
    }
    throw new FileManagementError("destination_exists");
  }
  private async optionalInspect(
    location: FileOperationLocation
  ): Promise<FileOperationIdentity | null> {
    try {
      return await this.filesystem.inspect(location);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      throw error;
    }
  }
  private journal(record: ManagedOperationRecord): OperationJournal {
    return JSON.parse(record.stateJson) as OperationJournal;
  }
  private receipt(record: ManagedOperationRecord): FileOperationReceipt {
    return this.db.transaction(() => this.currentReceipt(record))();
  }
  private currentReceipt(record: ManagedOperationRecord): FileOperationReceipt {
    const request = FileOperationBody.parse(JSON.parse(record.requestJson));
    const journal = this.journal(record);
    if (request.type === "empty-trash") {
      const summary = managedOperationItemSummary(this.db, record.id);
      const items = listManagedOperationItems(this.db, record.id).map(
        (stored) => this.managedItem(stored)
      );
      const names = new Map(
        getTrashNamesByIds(
          this.db,
          items.flatMap((item) =>
            item.input.trashId ? [item.input.trashId] : []
          )
        ).map((item) => [item.id, item.name])
      );
      return {
        id: record.id,
        type: request.type,
        status: record.status as FileOperationStatus,
        items: items.map((item) => {
          return {
            trashId: item.input.trashId,
            name: item.input.trashId
              ? names.get(item.input.trashId)
              : undefined,
            status: item.status,
            errorCode: item.errorCode
          };
        }),
        summary,
        canCancel:
          ["queued", "running", "needs_attention"].includes(record.status) &&
          hasCancellableManagedOperationItems(this.db, record.id),
        revision: getLibraryRevision(this.db),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      };
    }
    const retryable = journal.items.filter(
      (item) =>
        (item.status === "failed" || item.status === "cancelled") &&
        (!item.phase || item.phase === "prepared" || item.phase === "copied")
    );
    const { requestId: _requestId, ...retryRequest } = request;
    const currentAssets = new Map(
      getAssetsByIds(this.db, [
        ...new Set(
          journal.items.flatMap((item) => {
            const id =
              item.input.assetId ?? item.sourceAssetId ?? item.asset?.id;
            return id ? [id] : [];
          })
        )
      ]).map((asset) => [asset.id, asset])
    );
    const currentFolders = new Map(
      getFoldersByIds(
        this.db,
        journal.items.flatMap((item) => {
          const id = item.folder?.id ?? item.input.folderId;
          return id ? [id] : [];
        })
      ).map((folder) => [folder.id, folder])
    );
    const trashNames = new Map(
      getTrashNamesByIds(
        this.db,
        journal.items.flatMap((item) =>
          item.input.trashId ? [item.input.trashId] : []
        )
      ).map((item) => [item.id, item.name])
    );
    return {
      id: record.id,
      type: request.type,
      status: record.status as FileOperationStatus,
      progress: this.progress.get(record.id),
      items: journal.items.map((item) => ({
        ...item.input,
        assetId: item.input.assetId ?? item.sourceAssetId ?? item.asset?.id,
        trashId: item.trashId ?? item.input.trashId,
        status: item.status,
        errorCode: item.errorCode,
        name: item.input.trashId
          ? trashNames.get(item.input.trashId)
          : undefined,
        asset: currentAssets.get(
          item.input.assetId ?? item.sourceAssetId ?? item.asset?.id ?? ""
        ),
        folder: currentFolders.get(item.folder?.id ?? item.input.folderId ?? "")
      })),
      revision: getLibraryRevision(this.db),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      canCancel:
        (record.status === "queued" ||
          record.status === "running" ||
          record.status === "needs_attention") &&
        journal.items.some(
          (item) =>
            item.status !== "completed" &&
            item.status !== "cancelled" &&
            (!item.phase ||
              item.phase === "prepared" ||
              item.phase === "copied")
        ),
      retryInput:
        request.type !== "add-media" &&
        retryable.length &&
        ["failed", "partial", "cancelled"].includes(record.status)
          ? {
              ...retryRequest,
              items:
                request.type === "create-folder"
                  ? []
                  : retryable.map((item) => item.input)
            }
          : undefined
    };
  }
}

function inventoryVersion(manifest: FileOperationManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function siblingLocations(left: Location, right: Location): boolean {
  return (
    left.rootId === right.rootId &&
    path.posix.dirname(left.relativePath) ===
      path.posix.dirname(right.relativePath)
  );
}

function sameEntry(
  left: FileOperationIdentity,
  right: FileOperationIdentity
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.kind === right.kind &&
    left.mode === right.mode &&
    left.metadataSha256 === right.metadataSha256 &&
    left.mtimeNs === right.mtimeNs &&
    (left.kind === "directory" ||
      (left.size === right.size && left.mtimeNs === right.mtimeNs))
  );
}
function sameObject(
  left: FileOperationIdentity,
  right: FileOperationIdentity
): boolean {
  return (
    left.dev === right.dev && left.ino === right.ino && left.kind === right.kind
  );
}
function sameExactEntry(
  left: FileOperationIdentity,
  right: FileOperationIdentity
): boolean {
  return (
    sameEntry(left, right) &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs
  );
}
function sameExactManifest(
  left: FileOperationManifest,
  right: FileOperationManifest
): boolean {
  return (
    left.totalBytes === right.totalBytes &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries[index];
      return (
        other &&
        entry.relativePath === other.relativePath &&
        entry.sha256 === other.sha256 &&
        sameExactEntry(entry.identity, other.identity)
      );
    })
  );
}
function sameMovedManifest(
  left: FileOperationManifest,
  right: FileOperationManifest
): boolean {
  return (
    left.totalBytes === right.totalBytes &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries[index];
      return (
        other &&
        entry.relativePath === other.relativePath &&
        entry.sha256 === other.sha256 &&
        (entry.relativePath
          ? sameExactEntry(entry.identity, other.identity)
          : sameEntry(entry.identity, other.identity))
      );
    })
  );
}
function directoryIdentity(identity: FileOperationIdentity) {
  return { fsDeviceId: identity.dev, fsInode: identity.ino };
}
function fileIdentity(identity: FileOperationIdentity): ManagedFileIdentity {
  return {
    sizeBytes: Number(identity.size),
    mtimeMs: Number(BigInt(identity.mtimeNs) / 1_000_000n),
    fsDeviceId: identity.dev,
    fsInode: identity.ino,
    fsBirthtimeNs: null,
    fsCtimeNs: identity.ctimeNs
  };
}
function verifyIndexedIdentity(
  asset: ManagedAsset,
  identity: FileOperationIdentity
): void {
  if (
    !asset.fsDeviceId ||
    !asset.fsInode ||
    asset.fsDeviceId !== identity.dev ||
    asset.fsInode !== identity.ino ||
    asset.sizeBytes !== Number(identity.size) ||
    asset.mtimeMs !== Number(BigInt(identity.mtimeNs) / 1_000_000n) ||
    (asset.fsCtimeNs && asset.fsCtimeNs !== identity.ctimeNs)
  )
    throw new FileManagementError("source_changed");
}
function sameManifestContents(
  left: FileOperationManifest,
  right: FileOperationManifest
): boolean {
  return (
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries[index];
      return (
        other &&
        entry.relativePath === other.relativePath &&
        entry.sha256 === other.sha256 &&
        entry.identity.kind === other.identity.kind &&
        entry.identity.mode === other.identity.mode &&
        entry.identity.metadataSha256 === other.identity.metadataSha256 &&
        entry.identity.mtimeNs === other.identity.mtimeNs &&
        (entry.identity.kind === "directory" ||
          entry.identity.size === other.identity.size)
      );
    })
  );
}
function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const code = error.code;
    if (/^[a-z][a-z_]{0,63}$/.test(code)) return code;
    if (code === "ENOENT") return "source_unavailable";
    if (code === "EEXIST") return "destination_exists";
    if (code === "ENOSPC") return "disk_full";
    if (code === "EACCES" || code === "EPERM" || code === "EROFS")
      return "permission_denied";
  }
  return "filesystem_error";
}
