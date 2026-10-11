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

export type DirectoryCollector = (directory: string) => Promise<Set<string>>;

export interface LibraryWatcherOptions {
  roots: MediaRootConfig[];
  scanner: LibraryScanner;
  debounceMs: number;
  logger?: WatchLogger;
  watchDirectory?: DirectoryWatchFactory;
  collectDirectories?: DirectoryCollector;
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
  private refreshPromise: Promise<void> | null = null;
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
    await this.queueRefresh();

    if (this.stopped) {
      return;
    }

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

    await this.refreshPromise?.catch(() => undefined);

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
    eventType: string,
    filename: string | Buffer | null
  ): void {
    if (this.stopped || shouldIgnoreWatchEvent(filename)) {
      return;
    }

    this.lastEventAt = new Date().toISOString();
    this.options.logger?.info({ eventType }, "media library change detected");
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
    if (this.stopped) {
      return;
    }

    clearTimer(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => {
        this.refreshTimer = null;
        this.queueRefresh().catch((error: unknown) => {
          if (this.stopped) {
            return;
          }

          this.lastError = watcherErrorMessage(error);
          this.options.logger?.warn(
            { errorCode: watcherErrorCode(error) },
            "media watcher refresh failed"
          );
        });
      },
      Math.min(Math.max(this.options.debounceMs, 250), 2000)
    );
    this.refreshTimer.unref?.();
  }

  private queueRefresh(): Promise<void> {
    const previous = this.refreshPromise ?? Promise.resolve();
    const refresh = previous
      .catch(() => undefined)
      .then(() => this.refreshWatches());
    this.refreshPromise = refresh;

    void refresh
      .finally(() => {
        if (this.refreshPromise === refresh) {
          this.refreshPromise = null;
        }
      })
      .catch(() => undefined);

    return refresh;
  }

  private async refreshWatches(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const nextDirectories = new Set<string>();
    const collect = this.options.collectDirectories ?? collectDirectories;

    for (const root of this.options.roots) {
      const rootDirectories = await collect(root.realPath);

      if (this.stopped) {
        return;
      }

      for (const directory of rootDirectories) {
        nextDirectories.add(directory);
      }
    }

    if (this.stopped) {
      return;
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
      const watchDirectory =
        this.options.watchDirectory ?? nativeWatchDirectory;
      const watcher = watchDirectory(directory, (eventType, filename) => {
        this.handleWatchEvent(eventType, filename);
      });

      watcher.on("error", (error: Error) => {
        if (this.stopped) {
          return;
        }

        this.lastError = watcherErrorMessage(error);
        this.watchers.delete(directory);
        this.options.logger?.warn(
          { errorCode: watcherErrorCode(error) },
          "media watcher directory failed"
        );
        this.scheduleRefresh();
      });

      this.watchers.set(directory, watcher);
    } catch (error) {
      this.lastError = watcherErrorMessage(error);
      this.options.logger?.warn(
        { errorCode: watcherErrorCode(error) },
        "media watcher directory could not be watched"
      );
    }
  }
}

const nativeWatchDirectory: DirectoryWatchFactory = (
  directory,
  listener
): FSWatcher => watch(directory, listener);

async function collectDirectories(directory: string): Promise<Set<string>> {
  const directories = new Set<string>();
  await collectDirectoryTree(directory, directories);
  return directories;
}

async function collectDirectoryTree(
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

    await collectDirectoryTree(path.join(directory, entry.name), directories);
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

function watcherErrorMessage(error: unknown): string {
  const code = watcherErrorCode(error);
  return code ? `Watcher error (${code}).` : "Watcher error.";
}

function watcherErrorCode(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return null;
  }

  return /^[A-Z0-9_]+$/.test(error.code) ? error.code : null;
}
