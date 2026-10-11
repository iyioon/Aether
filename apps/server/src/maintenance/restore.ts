import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, type Stats } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type { AetherDataPaths } from "../config/data-directory.js";
import {
  checkpointDatabase,
  InvalidAetherSchemaError,
  LATEST_SCHEMA_VERSION,
  openDatabase,
  validateLatestAetherSchema,
  type AetherDatabase
} from "../db/database.js";
import { BACKUP_MANIFEST_VERSION } from "./backup.js";
import { withDataDirectoryMaintenanceLock } from "./data-directory.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const SQLITE_FILE = "aether.sqlite";

interface ManifestFile {
  path: string;
  kind: "sqlite" | "cache";
  sizeBytes?: number;
  sha256?: string;
}

interface ValidatedBackup {
  backupDir: string;
  manifestVersion: 1 | typeof BACKUP_MANIFEST_VERSION;
  includedCache: boolean;
  database: ManifestFile;
  cacheFiles: ManifestFile[];
  legacyCacheDirectory: string | null;
}

interface RestoreDependencies {
  afterDatabaseSwap?: (databasePath: string) => Promise<void> | void;
}

export interface RestoreDataDirectoryOptions {
  paths: AetherDataPaths;
  workspaceRoot: string;
  mediaRootPaths?: string[];
  backupDir: string;
}

export interface RestoreDataDirectoryResult {
  databaseVersion: number;
  manifestVersion: number;
  restoredCache: boolean;
}

export async function restoreDataDirectory(
  {
    paths,
    workspaceRoot,
    mediaRootPaths = [],
    backupDir
  }: RestoreDataDirectoryOptions,
  dependencies: RestoreDependencies = {}
): Promise<RestoreDataDirectoryResult> {
  return withDataDirectoryMaintenanceLock(
    paths,
    workspaceRoot,
    mediaRootPaths,
    async () => {
      const backup = await validateBackup(backupDir, paths);
      const token = randomUUID();
      const stagedDatabaseDir = path.join(
        paths.dataDir,
        `.aether-restore-database-${token}`
      );
      const stagedDatabasePath = path.join(stagedDatabaseDir, SQLITE_FILE);
      const stagedCachePath = path.join(
        paths.dataDir,
        `.aether-restore-cache-${token}`
      );
      const previousCachePath = path.join(
        paths.dataDir,
        `.aether-restore-previous-cache-${token}`
      );
      const databasePath = path.join(paths.configDir, SQLITE_FILE);
      const previousDatabaseFiles = databaseFileSet(
        paths.configDir,
        `.aether-restore-previous-${token}.sqlite`
      );
      const currentDatabaseFiles = databaseFileSet(
        paths.configDir,
        SQLITE_FILE
      );
      const movedDatabaseFiles: Array<{
        current: string;
        previous: string;
      }> = [];
      let databaseInstalled = false;
      let cachePreserved = false;
      let cacheInstalled = false;
      let committed = false;
      let rollbackFailed = false;

      try {
        await copyManifestFile(
          resolveManifestPath(backup.backupDir, backup.database.path),
          stagedDatabasePath,
          backup.database,
          backup.backupDir
        );
        await validateAetherDatabase(stagedDatabasePath);
        await migrateStagedAetherDatabase(stagedDatabaseDir);
        const stagedDatabaseVersion =
          await validateAetherDatabase(stagedDatabasePath);
        if (stagedDatabaseVersion !== LATEST_SCHEMA_VERSION) {
          throw new Error("Backup database migrations did not finish.");
        }
        await clearStagedAuthentication(stagedDatabaseDir);
        await validateAetherDatabase(stagedDatabasePath, {
          requireEmptyAuthentication: true
        });
        await removeSqliteSidecars(stagedDatabasePath);

        await mkdir(stagedCachePath, { mode: 0o700 });
        if (backup.includedCache) {
          if (backup.legacyCacheDirectory) {
            await copyLegacyCacheDirectory(
              backup.legacyCacheDirectory,
              stagedCachePath
            );
          } else {
            for (const cacheFile of backup.cacheFiles) {
              const relativeCachePath = cacheFile.path.slice("cache/".length);
              await copyManifestFile(
                resolveManifestPath(backup.backupDir, cacheFile.path),
                path.join(stagedCachePath, ...relativeCachePath.split("/")),
                cacheFile,
                backup.backupDir
              );
            }
          }
        }

        for (let index = 0; index < currentDatabaseFiles.length; index += 1) {
          const current = currentDatabaseFiles[index]!;
          const previous = previousDatabaseFiles[index]!;
          const stats = await lstatIfExists(current);
          if (!stats) {
            continue;
          }
          requireOrdinaryFileStats(stats, "Current SQLite data");
          await rename(current, previous);
          movedDatabaseFiles.push({ current, previous });
        }

        await rename(stagedDatabasePath, databasePath);
        databaseInstalled = true;
        await chmod(databasePath, 0o600);
        await removeSqliteSidecars(databasePath);
        await dependencies.afterDatabaseSwap?.(databasePath);
        const databaseVersion = await validateAetherDatabase(databasePath, {
          requireEmptyAuthentication: true
        });
        await removeSqliteSidecars(databasePath);

        await rename(paths.cacheDir, previousCachePath);
        cachePreserved = true;
        await rename(stagedCachePath, paths.cacheDir);
        cacheInstalled = true;
        await chmod(paths.cacheDir, 0o700);

        committed = true;
        return {
          databaseVersion,
          manifestVersion: backup.manifestVersion,
          restoredCache: backup.includedCache
        };
      } catch (error) {
        try {
          await rollbackRestore({
            databaseInstalled,
            currentDatabaseFiles,
            movedDatabaseFiles,
            cacheInstalled,
            cachePreserved,
            cachePath: paths.cacheDir,
            previousCachePath
          });
        } catch (rollbackError) {
          rollbackFailed = true;
          throw new AggregateError(
            [error, rollbackError],
            "Restore failed and Aether could not put the previous data back automatically. Keep the preserved restore files and inspect the data directory before starting Aether."
          );
        }

        throw error instanceof Error
          ? error
          : new Error("Aether data restore failed.", { cause: error });
      } finally {
        await Promise.all([
          rm(stagedDatabaseDir, { recursive: true, force: true }),
          rm(stagedCachePath, { recursive: true, force: true })
        ]).catch(() => undefined);

        if (committed && !rollbackFailed) {
          await Promise.all([
            ...previousDatabaseFiles.map((filePath) =>
              rm(filePath, { force: true })
            ),
            rm(previousCachePath, { recursive: true, force: true })
          ]).catch(() => undefined);
        }
      }
    }
  );
}

