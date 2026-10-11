import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createConfigBackup } from "../src/maintenance/backup.js";

describe("config backups", () => {
  it("creates a consistent SQLite backup with a manifest", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-backup-"));
    const configDir = path.join(cwd, "config");
    const outputDir = path.join(cwd, "backups");
    await mkdir(configDir);
    const db = openDatabase(configDir);

    try {
      db.prepare(
        `INSERT INTO roots (id, label, real_path, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(
        "root_test",
        "Media",
        path.join(cwd, "media"),
        "2026-09-04T00:00:00.000Z"
      );

      const result = await createConfigBackup({
        configDir,
        outputDir,
        now: new Date("2026-09-04T10:20:30.123Z")
      });

      const backupDb = new Database(result.databasePath, {
        fileMustExist: true,
        readonly: true
      });

      try {
        expect(result.backupDir).toBe(
          path.join(outputDir, "aether-20260904-102030123Z")
        );
        expect(
          backupDb
            .prepare("SELECT label FROM roots WHERE id = ?")
            .get("root_test")
        ).toEqual({ label: "Media" });
      } finally {
        backupDb.close();
      }

      const manifest = JSON.parse(
        await readFile(result.manifestPath, "utf8")
      ) as {
        application: string;
        version: number;
        createdAt: string;
        includedCache: boolean;
        files: Array<{
          path: string;
          kind: string;
          sizeBytes: number;
          sha256: string;
        }>;
        source?: unknown;
      };

      expect(manifest).toMatchObject({
        application: "aether",
        version: 2,
        createdAt: "2026-09-04T10:20:30.123Z",
        includedCache: false,
        files: [
          {
            path: "aether.sqlite",
            kind: "sqlite",
            sizeBytes: expect.any(Number),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
          }
        ]
      });
      expect(manifest.source).toBeUndefined();
    } finally {
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("prunes old Aether backups when a retention count is provided", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-backup-"));
    const configDir = path.join(cwd, "config");
    const outputDir = path.join(cwd, "backups");
    await mkdir(configDir);
    const db = openDatabase(configDir);

    try {
      const oldest = await createConfigBackup({
        configDir,
        outputDir,
        now: new Date("2026-09-04T10:00:00.000Z")
      });
      const middle = await createConfigBackup({
        configDir,
        outputDir,
        now: new Date("2026-09-04T11:00:00.000Z")
      });
      const newest = await createConfigBackup({
        configDir,
        outputDir,
        keep: 2,
        now: new Date("2026-09-04T12:00:00.000Z")
      });

      expect(newest.prunedBackups).toEqual([oldest.backupDir]);
      await expect(access(oldest.backupDir)).rejects.toThrow();
      await expect(access(middle.backupDir)).resolves.toBeUndefined();
      await expect(access(newest.backupDir)).resolves.toBeUndefined();
    } finally {
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("refuses a pre-created timestamp path instead of following a symlink", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-backup-"));
    const configDir = path.join(cwd, "config");
    const outputDir = path.join(cwd, "backups");
    const outsideDir = path.join(cwd, "outside");
    const sentinel = path.join(outsideDir, "sentinel.txt");
    await Promise.all([mkdir(configDir), mkdir(outputDir), mkdir(outsideDir)]);
    await writeFile(sentinel, "preserve");
    await symlink(
      outsideDir,
      path.join(outputDir, "aether-20260904-102030123Z")
    );
    const db = openDatabase(configDir);

    try {
      await expect(
        createConfigBackup({
          configDir,
          outputDir,
          now: new Date("2026-09-04T10:20:30.123Z")
        })
      ).rejects.toMatchObject({ code: "EEXIST" });
      await expect(readFile(sentinel, "utf8")).resolves.toBe("preserve");
    } finally {
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("rejects cache-inclusive output inside the source cache", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-backup-"));
    const configDir = path.join(cwd, "config");
    const cacheDir = path.join(cwd, "cache");
    const outputDir = path.join(cacheDir, "backups");
    await Promise.all([mkdir(configDir), mkdir(cacheDir)]);
    await writeFile(path.join(cacheDir, "preview.bin"), "cache data");
    const db = openDatabase(configDir);

    try {
      await expect(
        createConfigBackup({
          configDir,
          outputDir,
          cacheDir,
          includeCache: true,
          now: new Date("2026-09-04T10:20:30.123Z")
        })
      ).rejects.toThrow("cannot overlap");
      await expect(access(outputDir)).rejects.toThrow();
      await expect(
        readFile(path.join(cacheDir, "preview.bin"), "utf8")
      ).resolves.toBe("cache data");
    } finally {
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("rejects output that contains the source config directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-backup-"));
    const outputDir = path.join(cwd, "backup-parent");
    const configDir = path.join(outputDir, "config");
    await mkdir(configDir, { recursive: true });
    const db = openDatabase(configDir);

    try {
      await expect(
        createConfigBackup({
          configDir,
          outputDir,
          now: new Date("2026-09-04T10:20:30.123Z")
        })
      ).rejects.toThrow("cannot overlap");
    } finally {
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
