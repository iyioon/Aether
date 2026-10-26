import { createHash } from "node:crypto";
import { constants, createReadStream, type Stats } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

export interface CreateBackupOptions {
  configDir: string;
  outputDir: string;
  cacheDir?: string;
  includeCache?: boolean;
  keep?: number;
  stagingDir?: string;
  now?: Date;
}

export interface CreateBackupResult {
  backupDir: string;
  databasePath: string;
  manifestPath: string;
  includedCache: boolean;
  prunedBackups: string[];
}

export const BACKUP_MANIFEST_VERSION = 2;

export interface BackupManifestV2 {
  application: "aether";
  version: typeof BACKUP_MANIFEST_VERSION;
  createdAt: string;
  includedCache: boolean;
  files: Array<{
    path: string;
    kind: "sqlite" | "cache";
    sizeBytes: number;
    sha256: string;
  }>;
}

interface LegacyBackupManifest {
  createdAt: string;
  source: {
    configDir: string;
    cacheDir: string | null;
  };
  includedCache: boolean;
  files: Array<{
    path: string;
    kind: "sqlite" | "cache";
  }>;
}

type ReadableBackupManifest = BackupManifestV2 | LegacyBackupManifest;

export async function createConfigBackup({
  configDir,
  outputDir,
  cacheDir,
  includeCache = false,
  keep,
  stagingDir,
  now = new Date()
}: CreateBackupOptions): Promise<CreateBackupResult> {
  await assertBackupOutputSeparated({
    configDir,
    outputDir,
    cacheDir: includeCache ? cacheDir : undefined
  });

  const sourceDatabasePath = path.join(configDir, "aether.sqlite");
  await access(sourceDatabasePath, constants.R_OK);

  const backupDir = path.join(outputDir, `aether-${backupTimestamp(now)}`);
  const workingDir = stagingDir
    ? path.join(stagingDir, path.basename(backupDir))
    : backupDir;
  const databasePath = path.join(workingDir, "aether.sqlite");
  const manifestPath = path.join(workingDir, "manifest.json");

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const outputStats = await lstat(outputDir);
  if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) {
    throw new Error("Backup output must be a real directory.");
  }

  if (stagingDir) {
    const stagingStats = await lstat(stagingDir);
    if (!stagingStats.isDirectory() || stagingStats.isSymbolicLink())
      throw new Error("Backup staging requires a private process directory.");
    const existing = await lstat(backupDir).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      }
    );
    if (existing) throw new Error("The backup destination already exists.");
  }
  // Build internal backups inside the private process scope. A crash leaves
  // only abandoned temporary work; completed backup directories publish atomically.
  await mkdir(workingDir, { mode: 0o700 });
  await chmod(workingDir, 0o700);
  let backupComplete = false;

  try {
    await requireRegularFile(sourceDatabasePath, "Aether database");
    const db = new Database(sourceDatabasePath, {
      fileMustExist: true,
      readonly: true
    });

    try {
      await db.backup(databasePath);
    } finally {
      db.close();
    }
    await chmod(databasePath, 0o600);

    const databaseStats = await requireRegularFile(
      databasePath,
      "Backed-up database"
    );
    const files: BackupManifestV2["files"] = [
      {
        path: "aether.sqlite",
        kind: "sqlite",
        sizeBytes: databaseStats.size,
        sha256: await sha256File(databasePath)
      }
    ];

    if (includeCache && cacheDir) {
      await access(cacheDir, constants.R_OK);
      files.push(
        ...(await copyCacheFiles(cacheDir, path.join(workingDir, "cache")))
      );
    }

    const manifest: BackupManifestV2 = {
      application: "aether",
      version: BACKUP_MANIFEST_VERSION,
      createdAt: now.toISOString(),
      includedCache: includeCache && Boolean(cacheDir),
      files
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    if (stagingDir) await rename(workingDir, backupDir);
    backupComplete = true;
  } finally {
    if (!backupComplete) {
      await rm(workingDir, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }

  const prunedBackups =
    keep === undefined
      ? []
      : await pruneBackupDirectory(outputDir, keep, backupDir);

  return {
    backupDir,
    databasePath: path.join(backupDir, "aether.sqlite"),
    manifestPath: path.join(backupDir, "manifest.json"),
    includedCache: includeCache && Boolean(cacheDir),
    prunedBackups
  };
}

async function assertBackupOutputSeparated({
  configDir,
  outputDir,
  cacheDir
}: {
  configDir: string;
  outputDir: string;
  cacheDir?: string;
}): Promise<void> {
  const [canonicalOutputDir, canonicalConfigDir, canonicalCacheDir] =
    await Promise.all([
      resolveCanonicalPath(outputDir),
      realpath(configDir),
      cacheDir ? realpath(cacheDir) : Promise.resolve(null)
    ]);

  if (
    pathsOverlap(canonicalOutputDir, canonicalConfigDir) ||
    (canonicalCacheDir !== null &&
      pathsOverlap(canonicalOutputDir, canonicalCacheDir))
  ) {
    throw new Error(
      "Backup output cannot overlap Aether's config or cache directory."
    );
  }
}

async function resolveCanonicalPath(inputPath: string): Promise<string> {
  let existingPath = path.resolve(inputPath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return path.join(
        await realpath(existingPath),
        ...missingSegments.reverse()
      );
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }

      const parentPath = path.dirname(existingPath);
      if (parentPath === existingPath) {
        throw error;
      }
      missingSegments.push(path.basename(existingPath));
      existingPath = parentPath;
    }
  }
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
  return pathContains(leftPath, rightPath) || pathContains(rightPath, leftPath);
}

