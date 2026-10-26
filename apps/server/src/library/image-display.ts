import { lstat, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { decodeHeifImage, inspectHeifImage } from "./heif-decoder.js";
import {
  ImageDerivativeError,
  imageCacheDirectory,
  imageCacheFileExists,
  imageSourceKey,
  publishImageCacheFile,
  recordImageDerivative,
  snapshotImageSource,
  temporaryImagePath,
  verifyImageSource
} from "./image-cache.js";
import { stableId } from "./ids.js";
import type { ResolvedAssetFile } from "./media-serving.js";
import { requiresImageDisplay } from "./media-types.js";
import { updateAssetDimensions } from "./repository.js";
import { withVideoProcessingSlot } from "./video-processing.js";

export { ImageDerivativeError } from "./image-cache.js";
export interface ImageDisplayFile {
  path: string;
  contentType: "image/png";
  width: number;
  height: number;
}
export const IMAGE_DISPLAY_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

export async function requireImageDisplayOutput(
  filePath: string
): Promise<void> {
  const info = await lstat(filePath);
  if (info.size > IMAGE_DISPLAY_MAX_OUTPUT_BYTES)
    throw new ImageDerivativeError("heic_limit_exceeded", 422);
  if (!info.isFile() || info.size <= 0)
    throw new ImageDerivativeError("heic_decode_failed");
}
const jobsByDatabase = new WeakMap<
  AetherDatabase,
  Map<string, Promise<ImageDisplayFile>>
>();
let pendingJobs = 0;
let processingTail: Promise<unknown> = Promise.resolve();

function withHeifProcessingSlot<T>(task: () => Promise<T>): Promise<T> {
  const job = processingTail.then(() => withVideoProcessingSlot(task));
  processingTail = job.catch(() => undefined);
  return job;
}

export async function ensureImageDisplay({
  db,
  config,
  file
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
}): Promise<ImageDisplayFile> {
  if (file.asset.mediaType !== "image" || !requiresImageDisplay(file.asset))
    throw new ImageDerivativeError("image_display_not_supported");
  const directory = await imageCacheDirectory(
    config,
    "display-images",
    file.asset.id
  );
  const key = imageSourceKey(file);
  const destination = path.join(directory, `${key}.png`);
  await verifyImageSource(db, file);
  if (await imageCacheFileExists(destination)) {
    const metadata = await sharp(destination).metadata();
    return {
      path: destination,
      contentType: "image/png",
      width: metadata.width,
      height: metadata.height
    };
  }
  let jobs = jobsByDatabase.get(db);
  if (!jobs) {
    jobs = new Map();
    jobsByDatabase.set(db, jobs);
  }
  const existing = jobs.get(destination);
  if (existing) return existing;
  if (pendingJobs >= 32) throw new ImageDerivativeError("processing_busy", 503);
  pendingJobs += 1;
  const temporaryPath = temporaryImagePath(destination);
  const job = withHeifProcessingSlot(async () => {
    let scratch: string | undefined;
    let published = false;
    try {
      await verifyImageSource(db, file);
      scratch = await mkdtemp(path.join(directory, ".decode-"));
      const snapshot = path.join(scratch, "source.heic");
      await snapshotImageSource(db, file, snapshot);
      const info = await inspectHeifImage(snapshot);
      const decoded = await decodeHeifImage(snapshot, scratch, info);
      // libheif applies HEIF transforms and normalizes EXIF orientation. Do not rotate again.
      await sharp(decoded, { limitInputPixels: 64_000_000 })
        .keepIccProfile()
        .toColourspace(info.bitDepth > 8 ? "rgb16" : "srgb")
        .timeout({ seconds: 30 })
        .png()
        .toFile(temporaryPath);
      await requireImageDisplayOutput(temporaryPath);
      await imageCacheDirectory(config, "display-images", file.asset.id);
      await publishImageCacheFile(db, file, temporaryPath, destination);
      published = true;
      updateAssetDimensions(db, file.asset.id, info.width, info.height);
      await recordImageDerivative(db, file, {
        id: stableId("derivative", file.asset.id, "display-image", key),
        assetId: file.asset.id,
        kind: "display-image",
        width: info.width,
        height: info.height,
        path: destination,
        sourceMtimeMs: file.mtimeMs,
        status: "ready",
        error: null,
        createdAt: new Date().toISOString()
      });
      return {
        path: destination,
        contentType: "image/png" as const,
        width: info.width,
        height: info.height
      };
    } catch (error) {
      if (published) await rm(destination, { force: true });
      if (error instanceof ImageDerivativeError) throw error;
      throw new ImageDerivativeError("heic_decode_failed");
    } finally {
      await rm(temporaryPath, { force: true });
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  }).finally(() => {
    jobs.delete(destination);
    pendingJobs -= 1;
  });
  jobs.set(destination, job);
  return job;
}
