import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
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
  now?: Date;
}

export interface CreateBackupResult {
  backupDir: string;
  databasePath: string;
  manifestPath: string;
  includedCache: boolean;
  prunedBackups: string[];
}

interface BackupManifest {
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

export async function createConfigBackup({
  configDir,
  outputDir,
  cacheDir,
  includeCache = false,
  keep,
  now = new Date()
}: CreateBackupOptions): Promise<CreateBackupResult> {
  const sourceDatabasePath = path.join(configDir, "aether.sqlite");
  await access(sourceDatabasePath, constants.R_OK);

  const backupDir = path.join(outputDir, `aether-${backupTimestamp(now)}`);
  const databasePath = path.join(backupDir, "aether.sqlite");
  const manifestPath = path.join(backupDir, "manifest.json");
  const files: BackupManifest["files"] = [
    {
      path: "aether.sqlite",
      kind: "sqlite"
    }
  ];

  await mkdir(backupDir, { recursive: true });

  const db = new Database(sourceDatabasePath, {
    fileMustExist: true,
    readonly: true
  });

  try {
    await db.backup(databasePath);
  } finally {
    db.close();
  }

  if (includeCache && cacheDir) {
    await access(cacheDir, constants.R_OK);
    await cp(cacheDir, path.join(backupDir, "cache"), {
      recursive: true
    });
    files.push({
      path: "cache",
      kind: "cache"
    });
  }

  const manifest: BackupManifest = {
    createdAt: now.toISOString(),
    source: {
      configDir,
      cacheDir: cacheDir ?? null
    },
    includedCache: includeCache && Boolean(cacheDir),
    files
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const prunedBackups =
    keep === undefined ? [] : await pruneBackupDirectory(outputDir, keep, backupDir);

  return {
    backupDir,
    databasePath,
    manifestPath,
    includedCache: manifest.includedCache,
    prunedBackups
  };
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
  const protectedPath = protectedBackupDir ? path.resolve(protectedBackupDir) : null;
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

    const manifest = await readBackupManifest(path.join(backupPath, "manifest.json"));

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
): Promise<BackupManifest | null> {
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

function isBackupManifest(value: unknown): value is BackupManifest {
  return (
    isRecord(value) &&
    typeof value.createdAt === "string" &&
    isRecord(value.source) &&
    typeof value.source.configDir === "string" &&
    (typeof value.source.cacheDir === "string" || value.source.cacheDir === null) &&
    typeof value.includedCache === "boolean" &&
    Array.isArray(value.files)
  );
}
