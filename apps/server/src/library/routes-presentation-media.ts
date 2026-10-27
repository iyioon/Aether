import { openPrivateCacheFile } from "../security/private-cache-file.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { AssetParams } from "./route-schemas.js";
import {
  assetEntityTag,
  assetFileStatMetadata,
  assetLastModifiedHeader,
  isAssetNotModified,
  mediaErrorStatus,
  openAssetFile,
  requestedByteRange,
  resolveAssetFile,
  sendRangeNotSatisfiable,
  type ResolvedAssetFile
} from "./media-serving.js";
import {
  getPresentationMediaCapabilities,
  PresentationMediaError,
  StalePresentationRenditionError
} from "./presentation-media.js";
import {
  ensurePresentationAnimation,
  ensurePresentationAnimationPoster
} from "./presentation-animation.js";
import {
  ensurePresentationPoster,
  ensurePresentationVideo,
  type PresentationFile
} from "./presentation-video.js";

const VersionQuery = z.object({ v: z.string().regex(/^[a-f0-9]{32}$/) });
const PlaybackQuery = VersionQuery.extend({
  variant: z.enum(["full", "highlight", "bounce"]).default("full"),
  codec: z.enum(["hevc", "h264"]).optional()
}).refine((query) => !query.codec || query.variant === "bounce");
const PosterQuery = VersionQuery.extend({
  variant: z.enum(["full", "highlight"]).default("full"),
  size: z.coerce.number().int().min(160).max(1280).default(640)
});
const AtlasParams = AssetParams.extend({
  index: z.coerce.number().int().min(0).max(599)
});

export function registerPresentationMediaRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: AetherDatabase
): void {
  app.get("/api/assets/:assetId/presentation-media", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ error: "invalid_request" });
    reply.header("cache-control", "no-store");
    try {
      const file = await resolveAssetFile(db, params.data.assetId);
      if (!file) return reply.code(404).send({ error: "asset_not_found" });
      return await getPresentationMediaCapabilities({ db, config, file });
    } catch (error) {
      return mediaFailure(reply, error);
    }
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/assets/:assetId/playback",
    handler: async (request, reply) => {
      const params = AssetParams.safeParse(request.params);
      const query = PlaybackQuery.safeParse(request.query);
      if (!params.success || !query.success)
        return mediaFailure(
          reply,
          new PresentationMediaError("invalid_request", 400)
        );
      try {
        const file = await resolveAssetFile(db, params.data.assetId);
        if (!file)
          return mediaFailure(
            reply,
            new PresentationMediaError("asset_not_found", 404)
          );
        const media = await ensurePresentationVideo({
          db,
          config,
          file,
          variant: query.data.variant,
          key: query.data.v,
          codec: query.data.codec
        });
        return await sendPresentationFile(
          request,
          reply,
          file,
          media,
          query.data.variant === "bounce"
            ? `${query.data.v}-${query.data.codec ?? "hevc"}`
            : query.data.v,
          config.cacheDir
        );
      } catch (error) {
        return mediaFailure(reply, error);
      }
    }
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/assets/:assetId/presentation-poster",
    handler: async (request, reply) => {
      const params = AssetParams.safeParse(request.params);
      const query = PosterQuery.safeParse(request.query);
      if (!params.success || !query.success)
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const file = await resolveAssetFile(db, params.data.assetId);
        if (!file) return reply.code(404).send({ error: "asset_not_found" });
        const capabilities = await getPresentationMediaCapabilities({
          db,
          config,
          file
        });
        const generatePoster =
          capabilities.kind === "animation"
            ? ensurePresentationAnimationPoster
            : ensurePresentationPoster;
        const media = await generatePoster({
          db,
          config,
          file,
          variant: query.data.variant,
          key: query.data.v,
          size: query.data.size
        });
        return await sendPresentationFile(
          request,
          reply,
          file,
          media,
          `${query.data.v}-${query.data.size}`,
          config.cacheDir
        );
      } catch (error) {
        return mediaFailure(reply, error);
      }
    }
  });

  app.get("/api/assets/:assetId/animation", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const query = VersionQuery.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ error: "invalid_request" });
    reply.header("cache-control", "no-store");
    try {
      const file = await resolveAssetFile(db, params.data.assetId);
      if (!file) return reply.code(404).send({ error: "asset_not_found" });
      return (
        await ensurePresentationAnimation({
          db,
          config,
          file,
          key: query.data.v
        })
      ).manifest;
    } catch (error) {
      return mediaFailure(reply, error);
    }
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/assets/:assetId/animation/atlases/:index",
    handler: async (request, reply) => {
      const params = AtlasParams.safeParse(request.params);
      const query = VersionQuery.safeParse(request.query);
      if (!params.success || !query.success)
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const file = await resolveAssetFile(db, params.data.assetId);
        if (!file) return reply.code(404).send({ error: "asset_not_found" });
        const animation = await ensurePresentationAnimation({
          db,
          config,
          file,
          key: query.data.v
        });
        const atlasPath = animation.atlasPaths[params.data.index];
        if (!atlasPath)
          return reply.code(404).send({ error: "atlas_not_found" });
        return await sendPresentationFile(
          request,
          reply,
          file,
          { path: atlasPath, contentType: "image/png" },
          `${query.data.v}-${params.data.index}`,
          config.cacheDir
        );
      } catch (error) {
        return mediaFailure(reply, error);
      }
    }
  });
}

