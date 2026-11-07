import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { Readable } from "node:stream";
import { lstat, mkdir, open, statfs, type FileHandle } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { FileStore } from "@tus/file-store";
import { Server, Upload } from "@tus/server";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import {
  FileManagementError,
  validateManagedName
} from "./file-operation-model.js";
import type { FileOperationManager } from "./file-operations.js";
import { inspectHeifImage } from "./heif-decoder.js";
import { detectMediaType } from "./media-types.js";
import {
  getManagedFolder,
  getManagedRootOwnership,
  ManagementConflictError
} from "./repository-management.js";
import {
  createManagedUpload,
  cancelManagedUploadByRequestId,
  getManagedUpload,
  getManagedUploadByRequestId,
  listManagedUploads,
  listUnsettledManagedUploads,
  pruneUploadCancellations,
  updateManagedUpload,
  uploadVolumeReservations,
  type ManagedUpload
} from "./repository-uploads.js";
import { probeVideoMetadata } from "./video-derivatives.js";
import {
  descriptorPath,
  descriptorFilesystemAvailable,
  assertPrivateDirectory,
  directoryNames,
  lstatRelative,
  openRelative,
  removeRelative,
  rewindDescriptor,
  type DescriptorHandle
} from "../security/descriptor-filesystem.js";

const CHUNK_BYTES = 16 * 1024 ** 2;
const INACTIVITY_MS = 24 * 3600_000;
const UploadMetadata = z.object({
  requestId: z.uuid(),
  folderId: z.string().min(1).max(256),
  expectedParentVersion: z.string().min(1).max(256),
  name: z.string().min(1).max(255),
  conflict: z.enum(["skip", "keep-both"]).default("skip")
});
const UploadParams = z.object({ uploadId: z.uuid() });

