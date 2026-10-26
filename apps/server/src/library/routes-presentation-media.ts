import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { AssetParams } from "./route-schemas.js";
import {
  assetEntityTag,
  assetLastModifiedHeader,
  isAssetNotModified,
  mediaErrorStatus,
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
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const file = await resolveAssetFile(db, params.data.assetId);
        if (!file) return reply.code(404).send({ error: "asset_not_found" });
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
            : query.data.v
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
          `${query.data.v}-${query.data.size}`
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
          `${query.data.v}-${params.data.index}`
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
  key: string
): Promise<FastifyReply> {
  const handle = await open(
    media.path,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  const info = await handle.stat();
  if (
    !info.isFile() ||
    (media.path === source.sourcePath &&
      (info.size !== source.sizeBytes ||
        Math.trunc(info.mtimeMs) !== source.mtimeMs))
  ) {
    await handle.close();
    throw new StalePresentationRenditionError();
  }
  const file: ResolvedAssetFile = {
    ...source,
    sourcePath: media.path,
    sizeBytes: info.size,
    mtimeMs: Math.trunc(info.mtimeMs),
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
  reply.header("cache-control", "private, max-age=31536000, immutable");
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
    return sendRangeNotSatisfiable(reply.type("application/json"), info.size);
  }
  if (range) {
    reply
      .code(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${info.size}`)
      .header("content-length", String(range.end - range.start + 1));
  } else reply.header("content-length", String(info.size));
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
function mediaFailure(reply: FastifyReply, error: unknown): FastifyReply {
  reply.header("cache-control", "no-store").type("application/json");
  if (error instanceof StalePresentationRenditionError)
    return reply
      .code(409)
      .send({ error: "stale_rendition", metadataRefresh: true });
  if (error instanceof PresentationMediaError)
    return reply.code(error.status).send({ error: error.code });
  const status = mediaErrorStatus(error);
  return reply.code(status === 403 ? 403 : 415).send({
    error: status === 403 ? "asset_forbidden" : "media_decode_failed"
  });
}
function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
