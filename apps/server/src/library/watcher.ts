import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { MediaRootConfig } from "../config/config.js";
import type { LibraryScanner } from "./scanner.js";

type WatchLogger = Pick<FastifyBaseLogger, "info" | "warn">;
type WatchEventListener = (
  eventType: string,
  filename: string | Buffer | null
) => void;

export interface DirectoryWatcher {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type DirectoryWatchFactory = (
  directory: string,
  listener: WatchEventListener
) => DirectoryWatcher;

export interface LibraryWatcherOptions {
  roots: MediaRootConfig[];
  scanner: LibraryScanner;
  debounceMs: number;
  logger?: WatchLogger;
  watchDirectory?: DirectoryWatchFactory;
}

export interface LibraryWatchStatus {
  enabled: boolean;
  running: boolean;
  debounceMs: number;
  watchedDirectories: number;
  lastEventAt: string | null;
  lastScanJobId: string | null;
  lastError: string | null;
}

export class LibraryWatcher {
  private readonly watchers = new Map<string, DirectoryWatcher>();
  private scanTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private started = false;
  private stopped = true;
  private lastEventAt: string | null = null;
  private lastScanJobId: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: LibraryWatcherOptions) {}

  async start(): Promise<void> {
    if (this.started && !this.stopped) {
      return;
    }

    this.started = true;
    this.stopped = false;
    await this.refreshWatches();
    this.options.logger?.info(
      { watchedDirectories: this.watchers.size },
      "media watcher started"
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimer(this.scanTimer);
    clearTimer(this.refreshTimer);
    this.scanTimer = null;
    this.refreshTimer = null;

    for (const watcher of this.watchers.values()) {
      watcher.close();
    }

    this.watchers.clear();
  }

  status(): LibraryWatchStatus {
    return {
      enabled: this.started && !this.stopped,
      running: this.started && !this.stopped,
      debounceMs: this.options.debounceMs,
      watchedDirectories: this.watchers.size,
      lastEventAt: this.lastEventAt,
      lastScanJobId: this.lastScanJobId,
      lastError: this.lastError
    };
  }

  private handleWatchEvent(
    directory: string,
    eventType: string,
    filename: string | Buffer | null
  ): void {
    if (this.stopped || shouldIgnoreWatchEvent(filename)) {
      return;
    }

    this.lastEventAt = new Date().toISOString();
    this.options.logger?.info(
      { directory, eventType, filename: filename?.toString() ?? null },
      "media library change detected"
    );
    this.scheduleScan();
    this.scheduleRefresh();
  }

  private scheduleScan(): void {
    clearTimer(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;

      if (this.stopped) {
        return;
      }

      const job = this.options.scanner.startScan({ queueIfRunning: true });
      this.lastScanJobId = job.id;
    }, this.options.debounceMs);
    this.scanTimer.unref?.();
  }

  private scheduleRefresh(): void {
    clearTimer(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshWatches().catch((error: unknown) => {
        this.lastError = errorMessage(error);
        this.options.logger?.warn(
          { err: error },
          "media watcher refresh failed"
        );
      });
    }, Math.min(Math.max(this.options.debounceMs, 250), 2000));
    this.refreshTimer.unref?.();
  }

  private async refreshWatches(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const nextDirectories = new Set<string>();

    for (const root of this.options.roots) {
      await collectDirectories(root.realPath, nextDirectories);
    }

    for (const [directory, watcher] of this.watchers) {
      if (!nextDirectories.has(directory)) {
        watcher.close();
        this.watchers.delete(directory);
      }
    }

    for (const directory of nextDirectories) {
      if (!this.watchers.has(directory)) {
        this.watchDirectory(directory);
      }
    }
  }

  private watchDirectory(directory: string): void {
    try {
      const watchDirectory = this.options.watchDirectory ?? nativeWatchDirectory;
      const watcher = watchDirectory(directory, (eventType, filename) => {
        this.handleWatchEvent(directory, eventType, filename);
      });

      watcher.on("error", (error: Error) => {
        this.lastError = error.message;
        this.watchers.delete(directory);
        this.options.logger?.warn(
          { err: error, directory },
          "media watcher directory failed"
        );
        this.scheduleRefresh();
      });

      this.watchers.set(directory, watcher);
    } catch (error) {
      this.lastError = errorMessage(error);
      this.options.logger?.warn(
        { err: error, directory },
        "media watcher directory could not be watched"
      );
    }
  }
}

const nativeWatchDirectory: DirectoryWatchFactory = (
  directory,
  listener
): FSWatcher => watch(directory, listener);

async function collectDirectories(
  directory: string,
  directories: Set<string>
): Promise<void> {
  directories.add(directory);
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => []
  );

  for (const entry of entries) {
    if (
      entry.name.startsWith(".") ||
      entry.isSymbolicLink() ||
      !entry.isDirectory()
    ) {
      continue;
    }

    await collectDirectories(path.join(directory, entry.name), directories);
  }
}

function shouldIgnoreWatchEvent(filename: string | Buffer | null): boolean {
  if (!filename) {
    return false;
  }

  return path.basename(filename.toString()).startsWith(".");
}

function clearTimer(timer: NodeJS.Timeout | null): void {
  if (timer) {
    clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown watcher failure.";
}
