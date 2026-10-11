import { chmod, lstat, readdir, rm } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { AetherDatabase } from "../db/database.js";

const cacheKinds = ["thumbnails", "posters", "previews"] as const;

export interface DerivativeCacheCleanupResult {
  removedEntries: number;
}

interface SweepOptions {
  pruneStaleFiles?: boolean;
}

/**
 * Removes every cached derivative that belongs to an asset which has just
 * been removed from the library. Asset IDs are treated as untrusted database
 * values so a corrupt row cannot make cleanup escape the cache directory.
 */
export async function removeAssetDerivativeCache(
  cacheDir: string,
  assetIds: Iterable<string>
): Promise<DerivativeCacheCleanupResult> {
  const uniqueAssetIds = [...new Set(assetIds)].filter(isSafePathSegment);
  let removedEntries = 0;

  try {
    if (!(await requireRealDirectory(cacheDir, true))) {
      return { removedEntries: 0 };
    }

    for (const kind of cacheKinds) {
      const kindDirectory = path.resolve(cacheDir, kind);
      if (!(await requireRealDirectory(kindDirectory, true))) {
        continue;
      }

      for (const assetId of uniqueAssetIds) {
        const assetDirectory = path.resolve(kindDirectory, assetId);
        if (!isDirectChild(kindDirectory, assetDirectory)) {
          continue;
        }

        if (await pathExists(assetDirectory)) {
          await rm(assetDirectory, { force: true, recursive: true });
          removedEntries += 1;
        }
      }
    }
  } catch {
    throw new DerivativeCacheCleanupError();
  }

  return { removedEntries };
}

/**
 * Reconciles the cache with the live database. Normal post-scan sweeps remove
 * only orphan asset directories, which is safe while derivative requests may
 * still be running. Startup may additionally prune obsolete files for live
 * assets because no requests have been accepted yet.
 */
export async function sweepDerivativeCache(
  db: AetherDatabase,
  cacheDir: string,
  options: SweepOptions = {}
): Promise<DerivativeCacheCleanupResult> {
  const liveAssetIds = new Set(
    (db.prepare("SELECT id FROM assets").all() as Array<{ id: string }>).map(
      (row) => row.id
    )
  );
  const referencedFiles = options.pruneStaleFiles
    ? referencedDerivativeFiles(db, cacheDir, liveAssetIds)
    : null;
  let removedEntries = 0;

  try {
    if (!(await requireRealDirectory(cacheDir, true))) {
      return { removedEntries: 0 };
    }

    for (const kind of cacheKinds) {
      const kindDirectory = path.resolve(cacheDir, kind);
      if (!(await requireRealDirectory(kindDirectory, true))) {
        continue;
      }

      const entries = await readDirectory(kindDirectory);

      for (const entry of entries) {
        const entryPath = path.resolve(kindDirectory, entry.name);
        if (!isDirectChild(kindDirectory, entryPath)) {
          continue;
        }

        const isLiveAssetDirectory =
          entry.isDirectory() &&
          isSafePathSegment(entry.name) &&
          liveAssetIds.has(entry.name);
        if (!isLiveAssetDirectory) {
          await rm(entryPath, { force: true, recursive: true });
          removedEntries += 1;
          continue;
        }

        if (!referencedFiles) {
          continue;
        }

        await requireRealDirectory(entryPath, false);
        const cachedFiles = await readDirectory(entryPath);
        for (const cachedFile of cachedFiles) {
          const cachedPath = path.resolve(entryPath, cachedFile.name);
          if (!isDirectChild(entryPath, cachedPath)) {
            continue;
          }

          if (
            cachedFile.isFile() &&
            referencedFiles.has(cachedPath) &&
            (await isSafeCachedFile(cachedPath))
          ) {
            await chmod(cachedPath, 0o600);
          } else {
            await rm(cachedPath, { force: true, recursive: true });
            removedEntries += 1;
          }
        }
      }
    }
  } catch {
    throw new DerivativeCacheCleanupError();
  }

  return { removedEntries };
}

function referencedDerivativeFiles(
  db: AetherDatabase,
  cacheDir: string,
  liveAssetIds: Set<string>
): Set<string> {
  const rows = db
    .prepare(
      `SELECT asset_id, path
       FROM derivatives
       WHERE status = 'ready'`
    )
    .all() as Array<{ asset_id: string; path: string }>;
  const cacheRoot = path.resolve(cacheDir);
  const referenced = new Set<string>();

  for (const row of rows) {
    if (!liveAssetIds.has(row.asset_id) || !isSafePathSegment(row.asset_id)) {
      continue;
    }

    const resolvedPath = path.resolve(row.path);
    const relativePath = path.relative(cacheRoot, resolvedPath);
    if (
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath) ||
      relativePath === ""
    ) {
      continue;
    }

    const [kind, assetId, fileName, ...remainder] = relativePath.split(
      path.sep
    );
    if (
      !cacheKinds.includes(kind as (typeof cacheKinds)[number]) ||
      assetId !== row.asset_id ||
      !fileName ||
      remainder.length > 0
    ) {
      continue;
    }

    referenced.add(resolvedPath);
  }

  return referenced;
}

async function readDirectory(directory: string): Promise<Dirent<string>[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

async function isSafeCachedFile(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

async function requireRealDirectory(
  directory: string,
  allowMissing: boolean
): Promise<boolean> {
  try {
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Unsafe derivative cache directory.");
    }
    await chmod(directory, 0o700);
    return true;
  } catch (error) {
    if (allowMissing && isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function isDirectChild(parent: string, child: string): boolean {
  const relativePath = path.relative(parent, child);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath) &&
    !relativePath.includes(path.sep)
  );
}

function isSafePathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    path.basename(value) === value &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class DerivativeCacheCleanupError extends Error {
  constructor() {
    super("Derivative cache cleanup failed.");
    this.name = "DerivativeCacheCleanupError";
  }
}