async function migrateStagedAetherDatabase(
  stagedDatabaseDir: string
): Promise<void> {
  let db: Database.Database | undefined;

  try {
    db = openDatabase(stagedDatabaseDir);
  } finally {
    db?.close();
  }
}

async function clearStagedAuthentication(
  stagedDatabaseDir: string
): Promise<void> {
  const db: AetherDatabase = openDatabase(stagedDatabaseDir);

  try {
    const clearAuthentication = db.transaction(() => {
      db.prepare("DELETE FROM sessions").run();
      db.prepare("DELETE FROM login_attempts").run();
    });
    clearAuthentication();
    if (!checkpointDatabase(db)) {
      throw new Error("Restored authentication state could not be cleared.");
    }
  } finally {
    db.close();
  }
}

async function validateBackup(
  inputBackupDir: string,
  paths: AetherDataPaths
): Promise<ValidatedBackup> {
  const backupDir = path.resolve(inputBackupDir);
  const backupStats = await lstat(backupDir);
  if (!backupStats.isDirectory() || backupStats.isSymbolicLink()) {
    throw new Error("The restore source must be a real backup directory.");
  }

  const [canonicalBackupDir, canonicalConfigDir, canonicalCacheDir] =
    await Promise.all([
      realpath(backupDir),
      realpath(paths.configDir),
      realpath(paths.cacheDir)
    ]);
  assertBackupOutsideMutableTargets(
    canonicalBackupDir,
    canonicalConfigDir,
    canonicalCacheDir
  );
  const manifestPath = path.join(canonicalBackupDir, "manifest.json");
  const manifestValue = await readManifest(manifestPath);

  if (isVersionTwoManifestHeader(manifestValue)) {
    return validateVersionTwoManifest(manifestValue, canonicalBackupDir);
  }

  return validateLegacyManifest(manifestValue, canonicalBackupDir);
}

