import path from "node:path";
import { loadLocalEnv } from "../config/env.js";
import {
  requireDataDirectoryMarker,
  requireManagedDataSubdirectories,
  resolveDataPaths
} from "../config/data-directory.js";
import { createConfigBackup } from "../maintenance/backup.js";
import {
  createPrivateTemporaryFiles,
  type PrivateTemporaryFiles
} from "../maintenance/private-temporary-files.js";
import { assertNoMaintenanceInProgress } from "../maintenance/runtime-lock.js";

process.umask(0o077);

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const rootDir = loadLocalEnv();
const dataPaths = resolveDataPaths(process.env, rootDir);
const outputDir = path.resolve(
  rootDir,
  readOption(args, "--output") ??
    readOption(args, "-o") ??
    process.env.AETHER_BACKUP_DIR ??
    dataPaths.backupDir
);
const includeCache = args.includes("--include-cache");
let temporaryFiles: PrivateTemporaryFiles | undefined;

try {
  await requireDataDirectoryMarker(dataPaths);
  await assertNoMaintenanceInProgress(dataPaths);
  temporaryFiles = await createPrivateTemporaryFiles(dataPaths);
  await assertNoMaintenanceInProgress(dataPaths);
  await requireManagedDataSubdirectories(dataPaths);
  const keep = readPositiveIntegerOption(args, "--keep") ?? undefined;
  const result = await createConfigBackup({
    configDir: dataPaths.configDir,
    outputDir,
    cacheDir: dataPaths.cacheDir,
    includeCache,
    stagingDir:
      outputDir === dataPaths.backupDir ? temporaryFiles.directory : undefined,
    keep
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await temporaryFiles?.close();
}

function readOption(args: string[], name: string): string | null {
  const index = args.indexOf(name);

  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

function readPositiveIntegerOption(
  args: string[],
  name: string
): number | null {
  const value = readOption(args, name);

  if (value === null) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(`Usage: npm run backup -w @aether/server -- [options]

Options:
  -o, --output <dir>   Override the default AETHER_DATA_DIR/backups location.
  --include-cache      Also copy the derivative cache into the backup.
  --keep <count>       Keep only the newest count Aether backup folders.
  -h, --help           Show this help text.
`);
}
