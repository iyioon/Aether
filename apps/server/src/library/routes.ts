import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import {
  AiTaggingDisabledError,
  AiTaggingProviderError,
  AiTaggingUnsupportedAssetError,
  suggestAiAssetTags
} from "./ai-tag-suggestions.js";
import {
  folderIdFor,
  getAsset,
  getAssetTags,
  InvalidTagError,
  listAssets,
  listFolders,
  setAssetTags,
  suggestTags,
  updateAssetRating,
  updateAssetRatingsBatch,
  updateAssetTagsBatch
} from "./repository.js";
import type { LibraryScanner } from "./scanner.js";
import {
  isAssetNotModified,
  mediaErrorStatus,
  requestedByteRange,
  resolveAssetFile,
  sendAssetNotModified,
  sendAssetStream,
  sendRangeNotSatisfiable
} from "./media-serving.js";
import {
  ensureImageThumbnail,
  sendThumbnail,
  UnsupportedThumbnailError
} from "./thumbnails.js";
import {
  ensureVideoPreview,
  ensureVideoPoster,
  sendVideoPreview,
  UnsupportedVideoPreviewError,
  UnsupportedVideoPosterError
} from "./video-derivatives.js";
import { suggestAssetTags } from "./tag-suggestions.js";
import type { LibraryWatcher } from "./watcher.js";

const AssetListQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(250).default(80),
  sort: z
    .enum(["newest", "oldest", "filename", "rating", "random"])
    .default("newest"),
  type: z.enum(["all", "image", "video"]).default("all"),
  search: z.string().max(128).default(""),
  tag: z.string().max(64).default(""),
  rating: z.enum(["all", "favorites", "rated", "unrated"]).default("all"),
  recursive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false")
});

const AssetParams = z.object({
  assetId: z.string().min(1).max(256)
});

const ThumbnailQuery = z.object({
  size: z.coerce.number().int().min(96).max(1600).default(640)
});

const VideoPreviewQuery = z.object({
  size: z.coerce
    .number()
    .int()
    .min(160)
    .max(720)
    .default(480)
    .transform((value) => (value % 2 === 0 ? value : value - 1)),
  duration: z.coerce.number().int().min(1).max(8).default(4)
});

const RatingBody = z
  .object({
    rating: z.number().int().min(0).max(10).nullable().optional(),
    favorite: z.boolean().optional()
  })
  .refine((data) => data.rating !== undefined || data.favorite !== undefined);

const TagsBody = z.object({
  tags: z.array(z.string()).max(50)
});

const BatchAssetIds = z.array(z.string().min(1).max(256)).min(1).max(500);

const BatchRatingBody = z
  .object({
    assetIds: BatchAssetIds,
    rating: z.number().int().min(0).max(10).nullable().optional(),
    favorite: z.boolean().optional()
  })
  .refine((data) => data.rating !== undefined || data.favorite !== undefined);

const BatchTagsBody = z
  .object({
    assetIds: BatchAssetIds,
    tags: z.array(z.string()).max(50),
    mode: z.enum(["add", "replace"]).default("add")
  })
  .refine(
    (data) =>
      data.mode === "replace" || data.tags.some((tag) => tag.trim().length > 0)
  );

const TagSuggestionQuery = z.object({
  q: z.string().max(64).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(10)
});

const AssetTagSuggestionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(8)
});