async function sendPresentationFile(
  request: FastifyRequest,
  reply: FastifyReply,
  source: ResolvedAssetFile,
  media: PresentationFile,
  key: string,
  cacheDir: string
): Promise<FastifyReply> {
  const handle =
    media.path === source.sourcePath
      ? await openAssetFile(source)
      : await openPrivateCacheFile(media.path, cacheDir);
  const metadata = await handle
    .stat({ bigint: true })
    .then((info) => {
      const values = assetFileStatMetadata(info);
      if (!values) throw new PresentationMediaError("unsafe_cache", 500);
      return values;
    })
    .catch(async (error: unknown) => {
      await handle.close();
      throw error;
    });
  const file: ResolvedAssetFile = {
    ...source,
    ...metadata,
    sourcePath: media.path,
    asset: {
      ...source.asset,
      id: `${source.asset.id}:${key}`,
      mimeType: media.contentType
    }
  };
  const headers = {
    ifNoneMatch: header(request.headers["if-none-match"]),
    ifModifiedSince: header(request.headers["if-modified-since"]),
    ifRange: header(request.headers["if-range"]),
    range: header(request.headers.range)
  };
  reply.header("cache-control", "private, no-cache");
  reply.header("accept-ranges", "bytes");
  reply.header("etag", assetEntityTag(file));
  reply.header("last-modified", assetLastModifiedHeader(file));
  reply.type(media.contentType);
  if (isAssetNotModified(file, headers)) {
    await handle.close();
    return reply.code(304).send();
  }
  const range = requestedByteRange(file, headers);
  if (range === "invalid") {
    await handle.close();
    return sendRangeNotSatisfiable(
      reply.type("application/json"),
      file.sizeBytes
    );
  }
  if (range) {
    reply
      .code(206)
      .header(
        "content-range",
        `bytes ${range.start}-${range.end}/${file.sizeBytes}`
      )
      .header("content-length", String(range.end - range.start + 1));
  } else reply.header("content-length", String(file.sizeBytes));
  if (request.method === "HEAD") {
    await handle.close();
    return reply.send();
  }
  return reply.send(
    handle.createReadStream(
      range ? { start: range.start, end: range.end } : undefined
    )
  );
}
const SAFE_MEDIA_ERROR_CODES = new Set([
  "animation_frame_mismatch",
  "animation_not_supported",
  "asset_not_found",
  "asset_forbidden",
  "bounce_duration_exceeded",
  "bounce_source_not_supported",
  "bounce_timing_not_supported",
  "bounce_hevc_encoder_unavailable",
  "bounce_h264_encoder_unavailable",
  "media_tool_unavailable",
  "highlight_duration_exceeded",
  "incomplete_rendition",
  "invalid_asset",
  "invalid_highlight",
  "invalid_request",
  "media_decode_failed",
  "media_duration_unavailable",
  "playback_not_supported",
  "poster_not_supported",
  "presentation_limit_exceeded",
  "presentation_processing_cancelled",
  "presentation_processing_failed",
  "processing_busy",
  "processing_timeout",
  "stale_rendition",
  "unsafe_cache"
]);

function mediaFailure(reply: FastifyReply, error: unknown): FastifyReply {
  reply.header("cache-control", "no-store").type("application/json");
  let status = mediaErrorStatus(error) === 403 ? 403 : 415;
  let code = status === 403 ? "asset_forbidden" : "media_decode_failed";
  if (error instanceof PresentationMediaError) {
    status = error.status;
    code = SAFE_MEDIA_ERROR_CODES.has(error.code)
      ? error.code
      : "media_decode_failed";
  }
  const body =
    error instanceof StalePresentationRenditionError
      ? { error: code, metadataRefresh: true }
      : { error: code };
  return reply
    .header("x-aether-media-error", code)
    .code(status)
    .send(reply.request.method === "HEAD" ? undefined : body);
}
function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
