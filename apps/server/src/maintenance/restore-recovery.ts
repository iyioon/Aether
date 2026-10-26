import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { AetherDataPaths } from "../config/data-directory.js";
import {
  requireDataDirectoryMarker,
  requireManagedDataSubdirectories
} from "../config/data-directory.js";

const token = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const stagedDirectory = new RegExp(
  `^\\.aether-restore-(?:database|cache)-${token}$`
);
const previousCache = new RegExp(`^\\.aether-restore-previous-cache-${token}$`);
const previousDatabase = new RegExp(
  `^\\.aether-restore-previous-${token}\\.sqlite(?:-wal|-shm)?$`
);

export async function hasPreservedRestoreState(
  paths: AetherDataPaths
): Promise<boolean> {
  const [rootEntries, configEntries] = await Promise.all([
    readEntries(paths.dataDir),
    readEntries(paths.configDir)
  ]);
  return (
    rootEntries.some((entry) => previousCache.test(entry)) ||
    configEntries.some((entry) => previousDatabase.test(entry))
  );
}

/** Run before opening SQLite, under the exclusive runtime lock. */
export async function prepareRestoreStateForStartup(
  paths: AetherDataPaths
): Promise<void> {
  await requireDataDirectoryMarker(paths);
  await requireManagedDataSubdirectories(paths);
  if (await hasPreservedRestoreState(paths)) {
    throw new Error(
      "An interrupted restore left recovery copies. Restore a verified backup or inspect the preserved files before starting Aether."
    );
  }
  await removeRestoreArtifacts(paths, false);
}

/** Recovery copies are disposable only after a verified restore or explicit rebuild. */
export async function removeRestoreArtifacts(
  paths: AetherDataPaths,
  includeRecovery: boolean
): Promise<void> {
  await requireDataDirectoryMarker(paths);
  await requireManagedDataSubdirectories(paths, true);
  for (const entry of await readEntries(paths.dataDir)) {
    if (
      stagedDirectory.test(entry) ||
      (includeRecovery && previousCache.test(entry))
    ) {
      await rm(path.join(paths.dataDir, entry), {
        recursive: true,
        force: true
      });
    }
  }
  if (includeRecovery) {
    for (const entry of await readEntries(paths.configDir)) {
      if (previousDatabase.test(entry))
        await rm(path.join(paths.configDir, entry), { force: true });
    }
  }
}

async function readEntries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}