async function readManifest(manifestPath: string): Promise<unknown> {
  let handle;
  try {
    handle = await open(
      manifestPath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    const stats = await handle.stat();
    requireOrdinaryFileStats(stats, "Backup manifest");
    if (stats.size > MAX_MANIFEST_BYTES) {
      throw new Error("Backup manifest is too large.");
    }
    return JSON.parse(await handle.readFile("utf8")) as unknown;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Backup manifest is too large." ||
        error.message === "Backup manifest must be a real file.")
    ) {
      throw error;
    }
    throw new Error("The backup manifest is missing or malformed.");
  } finally {
    await handle?.close();
  }
}

function validateVersionTwoManifest(
  manifest: Record<string, unknown>,
  backupDir: string
): ValidatedBackup {
  if (
    !hasOnlyKeys(manifest, [
      "application",
      "version",
      "createdAt",
      "includedCache",
      "files"
    ]) ||
    manifest.application !== "aether" ||
    manifest.version !== BACKUP_MANIFEST_VERSION ||
    !isIsoDate(manifest.createdAt) ||
    typeof manifest.includedCache !== "boolean" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("The backup manifest is not a supported Aether backup.");
  }

  const files = manifest.files.map(parseVersionTwoFile);
  ensureUniqueManifestPaths(files);
  const databaseFiles = files.filter((file) => file.kind === "sqlite");
  const cacheFiles = files.filter((file) => file.kind === "cache");

  if (
    databaseFiles.length !== 1 ||
    databaseFiles[0]?.path !== SQLITE_FILE ||
    cacheFiles.some((file) => !file.path.startsWith("cache/")) ||
    (!manifest.includedCache && cacheFiles.length > 0)
  ) {
    throw new Error("The backup manifest has an invalid file list.");
  }

  return {
    backupDir,
    manifestVersion: BACKUP_MANIFEST_VERSION,
    includedCache: manifest.includedCache,
    database: databaseFiles[0],
    cacheFiles,
    legacyCacheDirectory: null
  };
}

function validateLegacyManifest(
  manifest: unknown,
  backupDir: string
): ValidatedBackup {
  if (
    !isRecord(manifest) ||
    !hasOnlyKeys(manifest, ["createdAt", "source", "includedCache", "files"]) ||
    !isIsoDate(manifest.createdAt) ||
    !isRecord(manifest.source) ||
    !hasOnlyKeys(manifest.source, ["configDir", "cacheDir"]) ||
    typeof manifest.source.configDir !== "string" ||
    !(
      typeof manifest.source.cacheDir === "string" ||
      manifest.source.cacheDir === null
    ) ||
    typeof manifest.includedCache !== "boolean" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("The backup manifest is not a supported Aether backup.");
  }

  const files = manifest.files.map(parseLegacyFile);
  ensureUniqueManifestPaths(files);
  const expectedPaths = manifest.includedCache
    ? [SQLITE_FILE, "cache"]
    : [SQLITE_FILE];
  expectedPaths.sort();
  const actualPaths = files.map((file) => file.path).sort();

  if (
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((value, index) => value !== expectedPaths[index]) ||
    files.find((file) => file.path === SQLITE_FILE)?.kind !== "sqlite" ||
    (manifest.includedCache &&
      files.find((file) => file.path === "cache")?.kind !== "cache")
  ) {
    throw new Error("The legacy backup manifest has an invalid file list.");
  }

  return {
    backupDir,
    manifestVersion: 1,
    includedCache: manifest.includedCache,
    database: files.find((file) => file.path === SQLITE_FILE)!,
    cacheFiles: [],
    legacyCacheDirectory: manifest.includedCache
      ? resolveManifestPath(backupDir, "cache")
      : null
  };
}