function pathContains(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function copyCacheFiles(
  sourceDir: string,
  destinationDir: string,
  relativeDir = ""
): Promise<BackupManifestV2["files"]> {
  const sourceStats = await lstat(sourceDir);
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new Error("Aether cache must be a real directory.");
  }

  await mkdir(destinationDir, { recursive: true, mode: 0o700 });
  await chmod(destinationDir, 0o700);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files: BackupManifestV2["files"] = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    // Cache backups include published media, never unfinished processor work.
    if (
      entry.name.endsWith(".tmp") ||
      entry.name.startsWith("work-") ||
      entry.name.startsWith(".decode-")
    )
      continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    const stats = await lstat(sourcePath);

    if (stats.isSymbolicLink()) {
      throw new Error("Aether cache backups cannot contain symbolic links.");
    }

    if (stats.isDirectory()) {
      files.push(
        ...(await copyCacheFiles(sourcePath, destinationPath, relativePath))
      );
      continue;
    }

    if (!stats.isFile() || stats.nlink !== 1) {
      throw new Error("Aether cache backups require ordinary files.");
    }

    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    await chmod(destinationPath, 0o600);
    const copiedStats = await requireRegularFile(
      destinationPath,
      "Backed-up cache file"
    );
    files.push({
      path: `cache/${relativePath}`,
      kind: "cache",
      sizeBytes: copiedStats.size,
      sha256: await sha256File(destinationPath)
    });
  }

  return files;
}

async function requireRegularFile(
  filePath: string,
  label: string
): Promise<Stats> {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`${label} must be a real file.`);
  }
  return stats;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }

  return hash.digest("hex");
}

export async function pruneBackupDirectory(
  outputDir: string,
  keep: number,
  protectedBackupDir?: string
): Promise<string[]> {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error("--keep must be a positive integer.");
  }

  const entries = await readdir(outputDir, { withFileTypes: true });
  const protectedPath = protectedBackupDir
    ? path.resolve(protectedBackupDir)
    : null;
  const candidates: Array<{
    path: string;
    createdAtMs: number;
    name: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^aether-\d{8}-\d{9}Z$/.test(entry.name)) {
      continue;
    }

    const backupPath = path.join(outputDir, entry.name);
    const resolvedBackupPath = path.resolve(backupPath);

    if (resolvedBackupPath === protectedPath) {
      candidates.push({
        path: backupPath,
        createdAtMs: Number.POSITIVE_INFINITY,
        name: entry.name
      });
      continue;
    }

    const stats = await lstat(backupPath);

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      continue;
    }

    const manifest = await readBackupManifest(
      path.join(backupPath, "manifest.json")
    );

    if (!manifest) {
      continue;
    }

    const createdAtMs = new Date(manifest.createdAt).getTime();

    if (!Number.isFinite(createdAtMs)) {
      continue;
    }

    candidates.push({
      path: backupPath,
      createdAtMs,
      name: entry.name
    });
  }

  candidates.sort((left, right) => {
    if (right.createdAtMs !== left.createdAtMs) {
      return right.createdAtMs - left.createdAtMs;
    }

    return right.name.localeCompare(left.name);
  });

  const toDelete = candidates.slice(keep).filter((candidate) => {
    return path.resolve(candidate.path) !== protectedPath;
  });
  const prunedBackups: string[] = [];

  for (const candidate of toDelete) {
    await rm(candidate.path, { recursive: true, force: true });
    prunedBackups.push(candidate.path);
  }

  return prunedBackups;
}

async function readBackupManifest(
  manifestPath: string
): Promise<ReadableBackupManifest | null> {
  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;

    if (!isBackupManifest(value)) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function backupTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".", "")
    .replace("T", "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isBackupManifest(value: unknown): value is ReadableBackupManifest {
  if (
    !isRecord(value) ||
    typeof value.createdAt !== "string" ||
    typeof value.includedCache !== "boolean" ||
    !Array.isArray(value.files)
  ) {
    return false;
  }

  if (
    value.application === "aether" &&
    value.version === BACKUP_MANIFEST_VERSION
  ) {
    return true;
  }

  return (
    isRecord(value.source) &&
    typeof value.source.configDir === "string" &&
    (typeof value.source.cacheDir === "string" ||
      value.source.cacheDir === null)
  );
}
