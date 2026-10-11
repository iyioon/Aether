import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/database.js";

describe("content identity migration", () => {
  it("adds a nullable non-unique digest without changing existing asset IDs", () => {
    const db = new Database(":memory:");

    try {
      db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE assets (id TEXT PRIMARY KEY);
        INSERT INTO assets (id) VALUES ('legacy-one'), ('legacy-two');
      `);
      const markHistoricalMigration = db.prepare(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, ?)`
      );
      for (let version = 1; version <= 13; version += 1) {
        markHistoricalMigration.run(
          version,
          `historical-${version}`,
          "2026-10-11T00:00:00.000Z"
        );
      }

      applyMigrations(db);

      expect(db.prepare("SELECT id FROM assets ORDER BY id").all()).toEqual([
        { id: "legacy-one" },
        { id: "legacy-two" }
      ]);
      const digestColumn = (
        db.pragma("table_info(assets)") as Array<{
          name: string;
          notnull: number;
          dflt_value: unknown;
        }>
      ).find((column) => column.name === "content_sha256");
      expect(digestColumn).toMatchObject({
        name: "content_sha256",
        notnull: 0,
        dflt_value: null
      });
      expect(
        db.prepare("SELECT content_sha256 FROM assets ORDER BY id").all()
      ).toEqual([{ content_sha256: null }, { content_sha256: null }]);

      const duplicateDigest = "a".repeat(64);
      expect(() =>
        db.prepare("UPDATE assets SET content_sha256 = ?").run(duplicateDigest)
      ).not.toThrow();
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM assets WHERE content_sha256 = ?"
          )
          .get(duplicateDigest)
      ).toEqual({ count: 2 });
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 14")
          .get()
      ).toEqual({ name: "stable_media_content_identity" });
      expect(
        (
          db.pragma("index_list(assets)") as Array<{
            name: string;
            unique: number;
          }>
        ).find((index) => index.name === "idx_assets_content_sha256")
      ).toMatchObject({ unique: 0 });
    } finally {
      db.close();
    }
  });

  it("adds nullable filesystem identity to v15 data without rewriting metadata", () => {
    const db = new Database(":memory:");

    try {
      db.pragma("foreign_keys = ON");
      db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE assets (
          id TEXT PRIMARY KEY,
          content_sha256 TEXT
        );
        CREATE TABLE asset_annotations (
          asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
          manual_score INTEGER NOT NULL,
          favorite INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO assets (id, content_sha256)
        VALUES ('kept-one', '${"a".repeat(64)}'),
               ('kept-two', '${"a".repeat(64)}');
        INSERT INTO asset_annotations
          (asset_id, manual_score, favorite, updated_at)
        VALUES
          ('kept-one', 91, 1, '2026-10-11T00:00:00.000Z'),
          ('kept-two', 27, 0, '2026-10-11T00:00:00.000Z');
      `);
      const markHistoricalMigration = db.prepare(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, ?)`
      );
      for (let version = 1; version <= 15; version += 1) {
        markHistoricalMigration.run(
          version,
          `historical-${version}`,
          "2026-10-11T00:00:00.000Z"
        );
      }

      expect(applyMigrations(db)).toEqual([16, 17]);

      expect(
        db
          .prepare(
            `SELECT id, content_sha256, fs_device_id, fs_inode,
                    fs_birthtime_ns, fs_ctime_ns
             FROM assets
             ORDER BY id`
          )
          .all()
      ).toEqual([
        {
          id: "kept-one",
          content_sha256: "a".repeat(64),
          fs_device_id: null,
          fs_inode: null,
          fs_birthtime_ns: null,
          fs_ctime_ns: null
        },
        {
          id: "kept-two",
          content_sha256: "a".repeat(64),
          fs_device_id: null,
          fs_inode: null,
          fs_birthtime_ns: null,
          fs_ctime_ns: null
        }
      ]);
      expect(
        db
          .prepare(
            `SELECT asset_id, manual_score, favorite
             FROM asset_annotations
             ORDER BY asset_id`
          )
          .all()
      ).toEqual([
        { asset_id: "kept-one", manual_score: 91, favorite: 1 },
        { asset_id: "kept-two", manual_score: 27, favorite: 0 }
      ]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 16")
          .get()
      ).toEqual({ name: "same_filesystem_media_identity" });
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 17")
          .get()
      ).toEqual({ name: "persist_session_cookie_mode" });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'security_state'"
          )
          .get()
      ).toEqual({ name: "security_state" });
    } finally {
      db.close();
    }
  });
});