function parseVersionTwoFile(value: unknown): ManifestFile {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["path", "kind", "sizeBytes", "sha256"]) ||
    !isSafeManifestPath(value.path) ||
    (value.kind !== "sqlite" && value.kind !== "cache") ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 0 ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    throw new Error("The backup manifest contains an invalid file entry.");
  }

  return {
    path: value.path,
    kind: value.kind,
    sizeBytes: value.sizeBytes as number,
    sha256: value.sha256
  };
}

function parseLegacyFile(value: unknown): ManifestFile {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["path", "kind"]) ||
    !isSafeManifestPath(value.path) ||
    (value.kind !== "sqlite" && value.kind !== "cache")
  ) {
    throw new Error(
      "The legacy backup manifest contains an invalid file entry."
    );
  }

  return { path: value.path, kind: value.kind };
}

async function copyManifestFile(
  sourcePath: string,
  destinationPath: string,
  manifestFile: ManifestFile,
  sourceRoot?: string
): Promise<void> {
  if (sourceRoot) {
    await requireRealDirectoryChain(sourceRoot, path.dirname(sourcePath));
  } else {
    await requireRealDirectory(path.dirname(sourcePath));
  }
  const before = await lstat(sourcePath);
  requireOrdinaryFileStats(before, "Backup file");

  if (
    manifestFile.sizeBytes !== undefined &&
    before.size !== manifestFile.sizeBytes
  ) {
    throw new Error("A backup file does not match its manifest.");
  }

  await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  await chmod(destinationPath, 0o600);

  const after = await lstat(sourcePath);
  requireOrdinaryFileStats(after, "Backup file");
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error("A backup file changed while it was being read.");
  }

  const copied = await lstat(destinationPath);
  requireOrdinaryFileStats(copied, "Staged restore file");
  if (
    manifestFile.sizeBytes !== undefined &&
    copied.size !== manifestFile.sizeBytes
  ) {
    throw new Error("A backup file does not match its manifest.");
  }

  if (
    manifestFile.sha256 !== undefined &&
    (await sha256File(destinationPath)) !== manifestFile.sha256
  ) {
    throw new Error("A backup file does not match its manifest.");
  }
}

async function copyLegacyCacheDirectory(
  sourceDir: string,
  destinationDir: string
): Promise<void> {
  const sourceStats = await lstat(sourceDir);
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new Error("The legacy backup cache must be a real directory.");
  }

  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    const stats = await lstat(sourcePath);

    if (stats.isSymbolicLink()) {
      throw new Error("Backup cache data cannot contain symbolic links.");
    }
    if (stats.isDirectory()) {
      await mkdir(destinationPath, { mode: 0o700 });
      await copyLegacyCacheDirectory(sourcePath, destinationPath);
      continue;
    }
    requireOrdinaryFileStats(stats, "Backup cache data");
    await copyManifestFile(sourcePath, destinationPath, {
      path: entry.name,
      kind: "cache"
    });
  }
}

