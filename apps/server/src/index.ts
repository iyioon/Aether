import { loadConfig } from "./config/config.js";
import {
  initializeDataDirectory,
  resolveDataPaths
} from "./config/data-directory.js";
import { loadPrivateEnv, loadProjectEnv } from "./config/env.js";
import { openDatabase } from "./db/database.js";
import type { buildApp as BuildApp } from "./http/app.js";
import { acquireRuntimeLock } from "./maintenance/runtime-lock.js";
import { closeServerRuntime } from "./maintenance/server-runtime.js";
import {
  createPrivateTemporaryFiles,
  removeAbandonedTemporaryFiles,
  type PrivateTemporaryFiles
} from "./maintenance/private-temporary-files.js";
import { prepareRestoreStateForStartup } from "./maintenance/restore-recovery.js";
import {
  startupFailureMessage,
  type StartupStage
} from "./maintenance/startup-failure.js";

// Every runtime file created by the server is private by default. Explicit
// modes in the data/cache helpers provide the same protection to CLI paths.
process.umask(0o077);

let app: Awaited<ReturnType<typeof BuildApp>> | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
let temporaryFiles: PrivateTemporaryFiles | undefined;
let releaseRuntimeLock: (() => Promise<void>) | undefined;
let shuttingDown = false;

async function closeRuntimeResources(): Promise<void> {
  const application = app;
  const database = db;
  const releaseLock = releaseRuntimeLock;
  const temporary = temporaryFiles;

  // Clear the shared references first so concurrent failure paths cannot close
  // the same resource twice. closeServerRuntime still attempts every step.
  app = undefined;
  db = undefined;
  releaseRuntimeLock = undefined;
  temporaryFiles = undefined;

  await closeServerRuntime({
    closeApplication: async () => {
      await application?.close();
    },
    closeDatabase: () => {
      database?.close();
    },
    releaseLock: async () => {
      try {
        await temporary?.close();
      } finally {
        await releaseLock?.();
      }
    }
  });
}

function reportStartupFailure(stage: StartupStage, error: unknown): void {
  const message = startupFailureMessage(stage, error);

  if (app) {
    app.log.error(message);
    return;
  }

  process.stderr.write(`${message}\n`);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  const logger = app?.log;
  logger?.info({ signal }, "server shutdown started");

  try {
    await closeRuntimeResources();
  } catch {
    if (logger) {
      logger.error("server shutdown failed");
    } else {
      process.stderr.write("Aether server shutdown failed.\n");
    }
    process.exitCode = 1;
  }
}

async function start(): Promise<void> {
  let stage: StartupStage = "environment";
  try {
    const rootDir = loadProjectEnv();
    const dataPaths = resolveDataPaths(process.env, rootDir);
    stage = "data directory";
    await initializeDataDirectory(dataPaths);
    stage = "runtime lock";
    releaseRuntimeLock = await acquireRuntimeLock(dataPaths);
    stage = "private settings";
    loadPrivateEnv(rootDir);

    const privateDataPaths = resolveDataPaths(process.env, rootDir);
    if (privateDataPaths.dataDir !== dataPaths.dataDir) {
      throw new Error(
        "AETHER_DATA_DIR cannot be changed from inside private.env."
      );
    }

    stage = "restore recovery";
    await prepareRestoreStateForStartup(dataPaths);
    stage = "temporary files";
    await removeAbandonedTemporaryFiles(dataPaths);
    temporaryFiles = await createPrivateTemporaryFiles(dataPaths);
    stage = "configuration";
    const config = await loadConfig(process.env, rootDir);
    stage = "database";
    db = openDatabase(config.configDir);
    stage = "application setup";
    const { buildApp } = await import("./http/app.js");
    app = await buildApp({ config, db });

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    stage = "API listener";
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    reportStartupFailure(stage, error);
    await closeRuntimeResources().catch(() => {
      process.stderr.write("Aether could not finish startup cleanup.\n");
    });
    process.exitCode = 1;
  }
}

await start();
