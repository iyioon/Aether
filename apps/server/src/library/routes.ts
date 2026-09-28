import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import {
  AiTaggingDisabledError,
  AiTaggingProviderError,
  AiTaggingUnsupportedAssetError,
  suggestAiAssetTags
} from "./ai-tag-suggestions.js";
import {
  clearAssetManualAdjustment,
  folderIdFor,
  getAsset,
  getAssetTags,
  InvalidTagError,
  listAssets,
  listFolders,
  resetAssetComparisons,
  setAssetTags,
  suggestTags,
  updateAssetScore,
  updateAssetScoresBatch,
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
import {
  AssetListQuery,
  AssetParams,
  AssetTagSuggestionQuery,
  BatchScoreBody,
  BatchTagsBody,
  FolderParams,
  ScoreBody,
  TagSuggestionQuery,
  TagsBody,
  ThumbnailQuery,
  VideoPreviewQuery
} from "./route-schemas.js";
import { registerAdminRoutes } from "./routes-admin.js";
import { registerComparisonRoutes } from "./routes-comparisons.js";

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
    const params = FolderParams.safeParse(request.params);
    const query = AssetListQuery.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const sort = normalizeAssetSort(query.data.sort, query.data.order);
    const result = listAssets(db, {
      folderId: params.data.folderId,
      offset: query.data.offset,
      limit: query.data.limit,
      sort: sort.mode,
      sortDirection: sort.direction,
      type: query.data.type,
      recursive: query.data.recursive,
      search: query.data.search,
      tags: query.data.tag,
      scoreFilter: query.data.score
    });

    if (!result) {
      return reply.code(404).send({ error: "folder_not_found" });
    }

    return {
      folderId: params.data.folderId,
      ...result,
      sort: sort.mode,
      order: sort.direction,
      type: query.data.type,
      recursive: query.data.recursive,
      search: query.data.search,
      tags: query.data.tag,
      score: query.data.score
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

  registerComparisonRoutes(app, db);

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

  app.patch("/api/assets/:assetId/score", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const body = ScoreBody.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const asset = updateAssetScore(db, {
      assetId: params.data.assetId,
      score: body.data.score,
      favorite: body.data.favorite,
      updatedAt: new Date().toISOString()
    });

    if (!asset) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return { asset };
  });

  app.delete(
    "/api/assets/:assetId/score/manual-adjustment",
    async (request, reply) => {
      const params = AssetParams.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }

      const asset = clearAssetManualAdjustment(
        db,
        params.data.assetId,
        new Date().toISOString()
      );

      if (!asset) {
        return reply.code(404).send({ error: "asset_not_indexed" });
      }

      return { asset };
    }
  );

  app.delete("/api/assets/:assetId/comparisons", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = resetAssetComparisons(
      db,
      params.data.assetId,
      new Date().toISOString()
    );

    if (!result) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return {
      asset: getAsset(db, params.data.assetId),
      removedComparisons: result.removedComparisonCount
    };
  });

  app.patch("/api/assets/batch/scores", async (request, reply) => {
    const body = BatchScoreBody.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = updateAssetScoresBatch(db, {
      assetIds: body.data.assetIds,
      score: body.data.score,
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

  app.post(
    "/api/assets/:assetId/ai-tag-suggestions",
    async (request, reply) => {
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

        return reply
          .code(mediaErrorStatus(error))
          .send({ error: "asset_not_found" });
      }
    }
  );

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

  registerAdminRoutes(app, config, db, scanner, watcher);
}

function normalizeAssetSort(
  mode: "date" | "filename" | "score" | "random" | "newest" | "oldest",
  direction: "desc" | "asc" | undefined
): {
  mode: "date" | "filename" | "score" | "random";
  direction: "desc" | "asc";
} {
  if (mode === "newest") {
    return { mode: "date", direction: "desc" };
  }

  if (mode === "oldest") {
    return { mode: "date", direction: "asc" };
  }

  return { mode, direction: direction ?? defaultAssetSortDirection(mode) };
}

function defaultAssetSortDirection(
  mode: "date" | "filename" | "score" | "random"
): "desc" | "asc" {
  return mode === "filename" ? "asc" : "desc";
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
    return reply
      .code(mediaErrorStatus(error))
      .send({ error: "asset_not_found" });
  }
}

function normalizedHeader(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function derivativeErrorStatus(error: unknown): number {
  const mediaStatus = mediaErrorStatus(error);
  return mediaStatus === 403 ? 403 : 422;
}
