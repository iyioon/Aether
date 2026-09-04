import path from "node:path";
import { loadLocalEnv } from "../config/env.js";
import { createConfigBackup } from "../maintenance/backup.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const rootDir = loadLocalEnv();
const outputDir = path.resolve(
  rootDir,
  readOption(args, "--output") ??
    readOption(args, "-o") ??
    process.env.AETHER_BACKUP_DIR ??
    "./backups"
);
const configDir = path.resolve(
  rootDir,
  process.env.AETHER_CONFIG_DIR ?? "./config"
);
const cacheDir = path.resolve(rootDir, process.env.AETHER_CACHE_DIR ?? "./cache");
const includeCache = args.includes("--include-cache");

try {
  const keep = readPositiveIntegerOption(args, "--keep") ?? undefined;
  const result = await createConfigBackup({
    configDir,
    outputDir,
    cacheDir,
    includeCache,
    keep
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function readOption(args: string[], name: string): string | null {
  const index = args.indexOf(name);

  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

function readPositiveIntegerOption(args: string[], name: string): number | null {
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
  -o, --output <dir>   Directory where timestamped backups are written.
  --include-cache      Also copy the derivative cache into the backup.
  --keep <count>       Keep only the newest count Aether backup folders.
  -h, --help           Show this help text.
`);
}
