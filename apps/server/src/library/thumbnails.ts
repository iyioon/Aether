import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
import type { ResolvedAssetFile } from "./media-serving.js";
import { getDerivative, updateAssetDimensions, upsertDerivative } from "./repository.js";

export interface ThumbnailFile {
  path: string;
  contentType: string;
}

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
  if (file.asset.mediaType !== "image") {
    throw new UnsupportedThumbnailError("Only image thumbnails are available.");
  }

  const thumbnailPath = thumbnailPathFor(config.cacheDir, file.asset.id, file.mtimeMs, size);
  const derivativeId = stableId(
    "derivative",
    file.asset.id,
    "thumbnail",
    String(size),
    String(file.mtimeMs)
  );
  const existing = getDerivative(db, derivativeId);

  if (existing?.status === "ready" && existsSync(thumbnailPath)) {
    return {
      path: thumbnailPath,
      contentType: "image/webp"
    };
  }

  await mkdir(path.dirname(thumbnailPath), { recursive: true });
  const temporaryPath = `${thumbnailPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    const processor = sharp(file.sourcePath, {
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
      .webp({
        quality: 82,
        effort: 4
      })
      .toFile(temporaryPath);

    await rename(temporaryPath, thumbnailPath);
    updateAssetDimensions(
      db,
      file.asset.id,
      metadata.width ?? null,
      metadata.height ?? null
    );
    upsertDerivative(db, {
      id: derivativeId,
      assetId: file.asset.id,
      kind: "thumbnail",
      width: size,
      height: size,
      path: thumbnailPath,
      sourceMtimeMs: file.mtimeMs,
      status: "ready",
      error: null,
      createdAt: new Date().toISOString()
    });

    return {
      path: thumbnailPath,
      contentType: "image/webp"
    };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    upsertDerivative(db, {
      id: derivativeId,
      assetId: file.asset.id,
      kind: "thumbnail",
      width: size,
      height: size,
      path: thumbnailPath,
      sourceMtimeMs: file.mtimeMs,
      status: "failed",
      error: errorMessage(error),
      createdAt: new Date().toISOString()
    });
    throw error;
  }
}

export async function sendThumbnail(
  reply: FastifyReply,
  thumbnail: ThumbnailFile
): Promise<FastifyReply> {
  const fileStat = await stat(thumbnail.path);
  reply.header("cache-control", "private, max-age=86400");
  reply.header("content-length", String(fileStat.size));
  reply.type(thumbnail.contentType);
  return reply.send(createReadStream(thumbnail.path));
}

export class UnsupportedThumbnailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedThumbnailError";
  }
}

function thumbnailPathFor(
  cacheDir: string,
  assetId: string,
  mtimeMs: number,
  size: number
): string {
  return path.join(cacheDir, "thumbnails", assetId, `${mtimeMs}-${size}.webp`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Thumbnail generation failed.";
}
