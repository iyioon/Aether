import { createHash } from "node:crypto";
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  initializeDataDirectory,
  resolveDataPaths
} from "../src/config/data-directory.js";
import { LATEST_SCHEMA_VERSION, openDatabase } from "../src/db/database.js";
import { createConfigBackup } from "../src/maintenance/backup.js";
import { restoreDataDirectory } from "../src/maintenance/restore.js";
import { acquireRuntimeLock } from "../src/maintenance/runtime-lock.js";

describe("data restore", () => {
  it("restores a verified database and included cache", async () => {
    const fixture = await createRestoreFixture({ includeCache: true });

    try {
      await writeFile(path.join(fixture.paths.cacheDir, "stale.txt"), "stale");
      const result = await restoreDataDirectory({
        paths: fixture.paths,
        workspaceRoot: fixture.workspace,
        backupDir: fixture.backupDir
      });

      expect(result).toEqual({
        databaseVersion: 17,
        manifestVersion: 2,
        restoredCache: true
      });
      await expect(
        access(path.join(fixture.paths.configDir, "aether.sqlite-wal"))
      ).rejects.toThrow();
      await expect(
        access(path.join(fixture.paths.configDir, "aether.sqlite-shm"))
      ).rejects.toThrow();
      expect(readRootLabels(fixture.paths.configDir)).toEqual(["restored"]);
      await expect(
        readFile(
          path.join(fixture.paths.cacheDir, "nested", "preview.bin"),
          "utf8"
        )
      ).resolves.toBe("cached preview");
      await expect(
        access(path.join(fixture.paths.cacheDir, "stale.txt"))
      ).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it("clears the derivative cache when the backup excludes it", async () => {
    const fixture = await createRestoreFixture();

    try {
      await writeFile(path.join(fixture.paths.cacheDir, "stale.txt"), "stale");
      const result = await restoreDataDirectory({
        paths: fixture.paths,
        workspaceRoot: fixture.workspace,
        backupDir: fixture.backupDir
      });

      expect(result.restoredCache).toBe(false);
      await expect(
        access(path.join(fixture.paths.cacheDir, "stale.txt"))
      ).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it("removes restored sessions and login throttling before installation", async () => {
    const fixture = await createRestoreFixture({
      includeAuthenticationState: true
    });

    try {
      await restoreDataDirectory({
        paths: fixture.paths,
        workspaceRoot: fixture.workspace,
        backupDir: fixture.backupDir
      });

      const restored = new Database(
        path.join(fixture.paths.configDir, "aether.sqlite"),
        { fileMustExist: true, readonly: true }
      );
      try {
        expect(
          restored.prepare("SELECT COUNT(*) AS count FROM sessions").get()
        ).toEqual({ count: 0 });
        expect(
          restored.prepare("SELECT COUNT(*) AS count FROM login_attempts").get()
        ).toEqual({ count: 0 });
      } finally {
        restored.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("accepts the temporary legacy manifest format", async () => {
    const fixture = await createRestoreFixture();

    try {
      await writeFile(
        path.join(fixture.backupDir, "manifest.json"),
        `${JSON.stringify(
          {
            createdAt: "2026-10-11T00:00:00.000Z",
            source: {
              configDir: fixture.sourceConfigDir,
              cacheDir: null
            },
            includedCache: false,
            files: [{ path: "aether.sqlite", kind: "sqlite" }]
          },
          null,
          2
        )}\n`
      );

      const result = await restoreDataDirectory({
        paths: fixture.paths,
        workspaceRoot: fixture.workspace,
        backupDir: fixture.backupDir
      });

      expect(result.manifestVersion).toBe(1);
      expect(readRootLabels(fixture.paths.configDir)).toEqual(["restored"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([13, 14] as const)(
    "migrates a version %i backup before replacing the current database",
    async (sourceVersion) => {
      const fixture = await createRestoreFixture({ sourceVersion });

      try {
        const result = await restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: fixture.backupDir
        });

        expect(result.databaseVersion).toBe(LATEST_SCHEMA_VERSION);
        expect(readRootLabels(fixture.paths.configDir)).toEqual(["restored"]);

        const restoredDb = new Database(
          path.join(fixture.paths.configDir, "aether.sqlite"),
          { fileMustExist: true, readonly: true }
        );
        try {
          const version = restoredDb
            .prepare("SELECT MAX(version) AS version FROM schema_migrations")
            .get() as { version: number };
          const integrity = restoredDb.pragma("integrity_check") as Array<{
            integrity_check: string;
          }>;
          expect(version.version).toBe(LATEST_SCHEMA_VERSION);
          expect(integrity).toEqual([{ integrity_check: "ok" }]);
          expect(restoredDb.pragma("foreign_key_check")).toEqual([]);
        } finally {
          restoredDb.close();
        }
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it("keeps current data when a staged backup migration fails", async () => {
    const fixture = await createRestoreFixture({
      sourceVersion: 13,
      makeNextMigrationFail: true
    });

    try {
      await writeFile(path.join(fixture.paths.cacheDir, "current.txt"), "keep");
      await expect(
        restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: fixture.backupDir
        })
      ).rejects.toThrow("duplicate column name");

      expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
      await expect(
        readFile(path.join(fixture.paths.cacheDir, "current.txt"), "utf8")
      ).resolves.toBe("keep");
      const dataEntries = await readdir(fixture.paths.dataDir);
      expect(
        dataEntries.some((entry) => entry.startsWith(".aether-restore-"))
      ).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects malformed relative paths without changing current data", async () => {
    const fixture = await createRestoreFixture();

    try {
      const manifestPath = path.join(fixture.backupDir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        files: Array<{ path: string }>;
      };
      manifest.files[0]!.path = "../aether.sqlite";
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      await expect(
        restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: fixture.backupDir
        })
      ).rejects.toThrow("invalid file entry");
      expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("detects a backup file changed after its manifest was written", async () => {
    const fixture = await createRestoreFixture();

    try {
      await appendFile(path.join(fixture.backupDir, "aether.sqlite"), "tamper");

      await expect(
        restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: fixture.backupDir
        })
      ).rejects.toThrow("does not match its manifest");
      expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects symbolic-link backup directories and files", async () => {
    const fixture = await createRestoreFixture();

    try {
      const linkedBackup = path.join(fixture.workspace, "linked-backup");
      await symlink(fixture.backupDir, linkedBackup);
      await expect(
        restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: linkedBackup
        })
      ).rejects.toThrow("real backup directory");

      const backupDatabase = path.join(fixture.backupDir, "aether.sqlite");
      await rm(backupDatabase);
      await symlink(
        path.join(fixture.sourceConfigDir, "aether.sqlite"),
        backupDatabase
      );
      await expect(
        restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: fixture.backupDir
        })
      ).rejects.toThrow("real file");
      expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses a restore while another process owns the runtime lock", async () => {
    const fixture = await createRestoreFixture();
    const releaseLock = await acquireRuntimeLock(fixture.paths);

    try {
      await expect(
        restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: fixture.backupDir
        })
      ).rejects.toThrow("Aether is running");
      expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
    } finally {
      await releaseLock();
      await fixture.cleanup();
    }
  });

  it("rejects invalid SQLite even in a legacy backup", async () => {
    const fixture = await createRestoreFixture();

    try {
      await writeFile(
        path.join(fixture.backupDir, "manifest.json"),
        `${JSON.stringify({
          createdAt: "2026-10-11T00:00:00.000Z",
          source: { configDir: "/legacy", cacheDir: null },
          includedCache: false,
          files: [{ path: "aether.sqlite", kind: "sqlite" }]
        })}\n`
      );
      await writeFile(
        path.join(fixture.backupDir, "aether.sqlite"),
        "not a database"
      );

      await expect(
        restoreDataDirectory({
          paths: fixture.paths,
          workspaceRoot: fixture.workspace,
          backupDir: fixture.backupDir
        })
      ).rejects.toThrow("valid compatible Aether database");
      expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    ["sessions", "DROP TABLE sessions"],
    ["asset_search", "DROP TABLE asset_search"]
  ])(
    "rejects a latest-version backup missing the %s schema",
    async (_schemaName, mutation) => {
      const fixture = await createRestoreFixture();

      try {
        await mutateBackupDatabase(fixture.backupDir, mutation);

        await expect(
          restoreDataDirectory({
            paths: fixture.paths,
            workspaceRoot: fixture.workspace,
            backupDir: fixture.backupDir
          })
        ).rejects.toThrow("required Aether schema");
        expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it("rolls back the database and cache after a post-swap failure", async () => {
    const fixture = await createRestoreFixture({ includeCache: true });

    try {
      await writeFile(path.join(fixture.paths.cacheDir, "current.txt"), "keep");
      await expect(
        restoreDataDirectory(
          {
            paths: fixture.paths,
            workspaceRoot: fixture.workspace,
            backupDir: fixture.backupDir
          },
          {
            afterDatabaseSwap: async (databasePath) => {
              await writeFile(databasePath, "broken after swap");
            }
          }
        )
      ).rejects.toThrow("valid compatible Aether database");

      expect(readRootLabels(fixture.paths.configDir)).toEqual(["current"]);
      await expect(
        readFile(path.join(fixture.paths.cacheDir, "current.txt"), "utf8")
      ).resolves.toBe("keep");
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createRestoreFixture({
  includeCache = false,
  includeAuthenticationState = false,
  sourceVersion,
  makeNextMigrationFail = false
}: {
  includeCache?: boolean;
  includeAuthenticationState?: boolean;
  sourceVersion?: 13 | 14;
  makeNextMigrationFail?: boolean;
} = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "aether-restore-test-"));
  const paths = resolveDataPaths({}, workspace);
  await initializeDataDirectory(paths);
  writeRoot(paths.configDir, "current", workspace);

  const sourceConfigDir = path.join(workspace, "source-config");
  const sourceCacheDir = path.join(workspace, "source-cache");
  const outputDir = path.join(workspace, "backup-output");
  await Promise.all([
    mkdir(sourceConfigDir),
    mkdir(path.join(sourceCacheDir, "nested"), { recursive: true })
  ]);
  writeRoot(sourceConfigDir, "restored", workspace);
  if (includeAuthenticationState) {
    writeAuthenticationState(sourceConfigDir);
  }
  if (sourceVersion !== undefined) {
    downgradeDatabase(sourceConfigDir, sourceVersion);
  }
  if (makeNextMigrationFail) {
    const sourceDb = new Database(path.join(sourceConfigDir, "aether.sqlite"));
    try {
      sourceDb.exec("ALTER TABLE assets ADD COLUMN content_sha256 TEXT;");
    } finally {
      sourceDb.close();
    }
  }
  await writeFile(
    path.join(sourceCacheDir, "nested", "preview.bin"),
    "cached preview"
  );
  const backup = await createConfigBackup({
    configDir: sourceConfigDir,
    outputDir,
    cacheDir: sourceCacheDir,
    includeCache,
    now: new Date("2026-10-11T00:00:00.000Z")
  });

  return {
    workspace,
    paths,
    backupDir: backup.backupDir,
    sourceConfigDir,
    cleanup: async () => {
      await rm(workspace, { recursive: true, force: true });
    }
  };
}

function downgradeDatabase(configDir: string, targetVersion: 13 | 14): void {
  const db = new Database(path.join(configDir, "aether.sqlite"));
  try {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      DROP INDEX IF EXISTS idx_assets_fs_identity_birth;
      DROP INDEX IF EXISTS idx_assets_fs_identity_ctime;
      ALTER TABLE assets DROP COLUMN fs_ctime_ns;
      ALTER TABLE assets DROP COLUMN fs_birthtime_ns;
      ALTER TABLE assets DROP COLUMN fs_inode;
      ALTER TABLE assets DROP COLUMN fs_device_id;
      DROP TABLE IF EXISTS database_maintenance;
      DROP TABLE IF EXISTS security_state;
    `);

    if (targetVersion === 13) {
      db.exec(`
        DROP INDEX IF EXISTS idx_assets_content_sha256;
        ALTER TABLE assets DROP COLUMN content_sha256;
      `);
    }

    db.prepare("DELETE FROM schema_migrations WHERE version > ?").run(
      targetVersion
    );
  } finally {
    db.close();
  }
}

function writeAuthenticationState(configDir: string): void {
  const db = new Database(path.join(configDir, "aether.sqlite"));
  try {
    db.prepare(
      `INSERT INTO sessions
        (id, token_hash, csrf_token_hash, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "restored-session",
      "a".repeat(64),
      "b".repeat(64),
      "2026-10-11T00:00:00.000Z",
      "2099-10-11T00:00:00.000Z",
      "2026-10-11T00:00:00.000Z"
    );
    db.prepare(
      `INSERT INTO login_attempts
        (key, failed_count, first_failed_at, last_failed_at, locked_until)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      "restored-attempt",
      10,
      "2026-10-11T00:00:00.000Z",
      "2026-10-11T00:01:00.000Z",
      "2099-10-11T00:15:00.000Z"
    );
  } finally {
    db.close();
  }
}

async function mutateBackupDatabase(
  backupDir: string,
  sql: string
): Promise<void> {
  const databasePath = path.join(backupDir, "aether.sqlite");
  const db = new Database(databasePath);
  try {
    db.pragma("journal_mode = DELETE");
    db.exec(sql);
  } finally {
    db.close();
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    files: Array<{ path: string; sizeBytes: number; sha256: string }>;
  };
  const databaseEntry = manifest.files.find(
    (file) => file.path === "aether.sqlite"
  );
  if (!databaseEntry) {
    throw new Error("Expected backup database manifest entry.");
  }
  const databaseBytes = await readFile(databasePath);
  databaseEntry.sizeBytes = (await stat(databasePath)).size;
  databaseEntry.sha256 = createHash("sha256")
    .update(databaseBytes)
    .digest("hex");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeRoot(configDir: string, label: string, workspace: string): void {
  const db = openDatabase(configDir);
  try {
    db.prepare(
      `INSERT INTO roots (id, label, real_path, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(
      `root-${label}`,
      label,
      path.join(workspace, `media-${label}`),
      "2026-10-11T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
}

function readRootLabels(configDir: string): string[] {
  const db = new Database(path.join(configDir, "aether.sqlite"), {
    fileMustExist: true,
    readonly: true
  });
  try {
    return (
      db.prepare("SELECT label FROM roots ORDER BY label").all() as Array<{
        label: string;
      }>
    ).map((row) => row.label);
  } finally {
    db.close();
  }
}
