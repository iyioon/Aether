import { realpath } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { ensureImageDisplay, ImageDerivativeError } from "./image-display.js";
import { imageSourceKey, openImageCacheFile } from "./image-cache.js";
import {
  isAssetNotModified,
  mediaErrorStatus,
  requestedByteRange,
  resolveAssetFile,
  sendAssetNotModified,
  sendAssetStream,
  sendRangeNotSatisfiable,
  type ResolvedAssetFile
} from "./media-serving.js";
import { AssetParams } from "./route-schemas.js";

export function registerImageDisplayRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: AetherDatabase
): void {
  app.route({
    method: ["GET", "HEAD"],
    url: "/api/assets/:assetId/display",
    handler: async (request, reply) => {
      const params = AssetParams.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const source = await resolveAssetFile(db, params.data.assetId);
        if (!source) return reply.code(404).send({ error: "asset_not_found" });
        const display = await ensureImageDisplay({ db, config, file: source });
        const { handle } = await openImageCacheFile(display.path);
        const info = await handle.stat();
        await handle.close();
        const file: ResolvedAssetFile = {
          ...source,
          sourcePath: await realpath(display.path),
          sizeBytes: info.size,
          mtimeMs: Math.trunc(info.mtimeMs),
          device: info.dev,
          inode: info.ino,
          asset: {
            ...source.asset,
            id: `${source.asset.id}:${imageSourceKey(source)}`,
            name: `${source.asset.name.replace(/\.(heic|heif)$/i, "")}.png`,
            mimeType: display.contentType
          }
        };
        const headers = {
          ifNoneMatch: header(request.headers["if-none-match"]),
          ifModifiedSince: header(request.headers["if-modified-since"]),
          ifRange: header(request.headers["if-range"]),
          range: header(request.headers.range)
        };
        if (isAssetNotModified(file, headers))
          return await sendAssetNotModified({
            reply,
            file,
            disposition: "inline"
          });
        const range =
          request.method === "GET" ? requestedByteRange(file, headers) : null;
        if (range === "invalid")
          return sendRangeNotSatisfiable(reply, file.sizeBytes);
        return await sendAssetStream({
          reply,
          file,
          range,
          disposition: "inline",
          method: request.method
        });
      } catch (error) {
        reply.header("cache-control", "no-store").type("application/json");
        if (error instanceof ImageDerivativeError)
          return reply.code(error.status).send({ error: error.code });
        return reply
          .code(mediaErrorStatus(error))
          .send({ error: "asset_not_found" });
      }
    }
  });
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
