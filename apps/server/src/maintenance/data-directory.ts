import {
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  rmdir
} from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { AetherDataPaths } from "../config/data-directory.js";
import {
  assertSafeDataDirectoryTarget,
  assertDataDirectoryOutsideMediaRoots,
  pathExists,
  requireDataDirectoryMarker,
  requireManagedDataSubdirectories
} from "../config/data-directory.js";
import { acquireRuntimeLock } from "./runtime-lock.js";
import { assertNoOtherTemporaryWork } from "./private-temporary-files.js";
import {
  hasPreservedRestoreState,
  removeRestoreArtifacts
} from "./restore-recovery.js";

export interface DataDirectoryEntryStatus {
  path: string;
  exists: boolean;
  files: number;
  bytes: number;
}

export interface DataDirectoryStatus {
  dataDir: string;
  initialized: boolean;
  privateEnv: boolean;
  config: DataDirectoryEntryStatus;
  cache: DataDirectoryEntryStatus;
  backups: DataDirectoryEntryStatus;
  temporary: DataDirectoryEntryStatus;
  interruptedRestore: boolean;
}

export async function getDataDirectoryStatus(
  paths: AetherDataPaths
): Promise<DataDirectoryStatus> {
  const initialized = await hasValidMarker(paths);
  const [config, cache, backups, temporary] = await Promise.all([
    inspectEntry(paths.configDir),
    inspectEntry(paths.cacheDir),
    inspectEntry(paths.backupDir),
    inspectEntry(paths.tempDir)
  ]);

  return {
    dataDir: paths.dataDir,
    initialized,
    privateEnv: await pathExists(paths.privateEnvPath),
    config,
    cache,
    backups,
    temporary,
    interruptedRestore: initialized && (await hasPreservedRestoreState(paths))
  };
}

export async function rebuildDataDirectory(
  paths: AetherDataPaths,
  workspaceRoot: string,
  mediaRootPaths: string[] = []
): Promise<void> {
  await withDataDirectoryMaintenanceLock(
    paths,
    workspaceRoot,
    mediaRootPaths,
    async () => {
      await removeRestoreArtifacts(paths, true);
      await Promise.all([
        rm(paths.configDir, { recursive: true, force: true }),
        rm(paths.cacheDir, { recursive: true, force: true }),
        rm(paths.backupDir, { recursive: true, force: true }),
        rm(paths.tempDir, { recursive: true, force: true })
      ]);

      await Promise.all([
        mkdir(paths.configDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.cacheDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.backupDir, { recursive: true, mode: 0o700 }),
        mkdir(paths.tempDir, { recursive: true, mode: 0o700 })
      ]);
      await Promise.all([
        chmod(paths.configDir, 0o700),
        chmod(paths.cacheDir, 0o700),
        chmod(paths.backupDir, 0o700),
        chmod(paths.tempDir, 0o700)
      ]);
    }
  );
}

export async function wipeDataDirectory(
  paths: AetherDataPaths,
  workspaceRoot: string,
  mediaRootPaths: string[] = []
): Promise<void> {
  await withDataDirectoryMaintenanceLock(
    paths,
    workspaceRoot,
    mediaRootPaths,
    async () => {
      const runtimeLockName = path.basename(paths.runtimeLockPath);
      const entries = await readdir(paths.dataDir);

      // Keep the lock at its canonical path until every other entry is gone.
      // This prevents a server from starting against a half-wiped directory.
      for (const entry of entries) {
        if (entry !== runtimeLockName) {
          await rm(path.join(paths.dataDir, entry), {
            recursive: true,
            force: false
          });
        }
      }
    }
  );

  // No recursive deletion occurs after releasing the lock. If another server
  // wins the post-release race and creates files, rmdir fails safely and its
  // new data directory is preserved.
  await rmdir(paths.dataDir).catch((error: unknown) => {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error instanceof Error
        ? error
        : new Error("Could not remove the empty Aether data directory", {
            cause: error
          });
    }
  });
}

export async function withDataDirectoryMaintenanceLock<T>(
  paths: AetherDataPaths,
  workspaceRoot: string,
  mediaRootPaths: string[],
  operation: () => Promise<T>
): Promise<T> {
  await requireSafeDataDirectory(paths, workspaceRoot, mediaRootPaths);
  const releaseLock = await acquireRuntimeLock(paths, "maintenance");

  try {
    // Revalidate after taking the exclusive lock so a path change between the
    // preflight check and lock acquisition cannot widen the deletion target.
    await requireSafeDataDirectory(paths, workspaceRoot, mediaRootPaths);
    await assertNoOtherTemporaryWork(paths);
    return await operation();
  } finally {
    await releaseLock();
  }
}

async function requireSafeDataDirectory(
  paths: AetherDataPaths,
  workspaceRoot: string,
  mediaRootPaths: string[]
): Promise<void> {
  assertSafeDataDirectoryTarget(paths, workspaceRoot);
  await requireDataDirectoryMarker(paths);
  await requireManagedDataSubdirectories(paths, true);
  assertDataDirectoryOutsideMediaRoots(paths.dataDir, mediaRootPaths);

  const [
    canonicalDataDir,
    canonicalWorkspace,
    canonicalHome,
    ...canonicalMediaRoots
  ] = await Promise.all([
    canonicalPath(paths.dataDir),
    canonicalPath(workspaceRoot),
    canonicalPath(homedir()),
    ...mediaRootPaths.map(canonicalPath)
  ]);
  assertSafeDataDirectoryTarget(
    { ...paths, dataDir: canonicalDataDir },
    canonicalWorkspace
  );
  if (
    canonicalDataDir === canonicalHome ||
    canonicalHome.startsWith(`${canonicalDataDir}${path.sep}`)
  ) {
    throw new Error(
      "AETHER_DATA_DIR cannot be the user's home directory or one of its parents."
    );
  }
  assertDataDirectoryOutsideMediaRoots(canonicalDataDir, canonicalMediaRoots);
}

async function canonicalPath(inputPath: string): Promise<string> {
  try {
    return await realpath(inputPath);
  } catch {
    return path.resolve(inputPath);
  }
}

async function hasValidMarker(paths: AetherDataPaths): Promise<boolean> {
  try {
    await requireDataDirectoryMarker(paths);
    return true;
  } catch {
    return false;
  }
}

async function inspectEntry(
  entryPath: string
): Promise<DataDirectoryEntryStatus> {
  if (!(await pathExists(entryPath))) {
    return { path: entryPath, exists: false, files: 0, bytes: 0 };
  }

  const totals = await measurePath(entryPath);
  return { path: entryPath, exists: true, ...totals };
}

async function measurePath(
  entryPath: string
): Promise<{ files: number; bytes: number }> {
  const stats = await lstat(entryPath);

  if (stats.isSymbolicLink()) {
    return { files: 1, bytes: stats.size };
  }

  if (!stats.isDirectory()) {
    return { files: 1, bytes: stats.size };
  }

  let files = 0;
  let bytes = 0;
  const entries = await readdir(entryPath, { withFileTypes: true });

  for (const entry of entries) {
    const measured = await measurePath(path.join(entryPath, entry.name));
    files += measured.files;
    bytes += measured.bytes;
  }

  return { files, bytes };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
