import { createHash, randomBytes } from "node:crypto";
import { createReadStream, type BigIntStats, type Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { MediaRootConfig } from "../config/config.js";
import { checkpointDatabase, type AetherDatabase } from "../db/database.js";
import {
  removeAssetDerivativeCache,
  sweepDerivativeCache
} from "./derivative-cache.js";
import { detectMediaType } from "./media-types.js";
import {
  folderIdFor,
  listStoredAssetIdentities,
  reconcileScannedLibrary,
  syncConfiguredRoots,
  type ScannedAssetInput,
  type StoredAssetIdentity,
  type UpsertFolderInput
} from "./repository.js";

export interface ScanResult {
  outcome: "completed" | "incomplete";
  incompleteReason: "source_changed_or_unavailable" | null;
  warnings: ScanWarning[];
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

export type ScanWarning = "derivative_cache_cleanup_failed";

export type ScanJobStatus = "running" | "completed" | "incomplete" | "failed";

export interface ScanJobSummary {
  id: string;
  status: ScanJobStatus;
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
  warnings: ScanWarning[];
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
  snapshot: DirectorySnapshot | null;
}

interface DiscoveredRoot {
  root: MediaRootConfig;
  directory: DiscoveredDirectory;
}

interface DirectorySnapshot {
  absolutePath: string;
  fingerprint: string;
  fileSystemIdentity: FileSystemIdentity;
  entriesSignature: string;
}

export interface ScanHooks {
  afterDirectorySnapshot?: (
    absolutePath: string,
    relativePath: string
  ) => Promise<void> | void;
}

interface ObservedAsset {
  id: string | null;
  rootId: string;
  rootRealPath: string;
  folderId: string;
  relativePath: string;
  absolutePath: string;
  name: string;
  extension: string;
  mediaType: ScannedAssetInput["mediaType"];
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  fingerprint: string;
  contentSha256: string;
  fsDeviceId: string | null;
  fsInode: string | null;
  fsBirthtimeNs: string | null;
  fsCtimeNs: string | null;
}

type FileSystemIdentity = Pick<
  ObservedAsset,
  "fsDeviceId" | "fsInode" | "fsBirthtimeNs" | "fsCtimeNs"
>;

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
  private runningAbortController: AbortController | null = null;
  private runningJobId: string | null = null;
  private rerunRequested = false;
  private progress: ScanProgress | null = null;
  private stopping = false;

  constructor(
    private readonly db: AetherDatabase,
    private readonly roots: MediaRootConfig[],
    private readonly cacheDir?: string
  ) {
    markInterruptedScans(this.db);
    pruneScanJobHistory(this.db);
    syncConfiguredRoots(this.db, this.roots);
  }

  startScan(options: StartScanOptions = {}): ScanJobSummary {
    if (this.stopping) {
      throw new Error("The library scanner is stopping.");
    }

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
    const abortController = new AbortController();
    this.runningAbortController = abortController;
    this.running = scanLibrary(
      this.db,
      this.roots,
      (progress) => {
        this.progress = progress;
      },
      this.cacheDir,
      abortController.signal
    )
      .then((result) => {
        const status: ScanJobStatus =
          result.outcome === "incomplete" ? "incomplete" : "completed";
        this.db
          .prepare(
            `UPDATE jobs
             SET status = ?, result = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(status, JSON.stringify(result), result.finishedAt, jobId);

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
        if (this.runningAbortController === abortController) {
          this.runningAbortController = null;
        }
        this.runningJobId = null;
        this.progress = null;
        this.rerunRequested = false;
        pruneScanJobHistory(this.db);

        if (shouldRerun && !this.stopping) {
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

  async stop(): Promise<void> {
    this.stopping = true;
    this.rerunRequested = false;
    this.runningAbortController?.abort();
    await this.running?.catch(() => undefined);
  }
}

export async function scanLibrary(
  db: AetherDatabase,
  roots: MediaRootConfig[],
  onProgress?: (progress: ScanProgress) => void,
  cacheDir?: string,
  signal?: AbortSignal,
  hooks?: ScanHooks
): Promise<ScanResult> {
  throwIfScanAborted(signal);
  const startedAt = new Date().toISOString();
  const scanMarker = `${startedAt.slice(0, -1)}${randomBytes(4)
    .readUInt32BE(0)
    .toString()
    .padStart(10, "0")}Z`;
  const counters: ScanCounters = {
    folders: 0,
    assets: 0,
    skipped: 0,
    errors: 0,
    removedAssets: 0,
    removedFolders: 0,
    warnings: []
  };
  let reconciled = false;

  onProgress?.(createScanProgress("discovering"));
  const discoveredRoots: DiscoveredRoot[] = [];
  let totalEntries = 0;
  for (const root of roots) {
    throwIfScanAborted(signal);
    const directory = await discoverDirectory(root.realPath, "", signal, hooks);
    throwIfScanAborted(signal);
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

  const storedAssets = listStoredAssetIdentities(db);
  const storedByConfiguredLocation = new Map<string, StoredAssetIdentity>();
  const storedByRealLocation = new Map<string, StoredAssetIdentity>();
  for (const asset of storedAssets) {
    storedByConfiguredLocation.set(
      locationKey(asset.rootId, asset.relativePath),
      asset
    );
    storedByRealLocation.set(
      locationKey(asset.rootRealPath, asset.relativePath),
      asset
    );
  }

  const folders: UpsertFolderInput[] = [];
  const observedAssets: ObservedAsset[] = [];
  for (const { root, directory } of discoveredRoots) {
    await collectDiscoveredDirectory({
      root,
      directory,
      folderId: folderIdFor(root.id, ""),
      scanMarker,
      counters,
      folders,
      assets: observedAssets,
      storedByConfiguredLocation,
      storedByRealLocation,
      onEntryProcessed: reportEntryProcessed,
      signal
    });
  }

  throwIfScanAborted(signal);
  if (roots.length === 0 && storedAssets.length > 0) {
    counters.errors += 1;
  }

  if (counters.errors === 0) {
    throwIfScanAborted(signal);
    assignStableAssetIds(observedAssets, storedAssets);
    const scannedAssets = await buildScannedAssetInputs(
      observedAssets,
      storedAssets,
      scanMarker,
      signal
    );
    counters.errors += await countChangedObservations(observedAssets, signal);
    counters.errors += await countChangedDirectories(discoveredRoots, signal);

    if (counters.errors === 0) {
      // Reconciliation contains all deletions and identity moves. Never enter
      // it after shutdown cancellation; discovery remains an all-or-nothing
      // precondition for mutating the live library.
      throwIfScanAborted(signal);
      const removed = reconcileScannedLibrary(
        db,
        roots,
        folders,
        scannedAssets,
        scanMarker
      );
      counters.removedAssets = removed.removedAssets;
      counters.removedFolders = removed.removedFolders;
      reconciled = true;

      if (removed.removedAssets > 0) {
        checkpointDatabase(db);
      }

      if (cacheDir) {
        try {
          await removeAssetDerivativeCache(cacheDir, removed.removedAssetIds);
          await sweepDerivativeCache(db, cacheDir);
        } catch {
          // Database reconciliation has already committed. Report the cleanup
          // warning in the completed scan result; a later scan/startup sweep
          // can retry without misreporting the library update as rolled back.
          counters.warnings.push("derivative_cache_cleanup_failed");
        }
      }
    }
  }

  onProgress?.({
    phase: "finalizing",
    processed: processedEntries,
    total: totalEntries,
    percent: 100,
    currentPath: null
  });

  return {
    outcome: reconciled ? "completed" : "incomplete",
    incompleteReason: reconciled ? null : "source_changed_or_unavailable",
    roots: roots.length,
    ...counters,
    startedAt,
    finishedAt: new Date().toISOString()
  };
}

interface CollectDirectoryInput {
  root: MediaRootConfig;
  directory: DiscoveredDirectory;
  folderId: string;
  scanMarker: string;
  counters: ScanCounters;
  folders: UpsertFolderInput[];
  assets: ObservedAsset[];
  storedByConfiguredLocation: Map<string, StoredAssetIdentity>;
  storedByRealLocation: Map<string, StoredAssetIdentity>;
  onEntryProcessed?: (currentPath: string) => void;
  signal?: AbortSignal;
}

async function collectDiscoveredDirectory(
  input: CollectDirectoryInput
): Promise<void> {
  const {
    root,
    directory,
    folderId,
    scanMarker,
    counters,
    folders,
    assets,
    storedByConfiguredLocation,
    storedByRealLocation,
    onEntryProcessed,
    signal
  } = input;

  throwIfScanAborted(signal);
  if (directory.readFailed) {
    counters.errors += 1;
    return;
  }

  for (const entry of directory.entries) {
    throwIfScanAborted(signal);
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
      const childFolderId = folderIdFor(root.id, relativePath);
      folders.push({
        rootId: root.id,
        parentId: folderId,
        relativePath,
        name: entry.name,
        seenAt: scanMarker
      });
      counters.folders += 1;
      onEntryProcessed?.(relativePath);
      await collectDiscoveredDirectory({
        root,
        directory: entry.child ?? {
          entries: [],
          readFailed: true,
          snapshot: null
        },
        folderId: childFolderId,
        scanMarker,
        counters,
        folders,
        assets,
        storedByConfiguredLocation,
        storedByRealLocation,
        onEntryProcessed,
        signal
      });
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
    const fileStat = await stat(absoluteFilePath, { bigint: true }).catch(
      () => null
    );
    throwIfScanAborted(signal);

    if (!fileStat?.isFile()) {
      counters.errors += 1;
      onEntryProcessed?.(relativePath);
      continue;
    }

    const sizeBytes = safeStatNumber(fileStat.size);
    const mtimeMs = safeStatNumber(fileStat.mtimeNs / 1_000_000n);
    if (sizeBytes === null || mtimeMs === null) {
      counters.errors += 1;
      onEntryProcessed?.(relativePath);
      continue;
    }
    const fingerprint = fileFingerprint(fileStat);
    const fileSystemIdentity = fileSystemIdentityFromStat(fileStat);
    const configuredLocation = storedByConfiguredLocation.get(
      locationKey(root.id, relativePath)
    );
    const stored =
      (configuredLocation?.rootRealPath === root.realPath
        ? configuredLocation
        : undefined) ??
      storedByRealLocation.get(locationKey(root.realPath, relativePath));
    let contentSha256: string;

    if (
      stored?.contentSha256 &&
      stored.fingerprint === fingerprint &&
      sameFileSystemIdentity(stored, fileSystemIdentity)
    ) {
      contentSha256 = stored.contentSha256;
    } else {
      const hashed = await hashStableFile(
        absoluteFilePath,
        fingerprint,
        fileSystemIdentity,
        signal
      );
      throwIfScanAborted(signal);
      if (!hashed) {
        counters.errors += 1;
        onEntryProcessed?.(relativePath);
        continue;
      }
      contentSha256 = hashed;
    }

    assets.push({
      id: null,
      rootId: root.id,
      rootRealPath: root.realPath,
      folderId,
      relativePath,
      absolutePath: absoluteFilePath,
      name: entry.name,
      extension,
      mediaType: mediaInfo.mediaType,
      mimeType: mediaInfo.mimeType,
      sizeBytes,
      mtimeMs,
      fingerprint,
      contentSha256,
      ...fileSystemIdentity
    });

    counters.assets += 1;
    onEntryProcessed?.(relativePath);
  }
}

function assignStableAssetIds(
  observations: ObservedAsset[],
  storedAssets: StoredAssetIdentity[]
): void {
  const oldByConfiguredLocation = new Map<string, StoredAssetIdentity>();
  const oldByRealLocation = new Map<string, StoredAssetIdentity>();
  const oldById = new Map(storedAssets.map((asset) => [asset.id, asset]));
  const assignedOldIds = new Set<string>();

  for (const asset of storedAssets) {
    oldByConfiguredLocation.set(
      locationKey(asset.rootId, asset.relativePath),
      asset
    );
    oldByRealLocation.set(
      locationKey(asset.rootRealPath, asset.relativePath),
      asset
    );
  }

  // Same location wins first only when stored filesystem evidence does not
  // contradict it. This keeps a v15 row stable during its first baseline scan,
  // while allowing two byte-identical files that swap paths to follow their
  // actual device/inode identities instead of inheriting each other's metadata.
  // A named root relocated to another volume is the narrow exception: the
  // stable root ID, unchanged relative path, and matching strong hash identify
  // each file even though every filesystem identity necessarily changed.
  for (const observation of observations) {
    const configuredLocation = oldByConfiguredLocation.get(
      locationKey(observation.rootId, observation.relativePath)
    );
    const candidate =
      configuredLocation ??
      oldByRealLocation.get(
        locationKey(observation.rootRealPath, observation.relativePath)
      );

    const candidateIdentity = candidate
      ? fileSystemIdentityKey(candidate)
      : null;
    const observationIdentity = fileSystemIdentityKey(observation);
    const contentMatches =
      candidate !== undefined &&
      ((candidate.contentSha256 === null &&
        candidate.sizeBytes === observation.sizeBytes &&
        candidate.mtimeMs === observation.mtimeMs) ||
        candidate.contentSha256 === observation.contentSha256);
    const isNamedRootRelocation =
      candidate !== undefined &&
      candidate.rootId === observation.rootId &&
      candidate.relativePath === observation.relativePath &&
      candidate.rootRealPath !== observation.rootRealPath &&
      candidate.contentSha256 !== null &&
      candidate.contentSha256 === observation.contentSha256;
    const locationEvidenceIsCompatible =
      isNamedRootRelocation ||
      candidateIdentity === null ||
      observationIdentity === null ||
      candidateIdentity === observationIdentity;

    if (
      candidate &&
      !assignedOldIds.has(candidate.id) &&
      contentMatches &&
      locationEvidenceIsCompatible
    ) {
      observation.id = candidate.id;
      assignedOldIds.add(candidate.id);
    }
  }

  const unmatchedOldByFileSystemIdentity = new Map<
    string,
    StoredAssetIdentity[]
  >();
  for (const asset of oldById.values()) {
    if (assignedOldIds.has(asset.id)) {
      continue;
    }
    const identity = fileSystemIdentityKey(asset);
    if (!identity) {
      continue;
    }
    const matches = unmatchedOldByFileSystemIdentity.get(identity) ?? [];
    matches.push(asset);
    unmatchedOldByFileSystemIdentity.set(identity, matches);
  }

  const unmatchedObservationsByFileSystemIdentity = new Map<
    string,
    ObservedAsset[]
  >();
  for (const observation of observations) {
    if (observation.id) {
      continue;
    }
    const identity = fileSystemIdentityKey(observation);
    if (!identity) {
      continue;
    }
    const matches =
      unmatchedObservationsByFileSystemIdentity.get(identity) ?? [];
    matches.push(observation);
    unmatchedObservationsByFileSystemIdentity.set(identity, matches);
  }

  // Filesystem identity is considered only for a unique one-old/one-new pair,
  // and the strong content hash must still agree. Birth time protects against
  // inode reuse where the filesystem exposes it; unchanged ctime is a cautious
  // fallback on filesystems that do not expose birth time.
  for (const [
    identity,
    unmatchedObservations
  ] of unmatchedObservationsByFileSystemIdentity) {
    const unmatchedOld = unmatchedOldByFileSystemIdentity.get(identity) ?? [];
    if (
      unmatchedOld.length === 1 &&
      unmatchedObservations.length === 1 &&
      unmatchedOld[0]!.contentSha256 !== null &&
      unmatchedOld[0]!.contentSha256 === unmatchedObservations[0]!.contentSha256
    ) {
      unmatchedObservations[0]!.id = unmatchedOld[0]!.id;
      assignedOldIds.add(unmatchedOld[0]!.id);
    }
  }

  const unmatchedOldByHash = new Map<string, StoredAssetIdentity[]>();
  for (const asset of oldById.values()) {
    if (!asset.contentSha256 || assignedOldIds.has(asset.id)) {
      continue;
    }
    const matches = unmatchedOldByHash.get(asset.contentSha256) ?? [];
    matches.push(asset);
    unmatchedOldByHash.set(asset.contentSha256, matches);
  }

  const unmatchedObservationsByHash = new Map<string, ObservedAsset[]>();
  for (const observation of observations) {
    if (observation.id) {
      continue;
    }
    const matches =
      unmatchedObservationsByHash.get(observation.contentSha256) ?? [];
    matches.push(observation);
    unmatchedObservationsByHash.set(observation.contentSha256, matches);
  }

  // Transfer metadata only for an unambiguous one-old/one-new content match.
  for (const [
    contentHash,
    unmatchedObservations
  ] of unmatchedObservationsByHash) {
    const unmatchedOld = unmatchedOldByHash.get(contentHash) ?? [];
    if (unmatchedOld.length === 1 && unmatchedObservations.length === 1) {
      unmatchedObservations[0]!.id = unmatchedOld[0]!.id;
      assignedOldIds.add(unmatchedOld[0]!.id);
    }
  }

  // Migration 14 cannot retroactively hash a source path that was moved before
  // its first baseline scan. For those legacy NULL-hash rows only, use the old
  // scanner's size+mtime evidence when it yields exactly one possible old/new
  // pair. Ambiguous candidates deliberately remain unmatched.
  const legacyOldByFingerprint = new Map<string, StoredAssetIdentity[]>();
  for (const asset of oldById.values()) {
    if (asset.contentSha256 !== null || assignedOldIds.has(asset.id)) {
      continue;
    }
    const key = legacyIdentityKey(asset);
    const matches = legacyOldByFingerprint.get(key) ?? [];
    matches.push(asset);
    legacyOldByFingerprint.set(key, matches);
  }

  const legacyObservationsByFingerprint = new Map<string, ObservedAsset[]>();
  for (const observation of observations) {
    if (observation.id) {
      continue;
    }
    const key = legacyIdentityKey(observation);
    const matches = legacyObservationsByFingerprint.get(key) ?? [];
    matches.push(observation);
    legacyObservationsByFingerprint.set(key, matches);
  }

  for (const [key, unmatchedObservations] of legacyObservationsByFingerprint) {
    const unmatchedOld = legacyOldByFingerprint.get(key) ?? [];
    if (unmatchedOld.length === 1 && unmatchedObservations.length === 1) {
      unmatchedObservations[0]!.id = unmatchedOld[0]!.id;
      assignedOldIds.add(unmatchedOld[0]!.id);
    }
  }

  const usedIds = new Set(storedAssets.map((asset) => asset.id));
  for (const observation of observations) {
    if (observation.id) {
      continue;
    }

    let id: string;
    do {
      id = `asset_${randomBytes(12).toString("hex")}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    observation.id = id;
  }
}

function legacyIdentityKey(
  asset: Pick<
    StoredAssetIdentity | ObservedAsset,
    "mediaType" | "sizeBytes" | "mtimeMs"
  >
): string {
  return `${asset.mediaType}\u0000${asset.sizeBytes}\u0000${asset.mtimeMs}`;
}

async function buildScannedAssetInputs(
  observations: ObservedAsset[],
  storedAssets: StoredAssetIdentity[],
  scanMarker: string,
  signal?: AbortSignal
): Promise<ScannedAssetInput[]> {
  const storedById = new Map(storedAssets.map((asset) => [asset.id, asset]));
  const inputs: ScannedAssetInput[] = [];

  for (const observation of observations) {
    throwIfScanAborted(signal);
    if (!observation.id) {
      throw new Error("Scanned media did not receive an identity.");
    }

    const stored = storedById.get(observation.id);
    let width = stored?.width ?? null;
    let height = stored?.height ?? null;
    if (
      observation.mediaType === "image" &&
      (!stored ||
        stored.contentSha256 !== observation.contentSha256 ||
        width === null ||
        height === null)
    ) {
      const dimensions = await readImageDimensions(
        observation.absolutePath,
        signal
      );
      throwIfScanAborted(signal);
      width = dimensions?.width ?? null;
      height = dimensions?.height ?? null;
    }

    inputs.push({
      id: observation.id,
      rootId: observation.rootId,
      folderId: observation.folderId,
      relativePath: observation.relativePath,
      name: observation.name,
      extension: observation.extension,
      mediaType: observation.mediaType,
      mimeType: observation.mimeType,
      sizeBytes: observation.sizeBytes,
      mtimeMs: observation.mtimeMs,
      fingerprint: observation.fingerprint,
      contentSha256: observation.contentSha256,
      fsDeviceId: observation.fsDeviceId,
      fsInode: observation.fsInode,
      fsBirthtimeNs: observation.fsBirthtimeNs,
      fsCtimeNs: observation.fsCtimeNs,
      seenAt: scanMarker,
      width,
      height
    });
  }

  return inputs;
}

function locationKey(root: string, relativePath: string): string {
  return `${root}\u0000${relativePath}`;
}

function fileFingerprint(fileStat: BigIntStats): string {
  return `${fileStat.size}:${fileStat.mtimeNs}:${fileStat.ctimeNs}`;
}

function fileSystemIdentityFromStat(fileStat: BigIntStats): FileSystemIdentity {
  if (fileStat.ino <= 0n || fileStat.dev < 0n) {
    return {
      fsDeviceId: null,
      fsInode: null,
      fsBirthtimeNs: null,
      fsCtimeNs: null
    };
  }

  return {
    fsDeviceId: fileStat.dev.toString(),
    fsInode: fileStat.ino.toString(),
    fsBirthtimeNs:
      fileStat.birthtimeNs > 0n ? fileStat.birthtimeNs.toString() : null,
    fsCtimeNs: fileStat.ctimeNs > 0n ? fileStat.ctimeNs.toString() : null
  };
}

function fileSystemIdentityKey(
  identity: Pick<
    StoredAssetIdentity | ObservedAsset,
    "fsDeviceId" | "fsInode" | "fsBirthtimeNs" | "fsCtimeNs"
  >
): string | null {
  if (identity.fsDeviceId === null || identity.fsInode === null) {
    return null;
  }

  if (identity.fsBirthtimeNs !== null) {
    return `birth\u0000${identity.fsDeviceId}\u0000${identity.fsInode}\u0000${identity.fsBirthtimeNs}`;
  }

  if (identity.fsCtimeNs !== null) {
    return `ctime\u0000${identity.fsDeviceId}\u0000${identity.fsInode}\u0000${identity.fsCtimeNs}`;
  }

  return null;
}

function sameFileSystemIdentity(
  left: Pick<
    StoredAssetIdentity | ObservedAsset,
    "fsDeviceId" | "fsInode" | "fsBirthtimeNs" | "fsCtimeNs"
  >,
  right: FileSystemIdentity
): boolean {
  const leftKey = fileSystemIdentityKey(left);
  return leftKey !== null && leftKey === fileSystemIdentityKey(right);
}

function safeStatNumber(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}

function statMatchesObservation(
  fileStat: BigIntStats,
  expectedFingerprint: string,
  expectedIdentity: FileSystemIdentity
): boolean {
  return (
    fileStat.isFile() &&
    fileFingerprint(fileStat) === expectedFingerprint &&
    equalFileSystemIdentityFields(
      expectedIdentity,
      fileSystemIdentityFromStat(fileStat)
    )
  );
}

function equalFileSystemIdentityFields(
  left: FileSystemIdentity,
  right: FileSystemIdentity
): boolean {
  return (
    left.fsDeviceId === right.fsDeviceId &&
    left.fsInode === right.fsInode &&
    left.fsBirthtimeNs === right.fsBirthtimeNs &&
    left.fsCtimeNs === right.fsCtimeNs
  );
}

async function hashStableFile(
  absoluteFilePath: string,
  expectedFingerprint: string,
  expectedIdentity: FileSystemIdentity,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    throwIfScanAborted(signal);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(absoluteFilePath, { signal })) {
      throwIfScanAborted(signal);
      hash.update(chunk as Buffer);
    }

    const after = await stat(absoluteFilePath, { bigint: true });
    throwIfScanAborted(signal);
    if (!statMatchesObservation(after, expectedFingerprint, expectedIdentity)) {
      return null;
    }

    return hash.digest("hex");
  } catch {
    throwIfScanAborted(signal);
    return null;
  }
}

async function countChangedObservations(
  observations: ObservedAsset[],
  signal?: AbortSignal
): Promise<number> {
  let errors = 0;
  for (const observation of observations) {
    throwIfScanAborted(signal);
    const current = await stat(observation.absolutePath, {
      bigint: true
    }).catch(() => null);
    throwIfScanAborted(signal);
    if (
      !current ||
      !statMatchesObservation(current, observation.fingerprint, observation)
    ) {
      errors += 1;
    }
  }
  return errors;
}

async function countChangedDirectories(
  roots: DiscoveredRoot[],
  signal?: AbortSignal
): Promise<number> {
  let errors = 0;
  for (const root of roots) {
    errors += await countChangedDirectory(root.directory, signal);
  }
  return errors;
}

async function countChangedDirectory(
  directory: DiscoveredDirectory,
  signal?: AbortSignal
): Promise<number> {
  throwIfScanAborted(signal);
  const snapshot = directory.snapshot;
  if (!snapshot) {
    return 1;
  }

  const before = await stat(snapshot.absolutePath, { bigint: true }).catch(
    () => null
  );
  throwIfScanAborted(signal);
  const entries = await readdir(snapshot.absolutePath, {
    withFileTypes: true
  }).catch(() => null);
  throwIfScanAborted(signal);
  const after = await stat(snapshot.absolutePath, { bigint: true }).catch(
    () => null
  );
  throwIfScanAborted(signal);

  if (
    !before ||
    !after ||
    !entries ||
    !statMatchesDirectorySnapshot(before, snapshot) ||
    !statMatchesDirectorySnapshot(after, snapshot) ||
    directoryEntriesSignature(entries) !== snapshot.entriesSignature
  ) {
    return 1;
  }

  let errors = 0;
  for (const entry of directory.entries) {
    if (entry.child) {
      errors += await countChangedDirectory(entry.child, signal);
    }
  }
  return errors;
}

async function discoverDirectory(
  absoluteDirectory: string,
  relativeDirectory: string,
  signal?: AbortSignal,
  hooks?: ScanHooks
): Promise<DiscoveredDirectory> {
  throwIfScanAborted(signal);
  const before = await stat(absoluteDirectory, { bigint: true }).catch(
    () => null
  );
  throwIfScanAborted(signal);
  const entries = await readdir(absoluteDirectory, {
    withFileTypes: true
  }).catch(() => null);
  throwIfScanAborted(signal);

  if (!before?.isDirectory() || !entries) {
    return { entries: [], readFailed: true, snapshot: null };
  }

  entries.sort(compareDirectoryEntries);
  const discoveredEntries: DiscoveredEntry[] = [];

  for (const entry of entries) {
    throwIfScanAborted(signal);
    const relativePath = toRelativeMediaPath(relativeDirectory, entry.name);
    const hidden = entry.name.startsWith(".");
    const kind = directoryEntryKind(entry);
    const child =
      kind === "directory" && !hidden
        ? await discoverDirectory(
            path.join(absoluteDirectory, entry.name),
            relativePath,
            signal,
            hooks
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

  const after = await stat(absoluteDirectory, { bigint: true }).catch(
    () => null
  );
  throwIfScanAborted(signal);
  if (
    !after?.isDirectory() ||
    fileFingerprint(before) !== fileFingerprint(after) ||
    !equalFileSystemIdentityFields(
      fileSystemIdentityFromStat(before),
      fileSystemIdentityFromStat(after)
    )
  ) {
    return { entries: discoveredEntries, readFailed: true, snapshot: null };
  }

  const snapshot: DirectorySnapshot = {
    absolutePath: absoluteDirectory,
    fingerprint: fileFingerprint(after),
    fileSystemIdentity: fileSystemIdentityFromStat(after),
    entriesSignature: directoryEntriesSignature(entries)
  };
  await hooks?.afterDirectorySnapshot?.(absoluteDirectory, relativeDirectory);
  throwIfScanAborted(signal);

  return { entries: discoveredEntries, readFailed: false, snapshot };
}

function statMatchesDirectorySnapshot(
  directoryStat: BigIntStats,
  snapshot: DirectorySnapshot
): boolean {
  return (
    directoryStat.isDirectory() &&
    fileFingerprint(directoryStat) === snapshot.fingerprint &&
    equalFileSystemIdentityFields(
      fileSystemIdentityFromStat(directoryStat),
      snapshot.fileSystemIdentity
    )
  );
}

function directoryEntriesSignature(entries: Dirent[]): string {
  return [...entries]
    .sort(compareDirectoryEntries)
    .map((entry) => `${directoryEntryKind(entry)}\u0000${entry.name}`)
    .join("\u0001");
}

function compareDirectoryEntries(left: Dirent, right: Dirent): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function directoryEntryKind(entry: Dirent): DiscoveredEntry["kind"] {
  return entry.isSymbolicLink()
    ? "symlink"
    : entry.isDirectory()
      ? "directory"
      : entry.isFile()
        ? "file"
        : "other";
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
  absoluteFilePath: string,
  signal?: AbortSignal
): Promise<{ width: number; height: number } | null> {
  try {
    throwIfScanAborted(signal);
    if (/\.hei[cf]$/i.test(absoluteFilePath)) {
      const canonical = await realpath(absoluteFilePath);
      if (canonical !== absoluteFilePath) return null;
      const before = await stat(canonical);
      const { inspectHeifImage } = await import("./heif-decoder.js");
      const info = await inspectHeifImage(absoluteFilePath);
      const after = await stat(canonical);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        (await realpath(absoluteFilePath)) !== canonical
      )
        return null;
      throwIfScanAborted(signal);
      return { width: info.width, height: info.height };
    }
    const metadata = await sharp(absoluteFilePath, {
      failOn: "none",
      limitInputPixels: 268_402_689
    }).metadata();
    throwIfScanAborted(signal);
    const width = positiveIntegerOrNull(metadata.autoOrient.width);
    const height = positiveIntegerOrNull(metadata.autoOrient.height);

    return width && height ? { width, height } : null;
  } catch {
    throwIfScanAborted(signal);
    return null;
  }
}

class ScanAbortedError extends Error {
  constructor() {
    super("Scan stopped before library changes were applied.");
    this.name = "AbortError";
  }
}

function throwIfScanAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ScanAbortedError();
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

function pruneScanJobHistory(db: AetherDatabase): void {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM jobs WHERE type = 'library_scan' AND status != 'running'
      AND id NOT IN (SELECT id FROM jobs WHERE type = 'library_scan' AND status != 'running'
      ORDER BY updated_at DESC, id DESC LIMIT 20)`
    ).run();
    db.prepare(
      `UPDATE jobs SET error = 'Library scan failed.'
      WHERE type = 'library_scan' AND error IS NOT NULL
      AND error NOT IN ('Scan stopped before library changes were applied.', 'Scan was interrupted before completion.', 'Library scan failed.')`
    ).run();
  })();
}

function errorMessage(error: unknown): string {
  if (error instanceof ScanAbortedError) {
    return error.message;
  }

  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : null;

  return code && /^[A-Z0-9_]+$/.test(code)
    ? `Library scan failed (${code}).`
    : "Library scan failed.";
}
