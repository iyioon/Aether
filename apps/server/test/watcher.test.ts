import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { openDatabase } from "../src/db/database.js";
import { folderIdFor, listAssets } from "../src/library/repository.js";
import { LibraryScanner } from "../src/library/scanner.js";
import {
  type DirectoryWatcher,
  LibraryWatcher
} from "../src/library/watcher.js";

describe("library watcher", () => {
  it("debounces media-root changes into a scan job", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-watch-"));
    await mkdir(path.join(cwd, "media"));
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_WATCH_ENABLED: "true",
        AETHER_WATCH_DEBOUNCE_MS: "250",
        NODE_ENV: "test"
      },
      cwd
    );
    const db = openDatabase(config.configDir);
    const scanner = new LibraryScanner(db, config.mediaRoots);
    const startScan = vi.spyOn(scanner, "startScan");
    const watchedDirectories: FakeDirectoryWatcher[] = [];
    const info = vi.fn();
    const warn = vi.fn();
    const watcher = new LibraryWatcher({
      roots: config.mediaRoots,
      scanner,
      debounceMs: config.watchDebounceMs,
      logger: { info, warn },
      watchDirectory: (directory, listener) => {
        const fakeWatcher = new FakeDirectoryWatcher(directory, listener);
        watchedDirectories.push(fakeWatcher);
        return fakeWatcher;
      }
    });

    try {
      await watcher.start();
      expect(watcher.status().watchedDirectories).toBe(1);

      await mkdir(path.join(cwd, "media", "Fresh"));
      await writeFile(
        path.join(cwd, "media", "Fresh", "new-photo.jpg"),
        "image"
      );
      watchedDirectories[0]?.emit("rename", "Fresh");

      await waitFor(() => {
        const root = config.mediaRoots[0]!;
        const assets = listAssets(db, {
          folderId: folderIdFor(root.id, ""),
          offset: 0,
          limit: 10,
          sort: "filename",
          type: "all",
          recursive: true
        });
        const latestJob = scanner.listJobs(1)[0];

        return assets?.page.total === 1 && latestJob?.status === "completed";
      });

      const latestJob = scanner.listJobs(1)[0];
      expect(latestJob?.status).toBe("completed");
      expect(startScan).toHaveBeenCalledWith({ queueIfRunning: true });
      expect(watcher.status().lastScanJobId).toMatch(/^job_/);
      expect(watcher.status().watchedDirectories).toBe(2);

      const serializedInfoLogs = JSON.stringify(info.mock.calls);
      expect(serializedInfoLogs).not.toContain(cwd);
      expect(serializedInfoLogs).not.toContain("new-photo.jpg");

      const privateError = Object.assign(
        new Error(`Could not watch ${path.join(cwd, "media", "Fresh")}`),
        { code: "EACCES" }
      );
      watchedDirectories[0]?.emitError(privateError);
      expect(watcher.status().lastError).toBe("Watcher error (EACCES).");
      const serializedWarningLogs = JSON.stringify(warn.mock.calls);
      expect(serializedWarningLogs).not.toContain(cwd);
      expect(serializedWarningLogs).not.toContain("Fresh");
    } finally {
      await watcher.stop();
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("waits for an in-flight refresh without installing watchers after stop", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-watch-stop-"));
    const mediaDir = path.join(cwd, "media");
    await mkdir(mediaDir);
    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_DATA_DIR: "./aether-data",
        AETHER_WATCH_ENABLED: "true",
        AETHER_WATCH_DEBOUNCE_MS: "250",
        NODE_ENV: "test"
      },
      cwd
    );
    const db = openDatabase(config.configDir);
    const scanner = new LibraryScanner(db, config.mediaRoots);
    const watchedDirectories: FakeDirectoryWatcher[] = [];
    let finishCollection: ((directories: Set<string>) => void) | undefined;
    let markCollectionStarted: (() => void) | undefined;
    const collectionStarted = new Promise<void>((resolve) => {
      markCollectionStarted = resolve;
    });
    const collection = new Promise<Set<string>>((resolve) => {
      finishCollection = resolve;
    });
    const watcher = new LibraryWatcher({
      roots: config.mediaRoots,
      scanner,
      debounceMs: config.watchDebounceMs,
      collectDirectories: () => {
        markCollectionStarted?.();
        return collection;
      },
      watchDirectory: (directory, listener) => {
        const fakeWatcher = new FakeDirectoryWatcher(directory, listener);
        watchedDirectories.push(fakeWatcher);
        return fakeWatcher;
      }
    });

    try {
      const starting = watcher.start();
      await collectionStarted;
      const stopping = watcher.stop();
      finishCollection?.(new Set([mediaDir]));
      await Promise.all([starting, stopping]);

      expect(watchedDirectories).toHaveLength(0);
      expect(watcher.status()).toMatchObject({
        running: false,
        watchedDirectories: 0
      });
    } finally {
      await watcher.stop();
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });
});

type WatchEventListener = (
  eventType: string,
  filename: string | Buffer | null
) => void;

class FakeDirectoryWatcher implements DirectoryWatcher {
  closed = false;
  private readonly errorListeners: Array<(error: Error) => void> = [];

  constructor(
    readonly directory: string,
    private readonly listener: WatchEventListener
  ) {}

  close(): void {
    this.closed = true;
  }

  on(event: "error", listener: (error: Error) => void): unknown {
    if (event === "error") {
      this.errorListeners.push(listener);
    }

    return this;
  }

  emit(eventType: string, filename: string | Buffer | null): void {
    this.listener(eventType, filename);
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
    if (predicate()) {
      return;
    }

    await sleep(50);
  }

  throw new Error("Timed out waiting for watcher scan.");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
