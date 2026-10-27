import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, stat, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { resolveAssetFile, type ResolvedAssetFile } from "./media-serving.js";
import { getAsset, upsertDerivative } from "./repository.js";
import {
  getPresentationRenditionKeys,
  type MediaPresentation
} from "./presentation.js";
import { removePresentationDerivativeFiles } from "./derivative-cache.js";
import { stableId } from "./ids.js";
import { withVideoProcessingSlot } from "./video-processing.js";

export interface PresentationFile {
  path: string;
  contentType: string;
}
const jobsByDatabase = new WeakMap<
  AetherDatabase,
  Map<string, Promise<PresentationFile>>
>();
let pendingJobs = 0;
let reversing = false;
const reverseQueue: Array<() => void> = [];

export type PresentationVariant = "full" | "highlight" | "bounce";

export class PresentationMediaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 415
  ) {
    super(code);
    this.name = "PresentationMediaError";
  }
}

export class StalePresentationRenditionError extends PresentationMediaError {
  constructor() {
    super("stale_rendition", 409);
    this.name = "StalePresentationRenditionError";
  }
}

export function presentationForFile(
  db: AetherDatabase,
  file: ResolvedAssetFile
): MediaPresentation {
  const asset = getAsset(db, file.asset.id);
  if (!asset) throw new PresentationMediaError("asset_not_found", 404);
  return {
    ...asset.presentation,
    renditionKeys: getPresentationRenditionKeys(
      { id: file.asset.id, mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes },
      asset.presentation
    )
  };
}

export async function verifyPresentationSource(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  variant: PresentationVariant,
  key: string
): Promise<void> {
  const current = await resolveAssetFile(db, file.asset.id);
  if (!current) throw new PresentationMediaError("asset_not_found", 404);
  if (
    current.sourcePath !== file.sourcePath ||
    current.mtimeMs !== file.mtimeMs ||
    current.sizeBytes !== file.sizeBytes ||
    presentationForFile(db, current).renditionKeys[variant] !== key
  ) {
    throw new StalePresentationRenditionError();
  }
}

export async function presentationCacheDirectory(
  config: AppConfig,
  assetId: string
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(assetId))
    throw new PresentationMediaError("invalid_asset", 400);
  let directory = config.cacheDir;
  for (const segment of [null, "presentations", assetId]) {
    if (segment) directory = path.join(directory, segment);
    await mkdir(directory, { mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      }
    );
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new PresentationMediaError("unsafe_cache", 500);
    await chmod(directory, 0o700);
  }
  return directory;
}

export async function safeCachedFile(filePath: string): Promise<boolean> {
  const info = await lstat(filePath).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink() && info.nlink === 1);
}

export function recordPresentationFiles(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  variant: string,
  key: string,
  paths: string[]
): Array<{ assetId: string; path: string }> {
  return db.transaction(() => {
    const retiredBounce = variant.startsWith("bounce-")
      ? (db
          .prepare(
            "SELECT asset_id AS assetId, path FROM derivatives WHERE asset_id = ? AND kind GLOB 'presentation:bounce-*' AND kind NOT GLOB ?"
          )
          .all(file.asset.id, `presentation:bounce-*:${key}:*`) as Array<{
          assetId: string;
          path: string;
        }>)
      : [];
    if (variant.startsWith("bounce-"))
      db.prepare(
        "DELETE FROM derivatives WHERE asset_id = ? AND kind GLOB 'presentation:bounce-*' AND kind NOT GLOB ?"
      ).run(file.asset.id, `presentation:bounce-*:${key}:*`);
    const obsolete = db
      .prepare(
        "SELECT asset_id AS assetId, path FROM derivatives WHERE asset_id = ? AND kind GLOB ?"
      )
      .all(file.asset.id, `presentation:${variant}:*`) as Array<{
      assetId: string;
      path: string;
    }>;
    db.prepare(
      "DELETE FROM derivatives WHERE asset_id = ? AND kind GLOB ?"
    ).run(file.asset.id, `presentation:${variant}:*`);
    paths.forEach((filePath, index) =>
      upsertDerivative(db, {
        id: stableId("derivative", file.asset.id, variant, key, String(index)),
        assetId: file.asset.id,
        kind: `presentation:${variant}:${key}:${index}`,
        width: 0,
        height: 0,
        path: filePath,
        sourceMtimeMs: file.mtimeMs,
        status: "ready",
        error: null,
        createdAt: new Date().toISOString()
      })
    );
    return [...retiredBounce, ...obsolete].filter(
      (entry) => !paths.includes(entry.path)
    );
  })();
}

export async function requireBoundedFile(
  filePath: string,
  maxBytes: number
): Promise<void> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > maxBytes)
    throw new PresentationMediaError("presentation_limit_exceeded", 422);
  await chmod(filePath, 0o600);
}

export async function ensurePresentationDerivative(
  db: AetherDatabase,
  config: AppConfig,
  file: ResolvedAssetFile,
  variant: PresentationVariant,
  key: string,
  suffix: string,
  generate: (temporaryPath: string) => Promise<string>,
  maxOutputBytes = 128 * 1024 * 1024
): Promise<PresentationFile> {
  const directory = await presentationCacheDirectory(config, file.asset.id);
  const destination = path.join(directory, `${key}-${suffix}`);
  const contentType = suffix.endsWith("jpg")
    ? "image/jpeg"
    : suffix.endsWith("png")
      ? "image/png"
      : "video/mp4";
  if (await safeCachedFile(destination))
    return { path: destination, contentType };
  let jobs = jobsByDatabase.get(db);
  if (!jobs) {
    jobs = new Map();
    jobsByDatabase.set(db, jobs);
  }
  const existing = jobs.get(destination);
  if (existing) return existing;
  if (pendingJobs >= 8)
    throw new PresentationMediaError("processing_busy", 503);
  pendingJobs += 1;
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  const job = withPresentationProcessingSlot(variant, async () => {
    let published = false;
    try {
      await verifyPresentationSource(db, file, variant, key);
      const generatedType = await generate(temporaryPath);
      await requireBoundedFile(temporaryPath, maxOutputBytes);
      await verifyPresentationSource(db, file, variant, key);
      await rename(temporaryPath, destination);
      published = true;
      await verifyPresentationSource(db, file, variant, key);
      const obsolete = recordPresentationFiles(
        db,
        file,
        `${variant}-${suffix}`,
        key,
        [destination]
      );
      await removePresentationDerivativeFiles(config.cacheDir, obsolete).catch(
        () => undefined
      );
      return { path: destination, contentType: generatedType };
    } catch (error) {
      if (published) await rm(destination, { force: true });
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }).finally(() => {
    jobs.delete(destination);
    pendingJobs -= 1;
  });
  jobs.set(destination, job);
  return job;
}

async function withPresentationProcessingSlot(
  variant: PresentationVariant,
  task: () => Promise<PresentationFile>
): Promise<PresentationFile> {
  if (variant !== "bounce") return withVideoProcessingSlot(task);
  // Waiting Bounce jobs must leave the shared slots available to other media.
  if (reversing)
    await new Promise<void>((resolve) => reverseQueue.push(resolve));
  reversing = true;
  try {
    return await withVideoProcessingSlot(task);
  } finally {
    const next = reverseQueue.shift();
    if (next) next();
    else reversing = false;
  }
}
