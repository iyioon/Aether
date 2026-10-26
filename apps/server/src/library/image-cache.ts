import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { chmod, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import {
  openAssetFile,
  resolveAssetFile,
  type ResolvedAssetFile
} from "./media-serving.js";
import { stableId } from "./ids.js";
import { replaceSourceDerivative } from "./repository-derivatives.js";
import type { UpsertDerivativeInput } from "./repository-types.js";
import { openPrivateCacheFile } from "../security/private-cache-file.js";

export class ImageDerivativeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 415
  ) {
    super(code);
    this.name = "ImageDerivativeError";
  }
}

export function imageSourceKey(file: ResolvedAssetFile): string {
  return stableId(
    "image-v1",
    file.asset.id,
    String(file.mtimeMs),
    String(file.sizeBytes),
    String(file.device ?? ""),
    String(file.inode ?? "")
  );
}

export async function verifyImageSource(
  db: AetherDatabase,
  file: ResolvedAssetFile
): Promise<void> {
  const current = await resolveAssetFile(db, file.asset.id);
  if (
    !current ||
    current.sourcePath !== file.sourcePath ||
    current.mtimeMs !== file.mtimeMs ||
    current.sizeBytes !== file.sizeBytes ||
    (file.device !== undefined && current.device !== file.device) ||
    (file.inode !== undefined && current.inode !== file.inode)
  ) {
    throw new ImageDerivativeError("stale_image_source", 409);
  }
}

export async function snapshotImageSource(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  destination: string
): Promise<void> {
  if (file.sizeBytes <= 0 || file.sizeBytes > 256 * 1024 * 1024)
    throw new ImageDerivativeError("heic_limit_exceeded", 422);
  const handle = await openAssetFile(file);
  try {
    await pipeline(
      handle.createReadStream({
        autoClose: false,
        start: 0,
        end: file.sizeBytes - 1
      }),
      createWriteStream(destination, { flags: "wx", mode: 0o600 })
    );
    const source = await handle.stat();
    const copy = await lstat(destination);
    if (
      source.size !== file.sizeBytes ||
      Math.trunc(source.mtimeMs) !== file.mtimeMs ||
      copy.size !== file.sizeBytes
    )
      throw new ImageDerivativeError("stale_image_source", 409);
    await verifyImageSource(db, file);
  } finally {
    await handle.close();
  }
}

export async function imageCacheDirectory(
  config: AppConfig,
  kind: "thumbnails" | "display-images",
  assetId: string
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(assetId))
    throw new ImageDerivativeError("invalid_asset", 400);
  let directory = config.cacheDir;
  for (const segment of [null, kind, assetId]) {
    if (segment) directory = path.join(directory, segment);
    await mkdir(directory, { mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      }
    );
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ImageDerivativeError("unsafe_cache", 500);
    await chmod(directory, 0o700);
  }
  return directory;
}

export async function openImageCacheFile(filePath: string) {
  // Image/poster files have the fixed cache/kind/asset/file layout.
  const cacheDir = path.dirname(path.dirname(path.dirname(filePath)));
  const handle = await openPrivateCacheFile(filePath, cacheDir);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size <= 0 ||
      info.size > 128 * 1024 * 1024
    )
      throw new ImageDerivativeError("unsafe_cache", 500);
    return { handle, size: info.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function recordImageDerivative(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  input: UpsertDerivativeInput
): Promise<void> {
  const obsolete = replaceSourceDerivative(db, input, imageSourceKey(file));
  const directory = path.dirname(input.path);
  for (const entry of obsolete) {
    if (path.dirname(entry) !== directory) continue;
    await rm(entry, { force: true });
  }
}

export async function imageCacheFileExists(filePath: string): Promise<boolean> {
  try {
    const { handle } = await openImageCacheFile(filePath);
    await handle.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function publishImageCacheFile(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  temporaryPath: string,
  destination: string
): Promise<void> {
  const { handle } = await openImageCacheFile(temporaryPath);
  await handle.close();
  await chmod(temporaryPath, 0o600);
  await verifyImageSource(db, file);
  await rename(temporaryPath, destination);
  try {
    await verifyImageSource(db, file);
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

export function temporaryImagePath(destination: string): string {
  return `${destination}.${randomUUID()}.tmp`;
}
