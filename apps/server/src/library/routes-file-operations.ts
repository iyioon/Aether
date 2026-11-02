import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AetherDatabase } from "../db/database.js";
import {
  FileManagementError,
  FileOperationBody
} from "./file-operation-model.js";
import type { FileOperationManager } from "./file-operations.js";
import {
  countTrash,
  getLibraryRevision,
  listTrash,
  ManagementConflictError
} from "./repository-management.js";
import { getTrashRecord } from "./repository-management.js";
import type { AppConfig } from "../config/config.js";
import { trashThumbnailPath } from "./trash-thumbnails.js";
import { sendThumbnail } from "./thumbnails.js";
import { FileOperationPreviewBody } from "./file-operation-preview.js";

const OperationParams = z.object({ operationId: z.uuid() });
const TrashQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  search: z.string().max(128).default("")
});

export function registerFileOperationRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: AetherDatabase,
  manager: FileOperationManager
): void {
  app.post("/api/file-operations/preview", async (request, reply) => {
    const body = FileOperationPreviewBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "invalid_request" });
    const controller = new AbortController();
    const abort = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once("close", abort);
    try {
      return await manager.preview(body.data, controller.signal);
    } catch (error) {
      return sendManagementError(reply, error);
    } finally {
      reply.raw.removeListener("close", abort);
    }
  });
  app.get("/api/folders/:folderId/inventory", async (request, reply) => {
    const params = z
      .object({ folderId: z.string().min(1).max(256) })
      .safeParse(request.params);
    const query = z
      .object({ expectedVersion: z.string().min(1).max(256) })
      .safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ error: "invalid_request" });
    try {
      return await manager.inspectFolder(
        params.data.folderId,
        query.data.expectedVersion
      );
    } catch (error) {
      return sendManagementError(reply, error);
    }
  });
  app.get("/api/file-operations", async () => ({ items: manager.list() }));
  app.get("/api/file-operations/:operationId", async (request, reply) => {
    const params = OperationParams.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: "invalid_request" });
    const operation = manager.get(params.data.operationId);
    return operation ?? reply.code(404).send({ error: "operation_not_found" });
  });
  app.post("/api/file-operations", async (request, reply) => {
    const body = FileOperationBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "invalid_request" });
    if (body.data.type === "add-media")
      return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.code(202).send(manager.submit(body.data));
    } catch (error) {
      return sendManagementError(reply, error);
    }
  });
  app.post(
    "/api/file-operations/:operationId/retry",
    async (request, reply) => {
      const params = OperationParams.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const operation = manager.retry(params.data.operationId);
        return operation
          ? reply.code(202).send(operation)
          : reply.code(404).send({ error: "operation_not_found" });
      } catch (error) {
        return sendManagementError(reply, error);
      }
    }
  );
  app.post(
    "/api/file-operations/:operationId/cancel",
    async (request, reply) => {
      const params = OperationParams.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "invalid_request" });
      return (
        manager.cancel(params.data.operationId) ??
        reply.code(404).send({ error: "operation_not_found" })
      );
    }
  );
  app.post("/api/trash/empty", async (request, reply) => {
    const body = z
      .object({
        requestId: z.uuid(),
        expectedRevision: z.string().min(1).max(128),
        expectedCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
      })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.code(202).send(manager.submitEmptyTrash(body.data));
    } catch (error) {
      return sendManagementError(reply, error);
    }
  });
  app.get("/api/trash", async (request, reply) => {
    const query = TrashQuery.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: "invalid_request" });
    return db
      .transaction(() => {
        const items = listTrash(
          db,
          query.data.limit,
          query.data.offset,
          query.data.search
        ).map((record) => ({
          id: record.id,
          assetId: record.assetId,
          name: record.originalName,
          originalRootId: record.originalRootId,
          originalFolderId: record.originalFolderId,
          originalRelativePath: record.originalRelativePath,
          sizeBytes: record.identity.sizeBytes,
          deletedAt: record.trashedAt,
          expiresAt: record.expiresAt,
          sourceVersion: record.sourceVersion
        }));
        return {
          items,
          retentionDays: config.fileManagement?.trashRetentionDays ?? 30,
          revision: getLibraryRevision(db),
          totalRetained: countTrash(db),
          page: {
            total: countTrash(db, query.data.search),
            offset: query.data.offset,
            limit: query.data.limit
          }
        };
      })
      .deferred();
  });
  app.get("/api/trash/:trashId/thumbnail", async (request, reply) => {
    const params = z
      .object({ trashId: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/) })
      .safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: "invalid_request" });
    if (!getTrashRecord(db, params.data.trashId))
      return reply.code(404).send({ error: "trash_not_found" });
    try {
      return await sendThumbnail(reply, {
        path: trashThumbnailPath(config, params.data.trashId),
        contentType: "image/webp"
      });
    } catch {
      return reply.code(404).send({ error: "thumbnail_unavailable" });
    }
  });
}

export function sendManagementError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof FileManagementError ||
    error instanceof ManagementConflictError
  ) {
    const status =
      error.code === "read_only"
        ? 403
        : error.code.endsWith("not_found")
          ? 404
          : error.code === "invalid_name" ||
              error.code === "invalid_destination"
            ? 400
            : error.code === "operation_queue_full"
              ? 429
              : 409;
    return reply.code(status).send({ error: error.code });
  }
  throw error;
}