async function validateAetherDatabase(
  databasePath: string,
  options: { requireEmptyAuthentication?: boolean } = {}
): Promise<number> {
  const stats = await lstat(databasePath);
  requireOrdinaryFileStats(stats, "Restore database");
  let db: Database.Database | undefined;

  try {
    db = new Database(databasePath, { fileMustExist: true, readonly: true });
    db.pragma("query_only = ON");
    const integrity = db.pragma("integrity_check") as Array<{
      integrity_check?: unknown;
    }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new Error("Backup database failed its integrity check.");
    }

    const foreignKeyProblems = db.pragma("foreign_key_check") as unknown[];
    if (foreignKeyProblems.length > 0) {
      throw new Error("Backup database has invalid foreign-key references.");
    }

    const requiredTables = new Set([
      "schema_migrations",
      "roots",
      "folders",
      "assets"
    ]);
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    for (const table of tables) {
      requiredTables.delete(table.name);
    }
    if (requiredTables.size > 0) {
      throw new Error("Backup database is not an Aether database.");
    }

    const migrations = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    if (
      migrations.length === 0 ||
      migrations.some(
        (migration, index) =>
          !Number.isInteger(migration.version) ||
          migration.version !== index + 1
      )
    ) {
      throw new Error("Backup database has an invalid migration history.");
    }

    const databaseVersion = migrations.at(-1)?.version ?? 0;
    if (databaseVersion > LATEST_SCHEMA_VERSION) {
      throw new Error("Backup database was created by a newer Aether version.");
    }
    if (databaseVersion === LATEST_SCHEMA_VERSION) {
      validateLatestAetherSchema(db);
    }
    if (options.requireEmptyAuthentication) {
      const authenticationRows = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM sessions) AS sessions,
             (SELECT COUNT(*) FROM login_attempts) AS login_attempts`
        )
        .get() as { sessions: number; login_attempts: number };
      if (
        authenticationRows.sessions !== 0 ||
        authenticationRows.login_attempts !== 0
      ) {
        throw new Error("Backup database retained authentication state.");
      }
    }
    return databaseVersion;
  } catch (error) {
    if (error instanceof InvalidAetherSchemaError) {
      throw new Error("Backup database is missing required Aether schema.");
    }
    if (error instanceof Error && error.message.startsWith("Backup database")) {
      throw error;
    }
    throw new Error(
      "Backup database is not a valid compatible Aether database."
    );
  } finally {
    db?.close();
  }
}

async function rollbackRestore({
  databaseInstalled,
  currentDatabaseFiles,
  movedDatabaseFiles,
  cacheInstalled,
  cachePreserved,
  cachePath,
  previousCachePath
}: {
  databaseInstalled: boolean;
  currentDatabaseFiles: string[];
  movedDatabaseFiles: Array<{ current: string; previous: string }>;
  cacheInstalled: boolean;
  cachePreserved: boolean;
  cachePath: string;
  previousCachePath: string;
}): Promise<void> {
  if (cacheInstalled) {
    await rm(cachePath, { recursive: true, force: true });
  }
  if (cachePreserved) {
    await rename(previousCachePath, cachePath);
  }

  if (databaseInstalled) {
    await Promise.all(
      currentDatabaseFiles.map((filePath) => rm(filePath, { force: true }))
    );
  }
  for (const file of [...movedDatabaseFiles].reverse()) {
    await rename(file.previous, file.current);
  }
}

function databaseFileSet(configDir: string, databaseName: string): string[] {
  const databasePath = path.join(configDir, databaseName);
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

async function removeSqliteSidecars(databasePath: string): Promise<void> {
  await Promise.all([
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true })
  ]);
}

async function requireRealDirectory(directoryPath: string): Promise<void> {
  const stats = await lstat(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Backup paths must use real directories.");
  }
}

async function requireRealDirectoryChain(
  rootPath: string,
  directoryPath: string
): Promise<void> {
  const relative = path.relative(rootPath, directoryPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Backup paths must stay inside the backup directory.");
  }

  await requireRealDirectory(rootPath);
  let current = rootPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await requireRealDirectory(current);
  }
}

function requireOrdinaryFileStats(stats: Stats, label: string): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`${label} must be a real file.`);
  }
}

async function lstatIfExists(filePath: string): Promise<Stats | null> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function resolveManifestPath(backupDir: string, manifestPath: string): string {
  if (!isSafeManifestPath(manifestPath)) {
    throw new Error("The backup manifest contains an unsafe path.");
  }
  const resolved = path.resolve(backupDir, ...manifestPath.split("/"));
  const relative = path.relative(backupDir, resolved);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("The backup manifest contains an unsafe path.");
  }
  return resolved;
}

function isSafeManifestPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    value !== "." &&
    !value.split("/").includes("..")
  );
}

function ensureUniqueManifestPaths(files: ManifestFile[]): void {
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) {
      throw new Error("The backup manifest contains duplicate paths.");
    }
    paths.add(file.path);
  }
}

function assertBackupOutsideMutableTargets(
  backupDir: string,
  configDir: string,
  cacheDir: string
): void {
  for (const target of [configDir, cacheDir]) {
    if (pathsOverlap(backupDir, target)) {
      throw new Error(
        "The restore source cannot overlap Aether's config or cache directory."
      );
    }
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isVersionTwoManifestHeader(
  value: unknown
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (value.version !== undefined || value.application !== undefined)
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[]
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