export async function registerLibraryRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: AetherDatabase,
  scanner: LibraryScanner,
  watcher: LibraryWatcher | null = null
): Promise<void> {
  app.get("/api/tree", async () => {
    const folders = listFolders(db);
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));

    return {
      roots: config.mediaRoots.map((root) => {
        const folderId = folderIdFor(root.id, "");
        const rootFolder = folderById.get(folderId);

        return {
          id: root.id,
          folderId,
          label: root.label,
          assetCount: rootFolder?.assetCount ?? 0
        };
      }),
      folders: folders
        .filter((folder) => folder.relativePath !== "")
        .map((folder) => ({
          id: folder.id,
          rootId: folder.rootId,
          parentId: folder.parentId,
          label: folder.name,
          relativePath: folder.relativePath,
          assetCount: folder.assetCount
        }))
    };
  });

  app.get("/api/folders/:folderId/assets", async (request, reply) => {
    const params = z
      .object({ folderId: z.string().min(1).max(256) })
      .safeParse(request.params);
    const query = AssetListQuery.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = listAssets(db, {
      folderId: params.data.folderId,
      offset: query.data.offset,
      limit: query.data.limit,
      sort: query.data.sort,
      type: query.data.type,
      recursive: query.data.recursive,
      search: query.data.search,
      tag: query.data.tag,
      ratingFilter: query.data.rating
    });

    if (!result) {
      return reply.code(404).send({ error: "folder_not_found" });
    }

    return {
      folderId: params.data.folderId,
      ...result,
      sort: query.data.sort,
      type: query.data.type,
      recursive: query.data.recursive,
      search: query.data.search,
      tag: query.data.tag,
      rating: query.data.rating
    };
  });

  app.get("/api/assets/:assetId", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const asset = getAsset(db, params.data.assetId);

    if (!asset) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return asset;
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/assets/:assetId/media",
    handler: async (request, reply) =>
      streamAssetFile(request, reply, db, "inline")
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/assets/:assetId/download",
    handler: async (request, reply) =>
      streamAssetFile(request, reply, db, "attachment")
  });

  app.get("/api/assets/:assetId/thumbnail", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const query = ThumbnailQuery.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const file = await resolveAssetFile(db, params.data.assetId);

      if (!file) {
        return reply.code(404).send({ error: "asset_not_found" });
      }

      const thumbnail =
        file.asset.mediaType === "video"
          ? await ensureVideoPoster({
              db,
              config,
              file,
              size: query.data.size
            })
          : await ensureImageThumbnail({
              db,
              config,
              file,
              size: query.data.size
            });

      return sendThumbnail(reply, thumbnail);
    } catch (error) {
      if (
        error instanceof UnsupportedThumbnailError ||
        error instanceof UnsupportedVideoPosterError
      ) {
        return reply.code(415).send({ error: "thumbnail_not_supported" });
      }

      return reply.code(derivativeErrorStatus(error)).send({
        error: "thumbnail_generation_failed"
      });
    }
  });

  app.get("/api/assets/:assetId/preview", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const query = VideoPreviewQuery.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const file = await resolveAssetFile(db, params.data.assetId);

      if (!file) {
        return reply.code(404).send({ error: "asset_not_found" });
      }

      const preview = await ensureVideoPreview({
        db,
        config,
        file,
        size: query.data.size,
        durationSeconds: query.data.duration
      });

      return sendVideoPreview({
        reply,
        preview,
        rangeHeader: normalizedHeader(request.headers.range)
      });
    } catch (error) {
      if (error instanceof UnsupportedVideoPreviewError) {
        return reply.code(415).send({ error: "preview_not_supported" });
      }

      return reply.code(derivativeErrorStatus(error)).send({
        error: "preview_generation_failed"
      });
    }
  });

  app.patch("/api/assets/:assetId/rating", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const body = RatingBody.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const asset = updateAssetRating(db, {
      assetId: params.data.assetId,
      rating: body.data.rating,
      favorite: body.data.favorite,
      updatedAt: new Date().toISOString()
    });

    if (!asset) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return { asset };
  });

  app.patch("/api/assets/batch/ratings", async (request, reply) => {
    const body = BatchRatingBody.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = updateAssetRatingsBatch(db, {
      assetIds: body.data.assetIds,
      rating: body.data.rating,
      favorite: body.data.favorite,
      updatedAt: new Date().toISOString()
    });

    if (!result) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return result;
  });

  app.post("/api/assets/batch/tags", async (request, reply) => {
    const body = BatchTagsBody.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const result = updateAssetTagsBatch(db, {
        assetIds: body.data.assetIds,
        tags: body.data.tags,
        mode: body.data.mode
      });

      if (!result) {
        return reply.code(404).send({ error: "asset_not_indexed" });
      }

      return result;
    } catch (error) {
      if (error instanceof InvalidTagError) {
        return reply.code(400).send({ error: "invalid_tag" });
      }

      throw error;
    }
  });

  app.get("/api/assets/:assetId/tag-suggestions", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const query = AssetTagSuggestionQuery.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = suggestAssetTags(db, params.data.assetId, query.data.limit);

    if (!result) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return result;
  });

  app.post("/api/assets/:assetId/ai-tag-suggestions", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const query = AssetTagSuggestionQuery.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const file = await resolveAssetFile(db, params.data.assetId);

      if (!file) {
        return reply.code(404).send({ error: "asset_not_found" });
      }

      return await suggestAiAssetTags({
        db,
        config,
        file,
        limit: query.data.limit
      });
    } catch (error) {
      if (error instanceof AiTaggingDisabledError) {
        return reply.code(503).send({ error: "ai_disabled" });
      }

      if (error instanceof AiTaggingUnsupportedAssetError) {
        return reply.code(415).send({ error: "ai_not_supported" });
      }

      if (error instanceof AiTaggingProviderError) {
        return reply.code(502).send({ error: "ai_provider_failed" });
      }

      return reply.code(mediaErrorStatus(error)).send({ error: "asset_not_found" });
    }
  });

  app.get("/api/assets/:assetId/tags", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    if (!getAsset(db, params.data.assetId)) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return {
      tags: getAssetTags(db, params.data.assetId)
    };
  });

  app.put("/api/assets/:assetId/tags", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const body = TagsBody.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const tags = setAssetTags(db, params.data.assetId, body.data.tags);

      if (!tags) {
        return reply.code(404).send({ error: "asset_not_indexed" });
      }

      return { tags };
    } catch (error) {
      if (error instanceof InvalidTagError) {
        return reply.code(400).send({ error: "invalid_tag" });
      }

      throw error;
    }
  });

  app.get("/api/tags/suggest", async (request, reply) => {
    const query = TagSuggestionQuery.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    return {
      tags: suggestTags(db, {
        query: query.data.q,
        limit: query.data.limit
      })
    };
  });

  app.post("/api/admin/scan", async (_request, reply) => {
    const job = scanner.startScan();
    return reply.code(202).send({
      status: job.status,
      jobId: job.id
    });
  });

  app.get("/api/admin/jobs", async () => ({
    jobs: scanner.listJobs().map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      error: job.error,
      result: parseJobResult(job.result),
      createdAt: job.created_at,
      updatedAt: job.updated_at
    }))
  }));

  app.get("/api/admin/watch", async () =>
    watcher?.status() ?? {
      enabled: false,
      running: false,
      debounceMs: config.watchDebounceMs,
      watchedDirectories: 0,
      lastEventAt: null,
      lastScanJobId: null,
      lastError: null
    }
  );

  app.get("/api/admin/ai", async () => ({
    enabled: config.aiProvider !== "disabled",
    provider: config.aiProvider,
    model: config.aiProvider === "ollama" ? config.ollamaVisionModel : null
  }));
}

