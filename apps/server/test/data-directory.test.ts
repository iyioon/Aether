import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeDataDirectoryTarget,
  initializeDataDirectory,
  requireManagedDataSubdirectories,
  resolveDataPaths
} from "../src/config/data-directory.js";
import {
  getDataDirectoryStatus,
  rebuildDataDirectory,
  withDataDirectoryMaintenanceLock,
  wipeDataDirectory
} from "../src/maintenance/data-directory.js";
import {
  acquireRuntimeLock,
  assertDataDirectoryInactive
} from "../src/maintenance/runtime-lock.js";
import { closeServerRuntime } from "../src/maintenance/server-runtime.js";

describe("Aether data directory", () => {
  it("uses one default directory for database, cache, and backups", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);

    expect(paths).toMatchObject({
      dataDir: path.join(workspace, "aether-data"),
      configDir: path.join(workspace, "aether-data", "config"),
      cacheDir: path.join(workspace, "aether-data", "cache"),
      backupDir: path.join(workspace, "aether-data", "backups"),
      privateEnvPath: path.join(workspace, "aether-data", "private.env")
    });

    await initializeDataDirectory(paths);
    const marker = JSON.parse(await readFile(paths.markerPath, "utf8")) as {
      application: string;
      version: number;
    };

    expect(marker).toEqual({ application: "aether", version: 1 });
    await expect(access(paths.configDir)).resolves.toBeUndefined();
    await expect(access(paths.cacheDir)).resolves.toBeUndefined();
    await expect(access(paths.backupDir)).resolves.toBeUndefined();
  });

  it("does not claim an unrelated non-empty directory", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await mkdir(paths.dataDir);
    await writeFile(path.join(paths.dataDir, "personal-file.txt"), "keep me");

    await expect(initializeDataDirectory(paths)).rejects.toThrow(
      "is not empty and is not owned by Aether"
    );
  });

  it("rejects filesystem, home, and project directory targets", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));

    expect(() =>
      assertSafeDataDirectoryTarget(
        resolveDataPaths(
          { AETHER_DATA_DIR: path.parse(workspace).root },
          workspace
        ),
        workspace
      )
    ).toThrow("filesystem root");
    expect(() =>
      assertSafeDataDirectoryTarget(
        resolveDataPaths({ AETHER_DATA_DIR: homedir() }, workspace),
        workspace
      )
    ).toThrow("home directory");
    expect(() =>
      assertSafeDataDirectoryTarget(
        resolveDataPaths({ AETHER_DATA_DIR: workspace }, workspace),
        workspace
      )
    ).toThrow("project directory");
  });

  it("refuses a wipe when the ownership marker is missing or invalid", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await mkdir(paths.configDir, { recursive: true });
    await mkdir(paths.cacheDir);
    await mkdir(paths.backupDir);
    await writeFile(path.join(paths.dataDir, "sentinel.txt"), "preserve");

    await expect(wipeDataDirectory(paths, workspace)).rejects.toThrow(
      "does not contain a valid"
    );
    await expect(
      readFile(path.join(paths.dataDir, "sentinel.txt"), "utf8")
    ).resolves.toBe("preserve");

    await writeFile(
      paths.markerPath,
      '{"application":"another-app","version":1}\n'
    );
    await expect(wipeDataDirectory(paths, workspace)).rejects.toThrow(
      "unsupported ownership marker"
    );
    await expect(
      readFile(path.join(paths.dataDir, "sentinel.txt"), "utf8")
    ).resolves.toBe("preserve");
  });

  it("rejects managed subdirectories that are symbolic links", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const outside = await mkdtemp(path.join(tmpdir(), "aether-outside-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    await rm(paths.cacheDir, { recursive: true });
    await symlink(outside, paths.cacheDir);

    await expect(requireManagedDataSubdirectories(paths)).rejects.toThrow(
      "must be real directories"
    );
    await expect(wipeDataDirectory(paths, workspace)).rejects.toThrow(
      "must be real directories"
    );
    await expect(access(outside)).resolves.toBeUndefined();
  });

  it("prevents resets while the server owns the data directory", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    const release = await acquireRuntimeLock(paths);

    try {
      await expect(assertDataDirectoryInactive(paths)).rejects.toThrow(
        "Aether is running"
      );
      await expect(rebuildDataDirectory(paths, workspace)).rejects.toThrow(
        "Aether is running"
      );
    } finally {
      await release();
    }

    await expect(assertDataDirectoryInactive(paths)).resolves.toBeUndefined();
  });

  it("holds one exclusive lock throughout a maintenance operation", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    let signalStarted: (() => void) | undefined;
    let signalFinished: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      signalFinished = resolve;
    });

    const maintenance = withDataDirectoryMaintenanceLock(
      paths,
      workspace,
      [],
      async () => {
        signalStarted?.();
        await finish;
      }
    );

    await started;
    await expect(acquireRuntimeLock(paths)).rejects.toThrow(
      "Aether is running"
    );
    signalFinished?.();
    await maintenance;

    const release = await acquireRuntimeLock(paths);
    await release();
  });

  it("never guesses that a foreign-host lock is stale", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    const foreignHostname = `other-host-${hostname()}`;
    await writeFile(
      paths.runtimeLockPath,
      `${JSON.stringify({
        application: "aether",
        hostname: foreignHostname,
        pid: 999_999,
        startedAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        token: "foreign-lock"
      })}\n`
    );

    await expect(assertDataDirectoryInactive(paths)).rejects.toThrow(
      `locked by host ${foreignHostname}`
    );
    await expect(access(paths.runtimeLockPath)).resolves.toBeUndefined();
  });

  it("recovers an abandoned lock when a restarted process reuses the PID", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    await writeFile(
      paths.runtimeLockPath,
      `${JSON.stringify({
        application: "aether",
        hostname: hostname(),
        pid: process.pid,
        processInstanceId: "previous-process-instance",
        processStartedAt: "2000-01-01T00:00:00.000Z",
        startedAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        token: "abandoned-lock"
      })}\n`
    );

    const release = await acquireRuntimeLock(paths);
    await release();

    await expect(access(paths.runtimeLockPath)).rejects.toThrow();
  });

  it("does not steal a fresh same-PID lock from another process namespace", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    const now = new Date().toISOString();
    await writeFile(
      paths.runtimeLockPath,
      `${JSON.stringify({
        application: "aether",
        hostname: hostname(),
        pid: process.pid,
        processInstanceId: "other-live-process-instance",
        processStartedAt: "2000-01-01T00:00:00.000Z",
        startedAt: now,
        updatedAt: now,
        token: "live-lock"
      })}\n`
    );

    await expect(acquireRuntimeLock(paths)).rejects.toThrow(
      "Aether is running"
    );
    await expect(access(paths.runtimeLockPath)).resolves.toBeUndefined();
    await rm(paths.runtimeLockPath, { force: true });
  });

  it("records the process start time in new runtime locks", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    const release = await acquireRuntimeLock(paths);

    try {
      const lock = JSON.parse(
        await readFile(paths.runtimeLockPath, "utf8")
      ) as { processStartedAt?: string };
      expect(lock.processStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await release();
    }
  });

  it("releases the runtime lock only after the app and database close", async () => {
    const order: string[] = [];

    await closeServerRuntime({
      closeApplication: async () => {
        order.push("application");
      },
      closeDatabase: () => {
        order.push("database");
      },
      releaseLock: async () => {
        order.push("lock");
      }
    });

    expect(order).toEqual(["application", "database", "lock"]);
  });

  it("still closes the database and releases the lock after a close failure", async () => {
    const order: string[] = [];

    await expect(
      closeServerRuntime({
        closeApplication: async () => {
          order.push("application");
          throw new Error("close failed");
        },
        closeDatabase: () => {
          order.push("database");
        },
        releaseLock: async () => {
          order.push("lock");
        }
      })
    ).rejects.toThrow("close failed");
    expect(order).toEqual(["application", "database", "lock"]);
  });

  it("rebuilds generated data while preserving private settings", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    await writeFile(
      paths.privateEnvPath,
      "AETHER_MEDIA_ROOTS=library=/media\n"
    );
    await writeFile(path.join(paths.configDir, "aether.sqlite"), "database");
    await writeFile(path.join(paths.cacheDir, "thumbnail.webp"), "thumbnail");
    await mkdir(path.join(paths.backupDir, "aether-example"));
    await writeFile(
      path.join(paths.backupDir, "aether-example", "aether.sqlite"),
      "backup"
    );

    await rebuildDataDirectory(paths, workspace);

    await expect(readFile(paths.privateEnvPath, "utf8")).resolves.toContain(
      "AETHER_MEDIA_ROOTS"
    );
    await expect(access(paths.markerPath)).resolves.toBeUndefined();
    await expect(
      access(path.join(paths.configDir, "aether.sqlite"))
    ).rejects.toThrow();
    await expect(
      access(path.join(paths.cacheDir, "thumbnail.webp"))
    ).rejects.toThrow();
    await expect(
      access(path.join(paths.backupDir, "aether-example"))
    ).rejects.toThrow();
  });

  it("reports sizes and wipes only a marked Aether directory", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const paths = resolveDataPaths({}, workspace);
    await initializeDataDirectory(paths);
    await writeFile(path.join(paths.cacheDir, "preview.bin"), "12345");

    const status = await getDataDirectoryStatus(paths);
    expect(status.initialized).toBe(true);
    expect(status.cache).toMatchObject({ exists: true, files: 1, bytes: 5 });

    await wipeDataDirectory(paths, workspace);
    await expect(access(paths.dataDir)).rejects.toThrow();
    await expect(access(workspace)).resolves.toBeUndefined();
  });

  it("never rebuilds or wipes an overlapping media root", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "aether-data-test-"));
    const mediaRoot = path.join(workspace, "media");
    const paths = resolveDataPaths(
      { AETHER_DATA_DIR: path.join(mediaRoot, "aether-data") },
      workspace
    );
    await mkdir(mediaRoot);
    await writeFile(path.join(mediaRoot, "source.jpg"), "source media");
    await initializeDataDirectory(paths);

    await expect(
      rebuildDataDirectory(paths, workspace, [mediaRoot])
    ).rejects.toThrow("must not overlap");
    await expect(
      wipeDataDirectory(paths, workspace, [mediaRoot])
    ).rejects.toThrow("must not overlap");
    await expect(
      readFile(path.join(mediaRoot, "source.jpg"), "utf8")
    ).resolves.toBe("source media");

    const separatePaths = resolveDataPaths(
      { AETHER_DATA_DIR: path.join(workspace, "separate-data") },
      workspace
    );
    await initializeDataDirectory(separatePaths);
    const nestedMediaRoot = path.join(separatePaths.dataDir, "source-media");
    await mkdir(nestedMediaRoot);
    await writeFile(path.join(nestedMediaRoot, "source.jpg"), "nested source");

    await expect(
      wipeDataDirectory(separatePaths, workspace, [nestedMediaRoot])
    ).rejects.toThrow("must not overlap");
    await expect(
      readFile(path.join(nestedMediaRoot, "source.jpg"), "utf8")
    ).resolves.toBe("nested source");
  });
});
