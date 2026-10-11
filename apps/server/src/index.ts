import { loadConfig } from "./config/config.js";
import {
  initializeDataDirectory,
  resolveDataPaths
} from "./config/data-directory.js";
import { loadPrivateEnv, loadProjectEnv } from "./config/env.js";
import { openDatabase } from "./db/database.js";
import { buildApp } from "./http/app.js";
import { acquireRuntimeLock } from "./maintenance/runtime-lock.js";
import { closeServerRuntime } from "./maintenance/server-runtime.js";

// Every runtime file created by the server is private by default. Explicit
// modes in the data/cache helpers provide the same protection to CLI paths.
process.umask(0o077);

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
let releaseRuntimeLock: (() => Promise<void>) | undefined;
let shuttingDown = false;

async function closeRuntimeResources(): Promise<void> {
  const application = app;
  const database = db;
  const releaseLock = releaseRuntimeLock;

  // Clear the shared references first so concurrent failure paths cannot close
  // the same resource twice. closeServerRuntime still attempts every step.
  app = undefined;
  db = undefined;
  releaseRuntimeLock = undefined;

  await closeServerRuntime({
    closeApplication: async () => {
      await application?.close();
    },
    closeDatabase: () => {
      database?.close();
    },
    releaseLock: async () => {
      await releaseLock?.();
    }
  });
}

function reportStartupFailure(): void {
  const message =
    "Aether server failed to start. Check its configuration, data directory, and whether another instance is running.";

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
  try {
    const rootDir = loadProjectEnv();
    const dataPaths = resolveDataPaths(process.env, rootDir);
    await initializeDataDirectory(dataPaths);
    releaseRuntimeLock = await acquireRuntimeLock(dataPaths);
    loadPrivateEnv(rootDir);

    const privateDataPaths = resolveDataPaths(process.env, rootDir);
    if (privateDataPaths.dataDir !== dataPaths.dataDir) {
      throw new Error(
        "AETHER_DATA_DIR cannot be changed from inside private.env."
      );
    }

    const config = await loadConfig(process.env, rootDir);
    db = openDatabase(config.configDir);
    app = await buildApp({ config, db });

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    await app.listen({ host: config.host, port: config.port });
  } catch {
    reportStartupFailure();
    await closeRuntimeResources().catch(() => {
      process.stderr.write("Aether could not finish startup cleanup.\n");
    });
    process.exitCode = 1;
  }
}

await start();
