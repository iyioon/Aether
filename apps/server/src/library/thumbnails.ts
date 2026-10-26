import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { ensureImageDisplay } from "./image-display.js";
import {
  ImageDerivativeError,
  imageCacheDirectory,
  imageCacheFileExists,
  imageSourceKey,
  openImageCacheFile,
  publishImageCacheFile,
  recordImageDerivative,
  temporaryImagePath,
  verifyImageSource
} from "./image-cache.js";
import { stableId } from "./ids.js";
import type { ResolvedAssetFile } from "./media-serving.js";
import { requiresImageDisplay } from "./media-types.js";
import { updateAssetDimensions } from "./repository.js";
import { withVideoProcessingSlot } from "./video-processing.js";

export interface ThumbnailFile {
  path: string;
  contentType: string;
}
const pendingThumbnailJobsByDatabase = new WeakMap<
  AetherDatabase,
  Map<string, Promise<ThumbnailFile>>
>();
let pendingJobs = 0;

export async function ensureImageThumbnail({
  db,
  config,
  file,
  size
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  size: number;
}): Promise<ThumbnailFile> {
  if (file.asset.mediaType !== "image")
    throw new UnsupportedThumbnailError("Only image thumbnails are available.");
  if (!Number.isInteger(size) || size < 1 || size > 2560)
    throw new ImageDerivativeError("invalid_thumbnail_size", 400);
  const directory = await imageCacheDirectory(
    config,
    "thumbnails",
    file.asset.id
  );
  const key = imageSourceKey(file);
  const destination = path.join(directory, `${key}-${size}.webp`);
  await verifyImageSource(db, file);
  if (await imageCacheFileExists(destination))
    return { path: destination, contentType: "image/webp" };
  let jobs = pendingThumbnailJobsByDatabase.get(db);
  if (!jobs) {
    jobs = new Map();
    pendingThumbnailJobsByDatabase.set(db, jobs);
  }
  const pending = jobs.get(destination);
  if (pending) return pending;
  if (pendingJobs >= 32) throw new ImageDerivativeError("processing_busy", 503);
  pendingJobs += 1;
  const temporaryPath = temporaryImagePath(destination);
  // Resolve HEIC before taking a processing slot: display generation uses the same bounded pool.
  const job = (async () => {
    const input = requiresImageDisplay(file.asset)
      ? (await ensureImageDisplay({ db, config, file })).path
      : file.sourcePath;
    return withVideoProcessingSlot(async () => {
      let published = false;
      try {
        await verifyImageSource(db, file);
        const processor = sharp(input, {
          failOn: "none",
          limitInputPixels: 268_402_689
        }).rotate();
        const metadata = await processor.metadata();
        await processor
          .resize({
            width: size,
            height: size,
            fit: "inside",
            withoutEnlargement: true
          })
          .webp({ quality: 82, effort: 4 })
          .timeout({ seconds: 30 })
          .toFile(temporaryPath);
        await imageCacheDirectory(config, "thumbnails", file.asset.id);
        await publishImageCacheFile(db, file, temporaryPath, destination);
        published = true;
        updateAssetDimensions(
          db,
          file.asset.id,
          metadata.autoOrient.width,
          metadata.autoOrient.height
        );
        await recordImageDerivative(db, file, {
          id: stableId(
            "derivative",
            file.asset.id,
            "thumbnail",
            String(size),
            key
          ),
          assetId: file.asset.id,
          kind: "thumbnail",
          width: size,
          height: size,
          path: destination,
          sourceMtimeMs: file.mtimeMs,
          status: "ready",
          error: null,
          createdAt: new Date().toISOString()
        });
        return { path: destination, contentType: "image/webp" };
      } catch (error) {
        if (published) await rm(destination, { force: true });
        if (error instanceof ImageDerivativeError) throw error;
        throw new ImageDerivativeError("thumbnail_generation_failed");
      } finally {
        await rm(temporaryPath, { force: true });
      }
    });
  })().finally(() => {
    jobs.delete(destination);
    pendingJobs -= 1;
  });
  jobs.set(destination, job);
  return job;
}

export async function sendThumbnail(
  reply: FastifyReply,
  thumbnail: ThumbnailFile
): Promise<FastifyReply> {
  const { handle, size } = await openImageCacheFile(thumbnail.path);
  const info = await handle.stat();
  const modified = new Date(Math.floor(info.mtimeMs / 1000) * 1000);
  const etag = `"${createHash("sha256").update(`${thumbnail.path}:${size}:${info.mtimeMs}`).digest("hex").slice(0, 32)}"`;
  reply.header("cache-control", "private, no-cache");
  reply.header("etag", etag);
  reply.header("last-modified", modified.toUTCString());
  const ifNoneMatch = reply.request.headers["if-none-match"];
  const since = reply.request.headers["if-modified-since"];
  if (
    (ifNoneMatch &&
      ifNoneMatch
        .split(",")
        .some(
          (candidate) =>
            candidate.trim().replace(/^W\//, "") === etag ||
            candidate.trim() === "*"
        )) ||
    (!ifNoneMatch && since && Date.parse(since) >= modified.getTime())
  ) {
    await handle.close();
    return reply.code(304).send();
  }
  reply.header("content-length", String(size));
  reply.type(thumbnail.contentType);
  if (reply.request.method === "HEAD") {
    await handle.close();
    return reply.send();
  }
  return reply.send(handle.createReadStream());
}

export class UnsupportedThumbnailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedThumbnailError";
  }
}
