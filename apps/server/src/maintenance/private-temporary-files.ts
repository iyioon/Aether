import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, opendir, rm } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { AetherDataPaths } from "../config/data-directory.js";
import { requireDataDirectoryMarker } from "../config/data-directory.js";

const hostKey = createHash("sha256")
  .update(hostname())
  .digest("hex")
  .slice(0, 16);
const scopePattern = /^scope-([a-f0-9]{16})-([1-9][0-9]*)-[a-f0-9-]{36}$/;
const temporaryEnvironmentKeys = ["TMPDIR", "TMP", "TEMP"] as const;
const MAX_TEMPORARY_SCOPES = 4096;
const PROCESS_STARTED_AT_MS = performance.timeOrigin;
const FILESYSTEM_CLOCK_TOLERANCE_MS = 2000;

export interface PrivateTemporaryFiles {
  directory: string;
  close: () => Promise<void>;
}

/** Configure only process entry points, before loading native image libraries. */
export async function createPrivateTemporaryFiles(
  paths: AetherDataPaths,
  env: NodeJS.ProcessEnv = process.env
): Promise<PrivateTemporaryFiles> {
  await requireTemporaryDirectory(paths);
  const directory = path.join(
    paths.tempDir,
    `scope-${hostKey}-${process.pid}-${randomUUID()}`
  );
  await mkdir(directory, { mode: 0o700 });
  const previous = temporaryEnvironmentKeys.map((key) => env[key]);
  for (const key of temporaryEnvironmentKeys) env[key] = directory;
  let closed = false;
  return {
    directory,
    close: async () => {
      if (closed) return;
      closed = true;
      for (let index = 0; index < temporaryEnvironmentKeys.length; index += 1) {
        const key = temporaryEnvironmentKeys[index]!;
        if (env[key] !== directory) continue;
        const value = previous[index];
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      try {
        await requireDataDirectoryMarker(paths);
      } catch {
        return;
      }
      await requireTemporaryDirectory(paths);
      await rm(directory, { recursive: true, force: true });
    }
  };
}

/** Call with the exclusive runtime/maintenance lock; live backup scopes survive. */
export async function removeAbandonedTemporaryFiles(
  paths: AetherDataPaths
): Promise<void> {
  await requireTemporaryDirectory(paths);
  for (const entry of await readTemporaryScopes(paths)) {
    const match = scopePattern.exec(entry);
    if (!match || match[1] !== hostKey) continue;
    const pid = Number(match[2]);
    if (!Number.isSafeInteger(pid)) continue;
    if (
      isProcessAlive(pid) &&
      !(await isPreviousCurrentProcessScope(paths, entry, pid))
    )
      continue;
    await rm(path.join(paths.tempDir, entry), { recursive: true, force: true });
  }
}

async function isPreviousCurrentProcessScope(
  paths: AetherDataPaths,
  entry: string,
  pid: number
): Promise<boolean> {
  if (pid !== process.pid) return false;
  const info = await lstat(path.join(paths.tempDir, entry));
  // Container restarts often reuse PID 1. Keep coarse or uncertain timestamps
  // rather than mistaking a live scope for an old instance of this process.
  const createdAt = info.birthtimeMs > 0 ? info.birthtimeMs : info.ctimeMs;
  return (
    info.isDirectory() &&
    Number.isFinite(createdAt) &&
    createdAt < PROCESS_STARTED_AT_MS - FILESYSTEM_CLOCK_TOLERANCE_MS
  );
}

/** Recheck after taking the maintenance lock; a backup registers before rechecking it. */
export async function assertNoOtherTemporaryWork(
  paths: AetherDataPaths
): Promise<void> {
  await requireTemporaryDirectory(paths);
  for (const entry of await readTemporaryScopes(paths)) {
    const match = scopePattern.exec(entry);
    if (!match) continue;
    const pid = Number(match[2]);
    if (match[1] !== hostKey || (pid !== process.pid && isProcessAlive(pid))) {
      throw new Error(
        "Another Aether process has temporary work in progress. Stop backup and processing commands before maintenance."
      );
    }
  }
}

async function readTemporaryScopes(paths: AetherDataPaths): Promise<string[]> {
  const entries: string[] = [];
  for await (const entry of await opendir(paths.tempDir)) {
    if (entries.length >= MAX_TEMPORARY_SCOPES)
      throw new Error(
        "Too many Aether temporary scopes to verify safely. Inspect the temporary directory before maintenance."
      );
    entries.push(entry.name);
  }
  return entries;
}

async function requireTemporaryDirectory(
  paths: AetherDataPaths
): Promise<void> {
  await requireDataDirectoryMarker(paths);
  await mkdir(paths.tempDir, { mode: 0o700 }).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  });
  const stats = await lstat(paths.tempDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Aether temporary files require a real managed directory.");
  }
  await chmod(paths.tempDir, 0o700);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
