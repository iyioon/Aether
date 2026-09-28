import { randomBytes } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { MediaRootConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { detectMediaType } from "./media-types.js";
import {
  folderIdFor,
  refreshFolderAssetCounts,
  removeUnseenRootEntries,
  syncConfiguredRoots,
  updateAssetDimensions,
  upsertAsset,
  upsertFolder
} from "./repository.js";

export interface ScanResult {
  roots: number;
  folders: number;
  assets: number;
  skipped: number;
  errors: number;
  removedAssets: number;
  removedFolders: number;
  startedAt: string;
  finishedAt: string;
}

export interface ScanJobSummary {
  id: string;
  status: "running" | "completed" | "failed";
}

export interface ScanProgress {
  phase: "discovering" | "scanning" | "finalizing";
  processed: number;
  total: number | null;
  percent: number | null;
  currentPath: string | null;
}

export interface StartScanOptions {
  queueIfRunning?: boolean;
}

interface ScanCounters {
  folders: number;
  assets: number;
  skipped: number;
  errors: number;
  removedAssets: number;
  removedFolders: number;
}

interface DiscoveredEntry {
  name: string;
  relativePath: string;
  kind: "directory" | "file" | "symlink" | "other";
  hidden: boolean;
  child: DiscoveredDirectory | null;
}

interface DiscoveredDirectory {
  entries: DiscoveredEntry[];
  readFailed: boolean;
}

interface DiscoveredRoot {
  root: MediaRootConfig;
  directory: DiscoveredDirectory;
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  error: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export class LibraryScanner {
  private running: Promise<ScanResult> | null = null;
  private runningJobId: string | null = null;
  private rerunRequested = false;
  private progress: ScanProgress | null = null;

  constructor(
    private readonly db: AetherDatabase,
    private readonly roots: MediaRootConfig[]
  ) {
    markInterruptedScans(this.db);
    syncConfiguredRoots(this.db, this.roots);
  }

  startScan(options: StartScanOptions = {}): ScanJobSummary {
    if (this.running && this.runningJobId) {
      if (options.queueIfRunning) {
        this.rerunRequested = true;
      }

      return {
        id: this.runningJobId,
        status: "running"
      };
    }

    const jobId = `job_${randomBytes(12).toString("hex")}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs
          (id, type, status, priority, attempts, created_at, updated_at)
         VALUES (?, 'library_scan', 'running', 0, 1, ?, ?)`
      )
      .run(jobId, now, now);

    this.runningJobId = jobId;
    this.progress = createScanProgress("discovering");
    this.running = scanLibrary(this.db, this.roots, (progress) => {
      this.progress = progress;
    })
      .then((result) => {
        this.db
          .prepare(
            `UPDATE jobs
             SET status = 'completed', result = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(JSON.stringify(result), result.finishedAt, jobId);

        return result;
      })
      .catch((error: unknown) => {
        this.db
          .prepare(
            `UPDATE jobs
             SET status = 'failed', error = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(errorMessage(error), new Date().toISOString(), jobId);
        throw error;
      })
      .finally(() => {
        const shouldRerun = this.rerunRequested;
        this.running = null;
        this.runningJobId = null;
        this.progress = null;
        this.rerunRequested = false;

        if (shouldRerun) {
          this.startScan();
        }
      });

    this.running.catch(() => undefined);

    return {
      id: jobId,
      status: "running"
    };
  }

  listJobs(limit = 10): Array<JobRow & { progress: ScanProgress | null }> {
    const jobs = this.db
      .prepare(
        `SELECT id, type, status, priority, attempts, error, result, created_at, updated_at
         FROM jobs
         WHERE type = 'library_scan'
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as JobRow[];

    return jobs.map((job) => ({
      ...job,
      progress: job.id === this.runningJobId ? this.progress : null
    }));
  }
}

export async function scanLibrary(
  db: AetherDatabase,
  roots: MediaRootConfig[],
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const startedAt = new Date().toISOString();
  const counters: ScanCounters = {
    folders: 0,
    assets: 0,
    skipped: 0,
    errors: 0,
    removedAssets: 0,
    removedFolders: 0
  };

  syncConfiguredRoots(db, roots, startedAt);

  onProgress?.(createScanProgress("discovering"));
  const discoveredRoots: DiscoveredRoot[] = [];
  let totalEntries = 0;
  for (const root of roots) {
    const directory = await discoverDirectory(root.realPath, "");
    discoveredRoots.push({ root, directory });
    totalEntries += countDiscoveredEntries(directory);
  }

  let processedEntries = 0;
  onProgress?.({
    phase: "scanning",
    processed: 0,
    total: totalEntries,
    percent: totalEntries === 0 ? 100 : 0,
    currentPath: null
  });

  const reportEntryProcessed = (currentPath: string) => {
    processedEntries += 1;
    onProgress?.({
      phase: "scanning",
      processed: processedEntries,
      total: totalEntries,
      percent:
        totalEntries === 0
          ? 100
          : Math.min(99, Math.round((processedEntries / totalEntries) * 100)),
      currentPath
    });
  };

  for (const { root, directory } of discoveredRoots) {
    const rootFolderId = folderIdFor(root.id, "");
    await scanDiscoveredDirectory(
      db,
      root,
      directory,
      rootFolderId,
      startedAt,
      counters,
      reportEntryProcessed
    );
    const removed = removeUnseenRootEntries(db, root.id, startedAt);
    counters.removedAssets += removed.removedAssets;
    counters.removedFolders += removed.removedFolders;
    refreshFolderAssetCounts(db, root.id);
  }

  onProgress?.({
    phase: "finalizing",
    processed: processedEntries,
    total: totalEntries,
    percent: 100,
    currentPath: null
  });

  return {
    roots: roots.length,
    ...counters,
    startedAt,
    finishedAt: new Date().toISOString()
  };
}

async function scanDiscoveredDirectory(
  db: AetherDatabase,
  root: MediaRootConfig,
  directory: DiscoveredDirectory,
  folderId: string,
  seenAt: string,
  counters: ScanCounters,
  onEntryProcessed?: (currentPath: string) => void
): Promise<void> {
  if (directory.readFailed) {
    counters.errors += 1;
  }

  for (const entry of directory.entries) {
    const { relativePath } = entry;

    if (entry.hidden) {
      counters.skipped += 1;
      onEntryProcessed?.(relativePath);
      continue;
    }

    if (entry.kind === "symlink") {
      counters.skipped += 1;
      onEntryProcessed?.(relativePath);
      continue;
    }

    if (entry.kind === "directory") {
      const childFolderId = upsertFolder(db, {
        rootId: root.id,
        parentId: folderId,
        relativePath,
        name: entry.name,
        seenAt
      });
      counters.folders += 1;
      onEntryProcessed?.(relativePath);
      await scanDiscoveredDirectory(
        db,
        root,
        entry.child ?? { entries: [], readFailed: true },
        childFolderId,
        seenAt,
        counters,
        onEntryProcessed
      );
      continue;
    }

    if (entry.kind !== "file") {
      counters.skipped += 1;
      onEntryProcessed?.(relativePath);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    const mediaInfo = detectMediaType(extension);

    if (!mediaInfo) {
      counters.skipped += 1;
      onEntryProcessed?.(relativePath);
      continue;
    }

    const absoluteFilePath = path.join(root.realPath, relativePath);
    const fileStat = await stat(absoluteFilePath).catch(() => null);

    if (!fileStat?.isFile()) {
      counters.errors += 1;
      onEntryProcessed?.(relativePath);
      continue;
    }

    const assetId = upsertAsset(db, {
      rootId: root.id,
      folderId,
      relativePath,
      name: entry.name,
      extension,
      mediaType: mediaInfo.mediaType,
      mimeType: mediaInfo.mimeType,
      sizeBytes: fileStat.size,
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      fingerprint: `${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}`,
      seenAt
    });

    if (mediaInfo.mediaType === "image") {
      const dimensions = await readImageDimensions(absoluteFilePath);

      if (dimensions) {
        updateAssetDimensions(db, assetId, dimensions.width, dimensions.height);
      }
    }

    counters.assets += 1;
    onEntryProcessed?.(relativePath);
  }
}

async function discoverDirectory(
  absoluteDirectory: string,
  relativeDirectory: string
): Promise<DiscoveredDirectory> {
  const entries = await readdir(absoluteDirectory, {
    withFileTypes: true
  }).catch(() => null);

  if (!entries) {
    return { entries: [], readFailed: true };
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  const discoveredEntries: DiscoveredEntry[] = [];

  for (const entry of entries) {
    const relativePath = toRelativeMediaPath(relativeDirectory, entry.name);
    const hidden = entry.name.startsWith(".");
    const kind = entry.isSymbolicLink()
      ? "symlink"
      : entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other";
    const child =
      kind === "directory" && !hidden
        ? await discoverDirectory(
            path.join(absoluteDirectory, entry.name),
            relativePath
          )
        : null;

    discoveredEntries.push({
      name: entry.name,
      relativePath,
      kind,
      hidden,
      child
    });
  }

  return { entries: discoveredEntries, readFailed: false };
}

function countDiscoveredEntries(directory: DiscoveredDirectory): number {
  return directory.entries.reduce(
    (count, entry) =>
      count + 1 + (entry.child ? countDiscoveredEntries(entry.child) : 0),
    0
  );
}

function createScanProgress(phase: ScanProgress["phase"]): ScanProgress {
  return {
    phase,
    processed: 0,
    total: null,
    percent: null,
    currentPath: null
  };
}

async function readImageDimensions(
  absoluteFilePath: string
): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(absoluteFilePath, {
      failOn: "none",
      limitInputPixels: 268_402_689
    }).metadata();
    const width = positiveIntegerOrNull(metadata.width);
    const height = positiveIntegerOrNull(metadata.height);

    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

function positiveIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function toRelativeMediaPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function markInterruptedScans(db: AetherDatabase): void {
  db.prepare(
    `UPDATE jobs
     SET status = 'failed',
         error = 'Scan was interrupted before completion.',
         updated_at = ?
     WHERE type = 'library_scan' AND status = 'running'`
  ).run(new Date().toISOString());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown scan failure.";
}