async function streamAssetFile(
  request: FastifyRequest,
  reply: FastifyReply,
  db: AetherDatabase,
  disposition: "inline" | "attachment"
) {
  const params = AssetParams.safeParse(request.params);

  if (!params.success) {
    return reply.code(400).send({ error: "invalid_request" });
  }

  try {
    const file = await resolveAssetFile(db, params.data.assetId);

    if (!file) {
      return reply.code(404).send({ error: "asset_not_found" });
    }

    const streamHeaders = {
      ifModifiedSince: normalizedHeader(request.headers["if-modified-since"]),
      ifNoneMatch: normalizedHeader(request.headers["if-none-match"]),
      ifRange: normalizedHeader(request.headers["if-range"]),
      range: normalizedHeader(request.headers.range)
    };

    if (isAssetNotModified(file, streamHeaders)) {
      return sendAssetNotModified({ reply, file, disposition });
    }

    const range =
      request.method === "GET" ? requestedByteRange(file, streamHeaders) : null;

    if (range === "invalid") {
      return sendRangeNotSatisfiable(reply, file.sizeBytes);
    }

    return sendAssetStream({
      reply,
      file,
      range,
      disposition,
      method: request.method
    });
  } catch (error) {
    return reply.code(mediaErrorStatus(error)).send({ error: "asset_not_found" });
  }
}

function normalizedHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseJobResult(result: string | null): unknown {
  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function derivativeErrorStatus(error: unknown): number {
  const mediaStatus = mediaErrorStatus(error);
  return mediaStatus === 403 ? 403 : 422;
}
