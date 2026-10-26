import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";
import { open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { AetherDataPaths } from "../config/data-directory.js";
import { pathExists } from "../config/data-directory.js";

interface RuntimeLock {
  application: "aether";
  hostname: string;
  pid: number;
  processInstanceId?: string;
  processStartedAt?: string;
  startedAt: string;
  updatedAt: string;
  token: string;
  purpose?: "runtime" | "maintenance";
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const SAME_PID_STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 6;
// A PID can be reused after a host or container restart. This identifier lets
// a new process distinguish that abandoned lock from one it owns itself.
const PROCESS_INSTANCE_ID = randomUUID();
const PROCESS_STARTED_AT = new Date(performance.timeOrigin).toISOString();

export async function acquireRuntimeLock(
  paths: AetherDataPaths,
  purpose: "runtime" | "maintenance" = "runtime"
): Promise<() => Promise<void>> {
  await clearStaleRuntimeLock(paths);

  const now = new Date().toISOString();
  const lock: RuntimeLock = {
    application: "aether",
    hostname: hostname(),
    pid: process.pid,
    processInstanceId: PROCESS_INSTANCE_ID,
    processStartedAt: PROCESS_STARTED_AT,
    startedAt: now,
    updatedAt: now,
    token: randomUUID(),
    purpose
  };

  let handle;

  try {
    handle = await open(paths.runtimeLockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
  } catch (error) {
    await handle?.close();

    if (handle) {
      await rm(paths.runtimeLockPath, { force: true });
    }

    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(
        `Aether is already using this data directory: ${paths.dataDir}`
      );
    }

    throw error;
  }

  await handle.close();
  try {
    await removeAbandonedHeartbeatFiles(paths, lock.token);
  } catch (error) {
    const currentLock = await readRuntimeLock(paths.runtimeLockPath);
    if (currentLock?.token === lock.token)
      await rm(paths.runtimeLockPath, { force: true });
    throw error;
  }
  let released = false;
  let pendingHeartbeat = Promise.resolve();
  const heartbeat = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat.then(() =>
      refreshRuntimeLock(paths, lock)
    );
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return async () => {
    if (released) {
      return;
    }

    released = true;
    clearInterval(heartbeat);
    await pendingHeartbeat;

    try {
      const currentLock = await readRuntimeLock(paths.runtimeLockPath);
      if (currentLock?.token === lock.token) {
        await rm(paths.runtimeLockPath, { force: true });
      }
    } catch {
      // The process is already shutting down. A stale lock is recoverable on
      // the next start, so release failures must not mask the original error.
    }
  };
}

async function removeAbandonedHeartbeatFiles(
  paths: AetherDataPaths,
  currentToken: string
): Promise<void> {
  const lockName = path.basename(paths.runtimeLockPath);
  const pattern =
    /^runtime\.lock\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/;
  // The new lock is exclusive and its heartbeat has not started yet.
  for (const entry of await readdir(paths.dataDir, { withFileTypes: true })) {
    if (
      !pattern.test(entry.name) ||
      entry.name === `${lockName}.${currentToken}.tmp`
    )
      continue;
    if (entry.isFile() || entry.isSymbolicLink())
      await rm(path.join(paths.dataDir, entry.name), { force: true });
  }
}

/** Online backups may share a runtime, but never an offline maintenance swap. */
export async function assertNoMaintenanceInProgress(
  paths: AetherDataPaths
): Promise<void> {
  if (!(await pathExists(paths.runtimeLockPath))) return;
  const lock = await readRuntimeLock(paths.runtimeLockPath);
  if (!lock)
    throw new Error(
      "Cannot verify whether maintenance is active. Stop Aether and retry the backup."
    );
  if (!lock.purpose || lock.purpose === "maintenance") {
    await assertDataDirectoryInactive(paths);
    return;
  }
}

export async function assertDataDirectoryInactive(
  paths: AetherDataPaths
): Promise<void> {
  if (!(await pathExists(paths.runtimeLockPath))) {
    return;
  }

  const lock = await readRuntimeLock(paths.runtimeLockPath);

  if (!lock) {
    throw new Error(
      `Cannot verify whether Aether is stopped. Inspect and remove ${paths.runtimeLockPath} only after confirming the server is not running.`
    );
  }

  if (lock.hostname !== hostname()) {
    throw new Error(
      `Aether's data directory is locked by host ${lock.hostname}. Stop that instance before using this data directory. If that host no longer exists, inspect and remove ${paths.runtimeLockPath} manually.`
    );
  }

  if (
    lock.pid === process.pid &&
    lock.processInstanceId !== PROCESS_INSTANCE_ID
  ) {
    const definitelyCurrentProcess =
      lock.processStartedAt === PROCESS_STARTED_AT;

    if (
      !definitelyCurrentProcess &&
      hasExpiredSamePidHeartbeat(lock.updatedAt)
    ) {
      await rm(paths.runtimeLockPath, { force: true });
      return;
    }
  }

  if (isProcessRunning(lock.pid)) {
    throw new Error(
      `Aether is running with process ID ${lock.pid}. Stop it before resetting data.`
    );
  }

  await rm(paths.runtimeLockPath, { force: true });
}

async function refreshRuntimeLock(
  paths: AetherDataPaths,
  lock: RuntimeLock
): Promise<void> {
  const temporaryPath = `${paths.runtimeLockPath}.${lock.token}.tmp`;

  try {
    const currentLock = await readRuntimeLock(paths.runtimeLockPath);
    if (currentLock?.token !== lock.token) {
      return;
    }

    lock.updatedAt = new Date().toISOString();
    await rm(temporaryPath, { force: true });
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, paths.runtimeLockPath);
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    // A failed heartbeat makes the lock conservative: reset commands will
    // refuse it until the server exits or it becomes verifiably stale.
  }
}

async function clearStaleRuntimeLock(paths: AetherDataPaths): Promise<void> {
  await assertDataDirectoryInactive(paths);
}

async function readRuntimeLock(filePath: string): Promise<RuntimeLock | null> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;

    if (
      isRecord(value) &&
      value.application === "aether" &&
      typeof value.hostname === "string" &&
      typeof value.pid === "number" &&
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      (value.processInstanceId === undefined ||
        typeof value.processInstanceId === "string") &&
      (value.processStartedAt === undefined ||
        typeof value.processStartedAt === "string") &&
      typeof value.startedAt === "string" &&
      typeof value.updatedAt === "string" &&
      typeof value.token === "string" &&
      (value.purpose === undefined ||
        value.purpose === "runtime" ||
        value.purpose === "maintenance")
    ) {
      return value as unknown as RuntimeLock;
    }

    return null;
  } catch {
    return null;
  }
}

function hasExpiredSamePidHeartbeat(updatedAt: string): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs > SAME_PID_STALE_AFTER_MS;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
