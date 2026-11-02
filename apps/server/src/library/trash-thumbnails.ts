import path from "node:path";
import { open, rmdir, unlink } from "node:fs/promises";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import {
  ensurePrivateCacheDirectory,
  openPrivateCacheFile
} from "../security/private-cache-file.js";
import { resolveAssetFile } from "./media-serving.js";
import { ensureImageThumbnail } from "./thumbnails.js";
import { ensureVideoPoster } from "./video-derivatives.js";

export function trashThumbnailPath(config: AppConfig, trashId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(trashId))
    throw new Error("Invalid Trash identifier.");
  return path.join(
    config.cacheDir,
    "trash-thumbnails",
    trashId,
    "thumbnail.webp"
  );
}

export async function removeTrashThumbnail(
  config: AppConfig,
  trashId: string
): Promise<void> {
  const filename = trashThumbnailPath(config, trashId);
  let handle;
  try {
    handle = await openPrivateCacheFile(filename, config.cacheDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    await unlink(filename);
  } finally {
    await handle.close();
  }
  await rmdir(path.dirname(filename)).catch(() => undefined);
}

/** Retain one bounded static preview while the ordinary source is still active. */
export async function captureTrashThumbnail(
  config: AppConfig,
  db: AetherDatabase,
  assetId: string,
  trashId: string
): Promise<void> {
  const file = await resolveAssetFile(db, assetId);
  if (!file) return;
  const thumbnail =
    file.asset.mediaType === "image"
      ? await ensureImageThumbnail({ config, db, file, size: 320 })
      : await ensureVideoPoster({ config, db, file, size: 320 });
  const source = await openPrivateCacheFile(thumbnail.path, config.cacheDir);
  await ensurePrivateCacheDirectory(
    config.cacheDir,
    "trash-thumbnails",
    trashId
  );
  const destination = trashThumbnailPath(config, trashId);
  const output = await open(destination, "wx", 0o600);
  let complete = false;
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    while (true) {
      const read = await source.read(buffer, 0, buffer.length, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > 2 * 1024 ** 2) throw new Error("Thumbnail limit exceeded.");
      await output.writeFile(buffer.subarray(0, read.bytesRead));
    }
    await output.sync();
    complete = true;
  } finally {
    await Promise.allSettled([source.close(), output.close()]);
    if (!complete) await unlink(destination).catch(() => undefined);
  }
}