function transportError(
  status_code: number,
  body: string
): Error & { status_code: number; body: string } {
  return Object.assign(new Error(body), { status_code, body });
}
function expiresAt(): string {
  return new Date(Date.now() + INACTIVITY_MS).toISOString();
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function metadataFor(upload: ManagedUpload): Record<string, string> {
  return {
    requestId: upload.requestId,
    folderId: upload.folderId,
    expectedParentVersion: upload.expectedParentVersion,
    name: upload.name,
    conflict: upload.conflict
  };
}

/** tus owns transport locks and offsets; private staging uses pinned no-follow
 * descriptors and records its identity before acknowledging creation. */
class BoundedFileStore extends FileStore {
  readonly active = new Set<string>();
  private readonly creating = new Set<string>();
  readonly expectedChecksums = new Map<string, Buffer>();
  constructor(
    directory: string,
    private readonly parent: FileHandle,
    private readonly db: AetherDatabase,
    private readonly beforeWrite: (id: string) => Promise<void>,
    private readonly cleanup: (id: string) => Promise<void>
  ) {
    super({
      directory,
      expirationPeriodInMilliseconds: INACTIVITY_MS,
      configstore: {
        async get(id) {
          const upload = getManagedUpload(db, id);
          return upload && !upload.cleanedUp
            ? new Upload({
                id,
                size: upload.size,
                offset: upload.offset,
                creation_date: new Date(
                  new Date(upload.expiresAt).getTime() - INACTIVITY_MS
                ).toISOString(),
                metadata: metadataFor(upload)
              })
            : undefined;
        },
        async set() {},
        async delete() {},
        async list() {
          return listUnsettledManagedUploads(db).map((upload) => upload.id);
        }
      }
    });
    this.extensions = [
      "creation",
      "creation-with-upload",
      "termination",
      "expiration",
      "checksum"
    ];
  }
  private validateId(id: string): void {
    if (!UploadParams.safeParse({ uploadId: id }).success)
      throw transportError(404, "upload_not_found");
  }
  private async assertParent(): Promise<void> {
    const expected = await this.parent.stat({ bigint: true });
    const actual = await lstat(this.directory, { bigint: true });
    if (
      !actual.isDirectory() ||
      actual.isSymbolicLink() ||
      expected.dev !== actual.dev ||
      expected.ino !== actual.ino
    )
      throw transportError(409, "upload_staging_changed");
  }
  async openUpload(id: string): Promise<DescriptorHandle> {
    this.validateId(id);
    const upload = getManagedUpload(this.db, id);
    if (!upload || !upload.stagingIdentity || upload.cleanedUp)
      throw transportError(404, "upload_not_found");
    await this.assertParent();
    const handle = await openRelative(
      this.parent,
      id,
      constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const info = await handle.stat({ bigint: true });
      if (
        !info.isFile() ||
        info.nlink !== 1n ||
        info.dev.toString() !== upload.stagingIdentity.dev ||
        info.ino.toString() !== upload.stagingIdentity.ino ||
        info.size > BigInt(upload.size) ||
        info.uid !== BigInt(process.getuid!()) ||
        (info.mode & 0o777n) !== 0o600n
      )
        throw transportError(409, "upload_changed");
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  claim(id: string): void {
    if (this.active.has(id) || this.active.size >= 2)
      throw transportError(429, "upload_busy");
    this.active.add(id);
  }
  claimCreation(id: string): void {
    this.claim(id);
    this.creating.add(id);
  }
  async releaseCreation(id: string): Promise<void> {
    if (!this.creating.delete(id)) return;
    try {
      const latest = getManagedUpload(this.db, id);
      if (latest?.status === "receiving")
        updateManagedUpload(this.db, {
          ...latest,
          status: "failed",
          errorCode: "upload_interrupted"
        });
    } finally {
      await this.release(id);
    }
  }
  async release(id: string): Promise<void> {
    this.active.delete(id);
    const latest = getManagedUpload(this.db, id);
    if (
      latest &&
      !["receiving", "validating", "publishing"].includes(latest.status)
    )
      await this.cleanup(id);
  }
  override async create(upload: Upload): Promise<Upload> {
    let claimed = this.creating.delete(upload.id);
    let handle: DescriptorHandle | undefined;
    try {
      if (!claimed) {
        this.claim(upload.id);
        claimed = true;
      }
      await this.assertParent();
      const admitted = getManagedUpload(this.db, upload.id);
      if (!admitted || admitted.status !== "receiving" || admitted.cleanedUp)
        throw transportError(409, "upload_cancelled");
      if (admitted.stagingIdentity)
        throw transportError(409, "upload_creation_conflict");
      this.validateId(upload.id);
      handle = await openRelative(
        this.parent,
        upload.id,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600
      );
      const info = await handle.stat({ bigint: true });
      // Cancellation can run while open/stat is pending. Preserve its status
      // and retain ownership of any newly created file until verified cleanup.
      updateManagedUpload(this.db, {
        ...getManagedUpload(this.db, upload.id)!,
        stagingIdentity: { dev: String(info.dev), ino: String(info.ino) }
      });
      await handle.sync();
      await this.parent.sync();
      if (getManagedUpload(this.db, upload.id)?.status !== "receiving")
        throw transportError(409, "upload_cancelled");
      return upload;
    } catch (error) {
      const latest = getManagedUpload(this.db, upload.id);
      if (latest?.status === "receiving")
        updateManagedUpload(this.db, {
          ...latest,
          status: "failed",
          errorCode: "upload_creation_failed"
        });
      throw error;
    } finally {
      await handle?.close();
      if (claimed) await this.release(upload.id);
      else await this.cleanup(upload.id);
    }
  }
  override async getUpload(id: string): Promise<Upload> {
    if (this.active.has(id)) throw transportError(429, "upload_busy");
    const upload = getManagedUpload(this.db, id);
    if (!upload || upload.cleanedUp)
      throw transportError(410, "upload_expired");
    const handle = await this.openUpload(id);
    try {
      const info = await handle.stat();
      if (info.size < upload.offset)
        throw transportError(409, "upload_changed");
      await handle.sync();
      const latest = getManagedUpload(this.db, id)!;
      if (latest.status === "cancelled")
        throw transportError(409, "upload_cancelled");
      if (latest.offset !== info.size && latest.status === "receiving")
        updateManagedUpload(this.db, { ...latest, offset: info.size });
      return new Upload({
        id,
        size: upload.size,
        offset: info.size,
        creation_date: new Date(
          new Date(upload.expiresAt).getTime() - INACTIVITY_MS
        ).toISOString(),
        metadata: metadataFor(upload)
      });
    } finally {
      await handle.close();
    }
  }
  override async write(
    readable: Parameters<FileStore["write"]>[0],
    id: string,
    offset: number
  ): Promise<number> {
    this.claim(id);
    let handle: DescriptorHandle | undefined;
    try {
      await this.beforeWrite(id);
      handle = await this.openUpload(id);
      const upload = getManagedUpload(this.db, id)!;
      const before = await handle.stat();
      if (before.size !== offset)
        throw transportError(409, "upload_offset_conflict");
      let received = 0;
      let position = offset;
      const expectedChecksum = this.expectedChecksums.get(id);
      const checksum = expectedChecksum ? createHash("sha256") : null;
      try {
        for await (const chunk of readable) {
          if (getManagedUpload(this.db, id)?.status !== "receiving")
            throw transportError(409, "upload_cancelled");
          const buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as Uint8Array);
          if (
            received + buffer.length > CHUNK_BYTES ||
            position + buffer.length > upload.size
          )
            throw transportError(413, "chunk_too_large");
          received += buffer.length;
          checksum?.update(buffer);
          let written = 0;
          while (written < buffer.length) {
            const result = await handle.write(
              buffer,
              written,
              buffer.length - written,
              position + written
            );
            if (!result.bytesWritten)
              throw transportError(507, "upload_write_failed");
            written += result.bytesWritten;
          }
          position += buffer.length;
        }
        if (getManagedUpload(this.db, id)?.status !== "receiving")
          throw transportError(409, "upload_cancelled");
        if (
          checksum &&
          expectedChecksum &&
          !timingSafeEqual(checksum.digest(), expectedChecksum)
        ) {
          // The durable prefix preceding this request remains acknowledged.
          // Discard only this unacknowledged chunk from the verified stage.
          await handle.truncate(offset);
          throw transportError(460, "upload_checksum_mismatch");
        }
      } finally {
        // A disconnected request can still have received a valid prefix. Flush
        // it before exposing its offset to a resumed client.
        await handle.sync();
        const after = await handle.stat();
        const latest = getManagedUpload(this.db, id)!;
        updateManagedUpload(this.db, {
          ...latest,
          offset: after.size,
          expiresAt: expiresAt()
        });
      }
      if (getManagedUpload(this.db, id)?.status !== "receiving")
        throw transportError(409, "upload_cancelled");
      return position;
    } finally {
      await handle?.close();
      await this.release(id);
      this.expectedChecksums.delete(id);
    }
  }
  override async remove(id: string): Promise<void> {
    const upload = getManagedUpload(this.db, id);
    if (!upload || upload.status !== "receiving")
      throw transportError(409, "upload_not_cancellable");
    cancelManagedUploadByRequestId(this.db, upload.requestId);
    await this.cleanup(id);
  }
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: AetherDatabase,
  operations: FileOperationManager
): Promise<void> {
  if (!descriptorFilesystemAvailable()) {
    app.get("/api/uploads/status", async () => ({
      items: [],
      limits: {
        maxUploadBytes: config.fileManagement?.maxUploadBytes ?? 20 * 1024 ** 3,
        maxStagingBytes:
          config.fileManagement?.maxStagingBytes ?? 20 * 1024 ** 3,
        chunkBytes: CHUNK_BYTES,
        maxBatchItems: 100
      },
      recoveryRequired: false
    }));
    for (const url of ["/api/uploads", "/api/uploads/:uploadId"])
      app.all(url, async (_request, reply) =>
        reply.code(403).send({ error: "unsupported_filesystem" })
      );
    return;
  }
  const directory = path.join(config.dataDir, "uploads");
  let created = false;
  try {
    await mkdir(directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = await lstat(directory, { bigint: true });
  const uid = process.getuid?.();
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777n) !== 0o700n ||
    uid === undefined ||
    info.uid !== BigInt(uid)
  )
    throw new Error("Upload staging requires a private directory.");
  const parent = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  let openedParent: BigIntStats;
  try {
    openedParent = await parent.stat({ bigint: true });
    if (openedParent.dev !== info.dev || openedParent.ino !== info.ino)
      throw new Error("Upload staging changed during startup.");
    await assertPrivateDirectory(parent, created);
  } catch (error) {
    await parent.close();
    throw error;
  }
  const maxUploadBytes =
    config.fileManagement?.maxUploadBytes ?? 20 * 1024 ** 3;
  const maxStagingBytes =
    config.fileManagement?.maxStagingBytes ?? 20 * 1024 ** 3;
  const minFreeBytes = config.fileManagement?.minFreeBytes ?? 2 * 1024 ** 3;
  let closing = false;
  let stagingUnsafe = false;
  const finishJobs = new Map<string, Promise<string>>();
  const cleanupJobs = new Map<string, Promise<void>>();
  const activeRequests = new Set<Promise<void>>();
  const protocolTransfers = new Set<string>();
  const creationRequests = new WeakMap<Request, string>();
  const requireUpload = (id: string) => {
    const upload = getManagedUpload(db, id);
    if (!upload) throw transportError(404, "upload_not_found");
    if (upload.status === "cancelled")
      throw transportError(409, "upload_cancelled");
    if (
      upload.cleanedUp ||
      (new Date(upload.expiresAt).getTime() <= Date.now() &&
        upload.status === "receiving" &&
        upload.offset < upload.size)
    )
      throw transportError(410, "upload_expired");
    return upload;
  };
  const checkSpace = async () => {
    const reservations = uploadVolumeReservations(db);
    const volumes = new Map<string, string>([
      [String(openedParent.dev), directory]
    ]);
    for (const upload of listUnsettledManagedUploads(db)) {
      const root = config.mediaRoots.find(
        (candidate) => candidate.id === upload.destinationRootId
      );
      if (root && upload.destinationDevice)
        volumes.set(upload.destinationDevice, root.realPath);
    }
    for (const [device, bytes] of reservations) {
      const volume = volumes.get(device);
      if (!volume) throw transportError(409, "destination_changed");
      const space = await statfs(volume, { bigint: true });
      if (space.bavail * space.bsize < bytes + BigInt(minFreeBytes))
        throw transportError(507, "insufficient_space");
    }
  };
  const cleanupInternal = async (id: string) => {
    const upload = getManagedUpload(db, id);
    if (
      !upload ||
      upload.cleanedUp ||
      store.active.has(id) ||
      finishJobs.has(id) ||
      ["receiving", "validating", "publishing"].includes(upload.status)
    )
      return;
    let handle: DescriptorHandle | undefined;
    try {
      if (!upload.stagingIdentity) {
        try {
          await lstatRelative(parent, id);
          throw transportError(409, "upload_changed");
        } catch (error) {
          if (!missing(error)) throw error;
        }
      } else {
        try {
          handle = await store.openUpload(id);
        } catch (error) {
          if (!missing(error)) throw error;
        }
        if (handle) {
          const current = await lstatRelative(parent, id);
          if (
            current.dev.toString() !== upload.stagingIdentity.dev ||
            current.ino.toString() !== upload.stagingIdentity.ino ||
            !current.isFile() ||
            current.nlink !== 1n
          )
            throw transportError(409, "upload_changed");
          await removeRelative(parent, id, false, upload.stagingIdentity);
          await parent.sync();
        }
      }
      updateManagedUpload(db, {
        ...getManagedUpload(db, id)!,
        cleanedUp: true
      });
    } catch {
      stagingUnsafe = true;
      updateManagedUpload(db, {
        ...getManagedUpload(db, id)!,
        errorCode: "upload_cleanup_required"
      });
    } finally {
      await handle?.close();
    }
  };
  const cleanup = (id: string): Promise<void> => {
    const running = cleanupJobs.get(id);
    if (running) return running;
    const job = cleanupInternal(id);
    cleanupJobs.set(id, job);
    void job.finally(() => cleanupJobs.delete(id)).catch(() => undefined);
    return job;
  };
  const store: BoundedFileStore = new BoundedFileStore(
    directory,
    parent,
    db,
    async (id) => {
      if (closing || stagingUnsafe)
        throw transportError(503, "upload_recovery_required");
      const upload = requireUpload(id);
      const folder = getManagedFolder(db, upload.folderId);
      if (upload.status !== "receiving")
        throw transportError(409, "upload_not_receiving");
      if (
        !folder ||
        folder.rootId !== upload.destinationRootId ||
        !operations.canWrite(folder.rootId)
      )
        throw transportError(403, "read_only");
      await checkSpace();
    },
    cleanup
  );
  const finish = (id: string): Promise<string> => {
    const running = finishJobs.get(id);
    if (running) return running;
    const job = (async () => {
      const upload = requireUpload(id);
      if (upload.operationId) return upload.operationId;
      if (!["receiving", "validating"].includes(upload.status))
        throw transportError(409, "upload_not_receiving");
      updateManagedUpload(db, {
        ...upload,
        status: "validating",
        offset: upload.size
      });
      try {
        const handle = await store.openUpload(id);
        try {
          await validateUploadedMedia(handle, upload.name, upload.size);
        } finally {
          await handle.close();
        }
        const operation = operations.publishUpload({
          requestId: upload.requestId,
          uploadId: id,
          destinationFolderId: upload.folderId,
          expectedParentVersion: upload.expectedParentVersion,
          name: upload.name,
          conflict: upload.conflict
        });
        updateManagedUpload(db, {
          ...getManagedUpload(db, id)!,
          offset: upload.size,
          operationId: operation.id,
          status: "publishing"
        });
        return operation.id;
      } catch (error) {
        const code =
          error instanceof FileManagementError
            ? error.code
            : "unsupported_media";
        updateManagedUpload(db, {
          ...getManagedUpload(db, id)!,
          status: "failed",
          errorCode: code
        });
        throw transportError(422, code);
      }
    })();
    finishJobs.set(id, job);
    void job
      .finally(() => {
        finishJobs.delete(id);
        void cleanup(id);
      })
      .catch(() => undefined);
    return job;
  };
  const server = new Server({
    path: "/api/uploads",
    datastore: store,
    maxSize: maxUploadBytes,
    relativeLocation: true,
    allowedOrigins: [],
    disableTerminationForFinishedUploads: true,
    namingFunction: () => randomUUID(),
    async onIncomingRequest(request, id) {
      const checksumHeader = request.headers.get("upload-checksum");
      if (checksumHeader) {
        if (request.method !== "PATCH")
          throw transportError(400, "upload_checksum_unsupported");
        const parts = /^sha256 ([A-Za-z0-9+/]{43}=)$/.exec(checksumHeader);
        if (!parts) throw transportError(400, "upload_checksum_invalid");
        const expected = Buffer.from(parts[1]!, "base64");
        if (expected.length !== 32 || expected.toString("base64") !== parts[1])
          throw transportError(400, "upload_checksum_invalid");
        store.expectedChecksums.set(id, expected);
      }
      if (request.method === "GET")
        throw transportError(404, "upload_not_found");
      if (request.method === "POST" || request.method === "OPTIONS") return;
      if (!UploadParams.safeParse({ uploadId: id }).success)
        throw transportError(404, "upload_not_found");
      const upload = requireUpload(id);
      if (request.method === "PATCH" && upload.status !== "receiving")
        throw transportError(409, "upload_not_receiving");
      if (request.method === "DELETE" && upload.status !== "receiving")
        throw transportError(409, "upload_not_cancellable");
      const length = request.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > CHUNK_BYTES))
        throw transportError(413, "chunk_too_large");
    },
    async onUploadCreate(request, upload) {
      if (closing || stagingUnsafe)
        throw transportError(503, "upload_recovery_required");
      const metadata = UploadMetadata.safeParse(upload.metadata);
      if (
        !metadata.success ||
        !upload.size ||
        !Number.isSafeInteger(upload.size) ||
        upload.size > maxUploadBytes
      )
        throw transportError(400, "invalid_upload");
      try {
        validateManagedName(metadata.data.name);
      } catch {
        throw transportError(400, "invalid_name");
      }
      if (!detectMediaType(path.extname(metadata.data.name).toLowerCase()))
        throw transportError(415, "unsupported_media");
      const folder = getManagedFolder(db, metadata.data.folderId);
      if (
        !folder ||
        folder.sourceVersion !== metadata.data.expectedParentVersion
      )
        throw transportError(409, "destination_changed");
      if (!operations.canWrite(folder.rootId))
        throw transportError(403, "read_only");
      // Reserve synchronously before the first filesystem await. Other
      // admissions and chunks observe this full logical reservation.
      const ownership = getManagedRootOwnership(db, folder.rootId);
      if (
        !ownership ||
        (folder.fsDeviceId && folder.fsDeviceId !== ownership.deviceId)
      )
        throw transportError(403, "unsupported_filesystem");
      // Status reconciliation must not inspect a reservation whose staging
      // file has not been created yet. Transfer this claim to store.create.
      store.claimCreation(upload.id);
      creationRequests.set(request, upload.id);
      try {
        createManagedUpload(
          db,
          {
            ...metadata.data,
            id: upload.id,
            size: upload.size,
            offset: 0,
            status: "receiving",
            expiresAt: expiresAt(),
            stagingDevice: String(openedParent.dev),
            destinationDevice: ownership.deviceId,
            destinationRootId: folder.rootId,
            cleanedUp: false
          },
          maxStagingBytes
        );
      } catch (error) {
        if (
          error instanceof ManagementConflictError &&
          error.code === "upload_cancelled"
        )
          throw transportError(409, "upload_cancelled");
        throw transportError(409, "upload_admission_failed");
      }
      try {
        await checkSpace();
      } catch (error) {
        const latest = getManagedUpload(db, upload.id)!;
        if (latest.status === "receiving")
          updateManagedUpload(db, {
            ...latest,
            status: "failed",
            cleanedUp: true,
            errorCode: "insufficient_space"
          });
        throw error;
      }
      const latest = getManagedUpload(db, upload.id)!;
      if (latest.status !== "receiving" || latest.cleanedUp)
        throw transportError(409, "upload_cancelled");
      return {};
    },
    async onUploadFinish(_request, upload) {
      return { headers: { "Upload-Operation-Id": await finish(upload.id) } };
    },
    onResponseError: (_request, error) => {
      const failure = error as { status_code?: number; body?: string };
      const status =
        typeof failure.status_code === "number" &&
        failure.status_code >= 400 &&
        failure.status_code <= 599
          ? failure.status_code
          : 500;
      const body =
        typeof failure.body === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(failure.body)
          ? failure.body
          : ((
              {
                404: "upload_not_found",
                409: "upload_offset_conflict",
                410: "upload_expired",
                413: "upload_too_large",
                415: "unsupported_media",
                429: "upload_busy",
                507: "insufficient_space"
              } as Record<number, string>
            )[status] ?? "upload_failed");
      return { status_code: status, body };
    }
  });
  let reconciling: Promise<void> | null = null;
  const reconcile = (): Promise<void> => {
    if (reconciling) return reconciling;
    const job = (async () => {
      for (const current of listUnsettledManagedUploads(db)) {
        if (store.active.has(current.id) || finishJobs.has(current.id))
          continue;
        let upload = getManagedUpload(db, current.id)!;
        if (upload.status === "receiving") {
          try {
            const actual = await store.getUpload(upload.id);
            upload = getManagedUpload(db, upload.id)!;
            if (actual.offset === upload.size) {
              if (!closing) void finish(upload.id).catch(() => undefined);
              continue;
            }
          } catch (error) {
            if (!upload.stagingIdentity && missing(error))
              updateManagedUpload(db, {
                ...upload,
                status: "failed",
                cleanedUp: true,
                errorCode: "upload_interrupted"
              });
            else
              updateManagedUpload(db, {
                ...upload,
                status: "failed",
                errorCode: "upload_changed"
              });
          }
          upload = getManagedUpload(db, upload.id)!;
          if (
            upload.status === "receiving" &&
            new Date(upload.expiresAt).getTime() <= Date.now()
          )
            updateManagedUpload(db, { ...upload, status: "expired" });
        } else if (upload.status === "validating") {
          if (!closing) void finish(upload.id).catch(() => undefined);
          continue;
        } else if (upload.status === "publishing" && upload.operationId) {
          const operation = operations.get(upload.operationId);
          if (operation?.status === "completed")
            updateManagedUpload(db, { ...upload, status: "completed" });
          else if (
            operation &&
            ["failed", "cancelled", "partial"].includes(operation.status)
          )
            updateManagedUpload(db, {
              ...upload,
              status: operation.status === "cancelled" ? "cancelled" : "failed",
              errorCode:
                operation.items.find((item) => item.errorCode)?.errorCode ??
                "upload_publication_failed"
            });
        }
        await cleanup(upload.id);
      }
      db.prepare(
        "DELETE FROM managed_uploads WHERE COALESCE(json_extract(state_json,'$.cleanedUp'),0) = 1 AND status IN ('completed','failed','cancelled','expired') AND updated_at < ?"
      ).run(new Date(Date.now() - 7 * 86400_000).toISOString());
      pruneUploadCancellations(db);
    })();
    reconciling = job;
    void job
      .finally(() => {
        if (reconciling === job) reconciling = null;
      })
      .catch(() => undefined);
    return job;
  };
  for (const name of await directoryNames(parent)) {
    const upload = getManagedUpload(db, name);
    if (!upload?.stagingIdentity || upload.cleanedUp) stagingUnsafe = true;
  }
  await reconcile();
  const timer = setInterval(() => {
    void reconcile().catch(() => undefined);
  }, 60_000);
  timer.unref();
  app.addHook("preClose", async () => {
    closing = true;
    clearInterval(timer);
    await Promise.allSettled([...activeRequests]);
    await reconciling?.catch(() => undefined);
    await Promise.allSettled([...finishJobs.values()]);
    await reconcile().catch(() => undefined);
    await Promise.allSettled([...cleanupJobs.values()]);
  });
  app.addHook("onClose", async () => {
    await parent.close();
  });

  app.get("/api/uploads/status", async (request, reply) => {
    const query = z
      .object({ requestId: z.uuid().optional() })
      .safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: "invalid_request" });
    await reconcile();
    const targeted = query.data.requestId
      ? getManagedUploadByRequestId(db, query.data.requestId)
      : null;
    return {
      items: (query.data.requestId
        ? targeted
          ? [targeted]
          : []
        : listManagedUploads(db)
      ).map((upload) => ({
        id: upload.id,
        requestId: upload.requestId,
        name: upload.name,
        folderId: upload.folderId,
        expectedParentVersion: upload.expectedParentVersion,
        conflict: upload.conflict,
        operationId: upload.operationId,
        status: upload.status,
        offset: upload.offset,
        size: upload.size,
        expiresAt: upload.expiresAt,
        errorCode: upload.errorCode
      })),
      limits: {
        maxUploadBytes,
        maxStagingBytes,
        chunkBytes: CHUNK_BYTES,
        maxBatchItems: 100
      },
      recoveryRequired: stagingUnsafe
    };
  });
  app.post("/api/uploads/cancel", async (request, reply) => {
    const body = z
      .object({ requestId: z.uuid() })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "invalid_request" });
    try {
      const upload = cancelManagedUploadByRequestId(db, body.data.requestId);
      if (upload) await cleanup(upload.id);
      return { status: "cancelled" };
    } catch {
      return reply.code(409).send({ error: "upload_not_cancellable" });
    }
  });
  app.get("/api/uploads/:uploadId/prefix", async (request, reply) => {
    const params = UploadParams.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: "invalid_request" });
    const upload = getManagedUpload(db, params.data.uploadId);
    if (!upload || upload.status !== "receiving")
      return reply.code(404).send({ error: "upload_not_found" });
    let handle: DescriptorHandle | undefined;
    let claimed = false;
    try {
      store.claim(upload.id);
      claimed = true;
      handle = await store.openUpload(upload.id);
      const before = await handle.stat();
      await handle.sync();
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      const deadline = Date.now() + 300_000;
      for (let offset = 0; offset < before.size;) {
        if (Date.now() > deadline || reply.raw.destroyed)
          throw transportError(409, "upload_interrupted");
        const read = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, before.size - offset),
          offset
        );
        if (!read.bytesRead) throw transportError(409, "upload_changed");
        hash.update(buffer.subarray(0, read.bytesRead));
        offset += read.bytesRead;
      }
      const after = await handle.stat();
      if (
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        throw transportError(409, "upload_changed");
      updateManagedUpload(db, {
        ...getManagedUpload(db, upload.id)!,
        offset: before.size
      });
      return { offset: before.size, sha256: hash.digest("hex") };
    } catch (error) {
      const failure = error as { status_code?: number; body?: string };
      return reply
        .code(failure.status_code ?? 409)
        .send({ error: failure.body ?? "upload_changed" });
    } finally {
      await handle?.close();
      if (claimed) await store.release(upload.id);
    }
  });
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/offset+octet-stream",
      (_request, _payload, done) => done(null)
    );
    const handle = async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", "no-store");
      if (typeof request.raw.setTimeout === "function")
        request.raw.setTimeout(60_000, () => request.raw.destroy());
      const controller = new AbortController();
      let webRequest: Request | undefined;
      let finishRequest!: () => void;
      const completion = new Promise<void>((resolve) => {
        finishRequest = resolve;
      });
      activeRequests.add(completion);
      const transferKey =
        request.method === "PATCH"
          ? new URL(request.url, "http://aether.invalid").pathname
          : request.method === "POST" &&
              Number(request.headers["content-length"] ?? 0) > 0
            ? randomUUID()
            : null;
      let transferClaimed = false;
      const abort = () => controller.abort();
      const onClose = () => {
        if (!reply.raw.writableEnded) abort();
      };
      request.raw.once("aborted", abort);
      request.raw.once("error", abort);
      reply.raw.once("close", onClose);
      try {
        if (transferKey) {
          if (protocolTransfers.has(transferKey) || protocolTransfers.size >= 2)
            return reply.code(429).send({ error: "upload_busy" });
          protocolTransfers.add(transferKey);
          transferClaimed = true;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
        const hasBody =
          request.method !== "GET" &&
          request.method !== "HEAD" &&
          (Number(request.headers["content-length"] ?? 0) > 0 ||
            request.headers["transfer-encoding"] !== undefined);
        const init: RequestInit & { duplex?: "half" } = {
          method: request.method,
          headers,
          signal: controller.signal
        };
        if (hasBody) {
          init.body = Readable.toWeb(request.raw) as ReadableStream<Uint8Array>;
          init.duplex = "half";
        }
        webRequest = new Request(
          new URL(request.url, "http://aether.invalid"),
          init
        );
        const response = await server.handleWeb(webRequest);
        reply.code(response.status);
        response.headers.forEach((value, key) => {
          reply.header(key, value);
        });
        if (request.method === "OPTIONS")
          reply.header("Tus-Checksum-Algorithm", "sha256");
        return reply.send(
          response.body ? Buffer.from(await response.arrayBuffer()) : undefined
        );
      } finally {
        try {
          const creationId = webRequest && creationRequests.get(webRequest);
          if (webRequest && creationId) {
            creationRequests.delete(webRequest);
            await store.releaseCreation(creationId);
          }
        } finally {
          if (transferKey && transferClaimed)
            protocolTransfers.delete(transferKey);
          if (request.method === "PATCH" && transferClaimed)
            store.expectedChecksums.delete(
              request.params &&
                typeof request.params === "object" &&
                "uploadId" in request.params
                ? String(request.params.uploadId)
                : ""
            );
          activeRequests.delete(completion);
          finishRequest();
          request.raw.off("aborted", abort);
          request.raw.off("error", abort);
          reply.raw.off("close", onClose);
        }
      }
    };
    scope.all("/api/uploads", handle);
    scope.all("/api/uploads/:uploadId", handle);
  });
}
async function validateUploadedMedia(
  handle: DescriptorHandle,
  name: string,
  expectedSize: number
): Promise<void> {
  const filename = descriptorPath(handle);
  const stat = await handle.stat();
  if (!stat.isFile() || stat.nlink !== 1 || stat.size !== expectedSize)
    throw new FileManagementError("upload_changed");
  const header = Buffer.alloc(64);
  await handle.read(header, 0, header.length, 0);
  const type = detectMediaType(path.extname(name).toLowerCase());
  if (!type) throw new FileManagementError("unsupported_media");
  if (type.mediaType === "image") {
    if (/\.hei[cf]$/i.test(name)) await inspectHeifImage(filename, handle.fd);
    else {
      await rewindDescriptor(handle);
      const metadata = await sharp(filename, {
        limitInputPixels: 268_402_689
      }).metadata();
      const formats: Record<string, string[]> = {
        ".jpg": ["jpeg"],
        ".jpeg": ["jpeg"],
        ".png": ["png"],
        ".apng": ["png"],
        ".gif": ["gif"],
        ".webp": ["webp"],
        ".avif": ["heif", "avif"],
        ".tif": ["tiff"],
        ".tiff": ["tiff"],
        ".bmp": ["bmp"]
      };
      if (
        !metadata.width ||
        !metadata.height ||
        !formats[path.extname(name).toLowerCase()]?.includes(
          metadata.format ?? ""
        )
      )
        throw new FileManagementError("unsupported_media");
    }
  } else {
    const magic = header.subarray(0, 4).toString("hex");
    if (!(
      header.subarray(4, 8).toString() === "ftyp" ||
      ["moov", "wide", "mdat"].includes(header.subarray(4, 8).toString()) ||
      magic === "1a45dfa3" ||
      (magic === "52494646" && header.subarray(8, 12).toString() === "AVI ") ||
      magic === "000001ba" ||
      magic === "000001b3"
    ))
      throw new FileManagementError("unsupported_media");
    const metadata = await probeVideoMetadata(
      {
        sourcePath: filename,
        sizeBytes: expectedSize,
        mtimeMs: stat.mtimeMs,
        asset: {
          id: "upload",
          name,
          mediaType: "video",
          mimeType: type.mimeType,
          indexedMtimeMs: stat.mtimeMs,
          indexedSizeBytes: expectedSize,
          width: null,
          height: null,
          durationMs: null,
          codec: null
        }
      },
      handle.fd
    );
    if (!metadata.width || !metadata.height || !metadata.codec)
      throw new FileManagementError("unsupported_media");
  }
  const after = await handle.stat();
  if (
    after.size !== stat.size ||
    after.mtimeMs !== stat.mtimeMs ||
    after.ctimeMs !== stat.ctimeMs
  )
    throw new FileManagementError("upload_changed");
}
