import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DATA_DIRECTORY_MARKER = ".aether-data.json";
export const PRIVATE_ENV_FILE = "private.env";

const DATA_DIRECTORY_VERSION = 1;
const KNOWN_INITIAL_ENTRIES = new Set([
  DATA_DIRECTORY_MARKER,
  PRIVATE_ENV_FILE,
  "config",
  "cache",
  "backups",
  "tmp",
  "runtime.lock"
]);

export interface AetherDataPaths {
  dataDir: string;
  configDir: string;
  cacheDir: string;
  backupDir: string;
  tempDir: string;
  privateEnvPath: string;
  markerPath: string;
  runtimeLockPath: string;
}

interface DataDirectoryMarker {
  application: "aether";
  version: number;
}

export function resolveDataPaths(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): AetherDataPaths {
  const configuredPath = env.AETHER_DATA_DIR?.trim() || "./aether-data";
  const dataDir = path.resolve(cwd, configuredPath);

  return {
    dataDir,
    configDir: path.join(dataDir, "config"),
    cacheDir: path.join(dataDir, "cache"),
    backupDir: path.join(dataDir, "backups"),
    tempDir: path.join(dataDir, "tmp"),
    privateEnvPath: path.join(dataDir, PRIVATE_ENV_FILE),
    markerPath: path.join(dataDir, DATA_DIRECTORY_MARKER),
    runtimeLockPath: path.join(dataDir, "runtime.lock")
  };
}

export async function initializeDataDirectory(
  paths: AetherDataPaths
): Promise<void> {
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  const dataStats = await lstat(paths.dataDir);

  if (!dataStats.isDirectory() || dataStats.isSymbolicLink()) {
    throw new Error(
      `AETHER_DATA_DIR must be a real directory, not a symbolic link: ${paths.dataDir}`
    );
  }

  if (await pathExists(paths.markerPath)) {
    await requireDataDirectoryMarker(paths);
  } else {
    if (await pathExists(paths.runtimeLockPath)) {
      throw new Error(
        "Aether's data directory is locked for maintenance. Try again after maintenance finishes."
      );
    }

    const entries = await readdir(paths.dataDir);
    const unknownEntries = entries.filter(
      (entry) => !KNOWN_INITIAL_ENTRIES.has(entry)
    );

    if (unknownEntries.length > 0) {
      throw new Error(
        `AETHER_DATA_DIR is not empty and is not owned by Aether: ${paths.dataDir}`
      );
    }

    const marker: DataDirectoryMarker = {
      application: "aether",
      version: DATA_DIRECTORY_VERSION
    };

    try {
      await writeFile(
        paths.markerPath,
        `${JSON.stringify(marker, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        }
      );
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      await requireDataDirectoryMarker(paths);
    }
  }

  await Promise.all([
    mkdir(paths.configDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.cacheDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.backupDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.tempDir, { recursive: true, mode: 0o700 })
  ]);
  await requireManagedDataSubdirectories(paths);
  await Promise.all([
    chmod(paths.dataDir, 0o700),
    chmod(paths.configDir, 0o700),
    chmod(paths.cacheDir, 0o700),
    chmod(paths.backupDir, 0o700),
    chmod(paths.tempDir, 0o700),
    chmod(paths.markerPath, 0o600)
  ]);

  if (await pathExists(paths.privateEnvPath)) {
    const privateEnvStats = await lstat(paths.privateEnvPath);
    if (
      !privateEnvStats.isFile() ||
      privateEnvStats.isSymbolicLink() ||
      privateEnvStats.nlink !== 1
    ) {
      throw new Error(
        `Aether's private environment file must be a real file: ${paths.privateEnvPath}`
      );
    }
    await chmod(paths.privateEnvPath, 0o600);
  }
}

export async function requireDataDirectoryMarker(
  paths: AetherDataPaths
): Promise<void> {
  const stats = await lstat(paths.dataDir);

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Unsafe AETHER_DATA_DIR: ${paths.dataDir}`);
  }

  let marker: unknown;

  try {
    const markerStats = await lstat(paths.markerPath);
    if (
      !markerStats.isFile() ||
      markerStats.isSymbolicLink() ||
      markerStats.nlink !== 1
    ) {
      throw new Error("Unsafe marker");
    }
    marker = JSON.parse(await readFile(paths.markerPath, "utf8"));
  } catch {
    throw new Error(
      `AETHER_DATA_DIR does not contain a valid ${DATA_DIRECTORY_MARKER}: ${paths.dataDir}`
    );
  }

  if (
    !isRecord(marker) ||
    marker.application !== "aether" ||
    marker.version !== DATA_DIRECTORY_VERSION
  ) {
    throw new Error(
      `AETHER_DATA_DIR has an unsupported ownership marker: ${paths.dataDir}`
    );
  }
}

export async function requireManagedDataSubdirectories(
  paths: AetherDataPaths,
  allowMissing = false
): Promise<void> {
  for (const directory of [
    paths.configDir,
    paths.cacheDir,
    paths.backupDir,
    paths.tempDir
  ]) {
    if (allowMissing && !(await pathExists(directory))) {
      continue;
    }

    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        `Aether data paths must be real directories, not symbolic links: ${directory}`
      );
    }
  }
}

export function assertSafeDataDirectoryTarget(
  paths: AetherDataPaths,
  workspaceRoot: string
): void {
  const target = path.resolve(paths.dataDir);
  const workspace = path.resolve(workspaceRoot);
  const filesystemRoot = path.parse(target).root;
  const userHome = path.resolve(homedir());

  if (target === filesystemRoot) {
    throw new Error("AETHER_DATA_DIR cannot be a filesystem root.");
  }

  if (target === workspace) {
    throw new Error("AETHER_DATA_DIR cannot be the Aether project directory.");
  }

  if (isSameOrDescendant(userHome, target)) {
    throw new Error(
      "AETHER_DATA_DIR cannot be the user's home directory or one of its parents."
    );
  }

  if (isSameOrDescendant(workspace, target)) {
    throw new Error(
      "AETHER_DATA_DIR cannot contain the Aether project directory."
    );
  }
}

export function assertDataDirectoryOutsideMediaRoots(
  dataDir: string,
  mediaRootPaths: string[]
): void {
  const resolvedDataDir = path.resolve(dataDir);

  for (const mediaRootPath of mediaRootPaths) {
    const resolvedMediaRoot = path.resolve(mediaRootPath);

    if (
      isSameOrDescendant(resolvedDataDir, resolvedMediaRoot) ||
      isSameOrDescendant(resolvedMediaRoot, resolvedDataDir)
    ) {
      throw new Error(
        `AETHER_DATA_DIR and media roots must not overlap: ${resolvedDataDir}`
      );
    }
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
