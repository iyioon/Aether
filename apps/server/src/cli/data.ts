import path from "node:path";
import { loadLocalEnv } from "../config/env.js";
import { resolveDataPaths } from "../config/data-directory.js";
import { resolveConfiguredMediaRootPaths } from "../config/config.js";
import {
  getDataDirectoryStatus,
  rebuildDataDirectory,
  wipeDataDirectory
} from "../maintenance/data-directory.js";
import { restoreDataDirectory } from "../maintenance/restore.js";
import {
  createPrivateTemporaryFiles,
  type PrivateTemporaryFiles
} from "../maintenance/private-temporary-files.js";

process.umask(0o077);

const args = process.argv.slice(2);
const command = args[0];

if (!command || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(command ? 0 : 1);
}

const workspaceRoot = loadLocalEnv();
const paths = resolveDataPaths(process.env, workspaceRoot);
const mediaRootPaths = resolveConfiguredMediaRootPaths(
  process.env.AETHER_MEDIA_ROOTS ?? "",
  workspaceRoot
);
let temporaryFiles: PrivateTemporaryFiles | undefined;

try {
  if (command === "status") {
    console.log(JSON.stringify(await getDataDirectoryStatus(paths), null, 2));
  } else if (command === "rebuild") {
    requireConfirmation(args, "--confirm-rebuild", "rebuild");
    await rebuildDataDirectory(paths, workspaceRoot, mediaRootPaths);
    console.log(
      `Aether data was rebuilt. Settings in ${paths.privateEnvPath} were preserved.`
    );
  } else if (command === "wipe") {
    requireConfirmation(args, "--confirm-wipe", "wipe");
    await wipeDataDirectory(paths, workspaceRoot, mediaRootPaths);
    console.log(`Aether data was removed from ${paths.dataDir}.`);
  } else if (command === "restore") {
    requireConfirmation(args, "--confirm-restore", "restore");
    const restoreSource = readOption(args, "--from");
    if (!restoreSource) {
      throw new Error("Restore requires --from <backup-dir>.");
    }
    temporaryFiles = await createPrivateTemporaryFiles(paths);
    const result = await restoreDataDirectory({
      paths,
      workspaceRoot,
      mediaRootPaths,
      backupDir: path.resolve(workspaceRoot, restoreSource)
    });
    console.log(
      `Aether data was restored from a version ${result.manifestVersion} backup. Database version: ${result.databaseVersion}. Cache restored: ${result.restoredCache ? "yes" : "no"}.`
    );
  } else {
    throw new Error(`Unknown data command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await temporaryFiles?.close();
}

function readOption(commandArgs: string[], flag: string): string | null {
  const index = commandArgs.indexOf(flag);
  return index === -1 ? null : (commandArgs[index + 1] ?? null);
}

function requireConfirmation(
  commandArgs: string[],
  flag: string,
  operation: string
): void {
  if (!commandArgs.includes(flag)) {
    throw new Error(
      `Refusing to ${operation} data without ${flag}. Stop Aether, review npm run data:status, then run the command again with that flag.`
    );
  }
}

function printHelp(): void {
  console.log(`Usage: npm run data:<command> [-- <confirmation>]

Commands:
  data:status                         Show the active data directory and sizes.
  data:rebuild -- --confirm-rebuild  Clear the database, cache, and internal backups.
                                     Keep private.env and prepare an empty rebuild.
  data:restore -- --from <dir> --confirm-restore
                                     Replace the database from a verified Aether backup.
                                     Restore its cache only when the backup includes it.
  data:wipe -- --confirm-wipe        Permanently remove the complete data directory.

Stop Aether before running rebuild, restore, or wipe.
`);
}
