import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  LATEST_SCHEMA_VERSION,
  openDatabase
} from "../src/db/database.js";

describe("database migrations", () => {
  it("upgrades version 17 without losing existing records and requires presentation storage", async () => {
    const configDir = await mkdtemp(
      path.join(tmpdir(), "aether-presentation-upgrade-")
    );
    try {
      const initial = openDatabase(configDir);
      initial
        .prepare(
          "INSERT INTO roots (id, label, real_path, created_at) VALUES ('root', 'Kept', '/media', '2026-10-22')"
        )
        .run();
      initial.exec(
        "DROP TABLE asset_presentations; DELETE FROM schema_migrations WHERE version >= 18;"
      );
      initial.close();
      const upgraded = openDatabase(configDir);
      expect(
        upgraded
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get()
      ).toEqual({ version: LATEST_SCHEMA_VERSION });
      expect(
        upgraded.prepare("SELECT label FROM roots WHERE id = 'root'").get()
      ).toEqual({ label: "Kept" });
      expect(
        upgraded
          .prepare("SELECT COUNT(*) AS count FROM asset_presentations")
          .get()
      ).toEqual({ count: 0 });
      upgraded.exec("DROP TABLE asset_presentations");
      upgraded.close();
      expect(() => openDatabase(configDir)).toThrow(
        "Aether database schema is incomplete or incompatible"
      );
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("upgrades version 18 with independent presets while retaining existing crops and revisions", async () => {
    const configDir = await mkdtemp(
      path.join(tmpdir(), "aether-aspect-upgrade-")
    );
    try {
      const initial = openDatabase(configDir);
      initial.exec(`
        INSERT INTO roots (id, label, real_path, created_at) VALUES ('root', 'Media', '/media', '2026-10-26');
        INSERT INTO assets (id, root_id, relative_path, name, extension, media_type, size_bytes, mtime_ms, indexed_at, status)
          VALUES ('one', 'root', 'one.jpg', 'one.jpg', '.jpg', 'image', 10, 1, '2026-10-26', 'ready'),
                 ('two', 'root', 'two.jpg', 'two.jpg', '.jpg', 'image', 10, 1, '2026-10-26', 'ready');
        INSERT INTO asset_presentations (asset_id, revision, fit, focal_x, focal_y, zoom, playback_rate, loop_mode, updated_at)
          VALUES ('one', 3, 'cover', 0.2, 0.8, 2, 1, 'repeat', '2026-10-26'),
                 ('two', 2, 'auto', 0.5, 0.5, 1, 1, 'repeat', '2026-10-26');
        ALTER TABLE asset_presentations DROP COLUMN aspect_framing;
        ALTER TABLE asset_presentations DROP COLUMN feed_framing;
        DELETE FROM schema_migrations WHERE version >= 19;
      `);
      initial.close();
      const upgraded = openDatabase(configDir);
      try {
        const edited = upgraded
          .prepare(
            "SELECT revision, aspect_framing FROM asset_presentations WHERE asset_id = 'one'"
          )
          .get() as { revision: number; aspect_framing: string };
        const frame = { fit: "cover", focalX: 0.2, focalY: 0.8, zoom: 2 };
        expect(edited.revision).toBe(3);
        expect(JSON.parse(edited.aspect_framing)).toEqual({
          Square: frame,
          Portrait: frame,
          Landscape: frame
        });
        expect(
          upgraded
            .prepare(
              "SELECT aspect_framing FROM asset_presentations WHERE asset_id = 'two'"
            )
            .get()
        ).toEqual({ aspect_framing: "{}" });
        upgraded.exec(
          "ALTER TABLE asset_presentations DROP COLUMN aspect_framing"
        );
      } finally {
        upgraded.close();
      }
      expect(() => openDatabase(configDir)).toThrow(
        "Aether database schema is incomplete or incompatible"
      );
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("upgrades version 19 without inventing Feed overrides and validates the new column", async () => {
    const configDir = await mkdtemp(
      path.join(tmpdir(), "aether-feed-upgrade-")
    );
    try {
      const initial = openDatabase(configDir);
      initial.exec(`
        INSERT INTO roots (id, label, real_path, created_at) VALUES ('root', 'Media', '/media', '2026-10-26');
        INSERT INTO assets (id, root_id, relative_path, name, extension, media_type, size_bytes, mtime_ms, indexed_at, status)
          VALUES ('one', 'root', 'one.jpg', 'one.jpg', '.jpg', 'image', 10, 1, '2026-10-26', 'ready');
        INSERT INTO asset_presentations (asset_id, revision, fit, focal_x, focal_y, zoom, playback_rate, loop_mode, updated_at, aspect_framing)
          VALUES ('one', 3, 'auto', 0.5, 0.5, 1, 1, 'repeat', '2026-10-26', '{"Portrait":{"fit":"cover","focalX":0.2,"focalY":0.8,"zoom":2}}');
        ALTER TABLE asset_presentations DROP COLUMN feed_framing;
        DELETE FROM schema_migrations WHERE version = 20;
      `);
      initial.close();
      const upgraded = openDatabase(configDir);
      try {
        expect(
          upgraded
            .prepare(
              "SELECT revision, aspect_framing, feed_framing FROM asset_presentations"
            )
            .get()
        ).toEqual({
          revision: 3,
          aspect_framing:
            '{"Portrait":{"fit":"cover","focalX":0.2,"focalY":0.8,"zoom":2}}',
          feed_framing: "{}"
        });
        expect(() =>
          upgraded
            .prepare("UPDATE asset_presentations SET feed_framing = ?")
            .run("[]")
        ).toThrow();
        expect(() =>
          upgraded
            .prepare("UPDATE asset_presentations SET feed_framing = ?")
            .run("x".repeat(1025))
        ).toThrow();
        upgraded.exec(
          "ALTER TABLE asset_presentations DROP COLUMN feed_framing"
        );
      } finally {
        upgraded.close();
      }
      expect(() => openDatabase(configDir)).toThrow(
        "Aether database schema is incomplete or incompatible"
      );
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("refuses startup when a latest-version database is missing required schema", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "aether-schema-"));

    try {
      const initialized = openDatabase(configDir);
      initialized.close();

      const tampered = new Database(path.join(configDir, "aether.sqlite"));
      try {
        tampered.pragma("journal_mode = DELETE");
        tampered.exec("DROP TABLE sessions");
      } finally {
        tampered.close();
      }

      expect(() => openDatabase(configDir)).toThrow(
        "Aether database schema is incomplete or incompatible"
      );
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("preserves annotations and ranking adjustments when adopting score terminology", () => {
    const db = new Database(":memory:");

    try {
      db.pragma("foreign_keys = ON");
      db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE assets (id TEXT PRIMARY KEY);

        CREATE TABLE ratings (
          asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
          rating INTEGER CHECK(rating >= 0),
          favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_ratings_sort ON ratings(favorite, rating);

        CREATE TABLE asset_rankings (
          asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
          skill REAL NOT NULL DEFAULT 0,
          score INTEGER NOT NULL DEFAULT 50 CHECK(score >= 0),
          manual_offset INTEGER NOT NULL DEFAULT 0,
          comparison_count INTEGER NOT NULL DEFAULT 0 CHECK(comparison_count >= 0),
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_asset_rankings_score
          ON asset_rankings(score DESC, comparison_count DESC);

        CREATE TABLE comparison_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL CHECK(event_type IN ('decision', 'undo')),
          asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          winner_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
          previous_event_id TEXT REFERENCES comparison_events(id) ON DELETE SET NULL,
          target_event_id TEXT REFERENCES comparison_events(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          CHECK(asset_low_id < asset_high_id),
          CHECK(
            (event_type = 'decision' AND winner_id IN (asset_low_id, asset_high_id)) OR
            (event_type = 'undo' AND winner_id IS NULL AND target_event_id IS NOT NULL)
          )
        );

        CREATE TABLE pair_preferences (
          asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          winner_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL REFERENCES comparison_events(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(asset_low_id, asset_high_id)
        );

        INSERT INTO assets (id) VALUES ('asset-one'), ('asset-two');
        INSERT INTO ratings (asset_id, rating, favorite, updated_at)
        VALUES
          ('asset-one', 125, 1, '2026-09-28T00:00:00.000Z'),
          ('asset-two', NULL, 1, '2026-09-28T00:00:00.000Z');
        INSERT INTO asset_rankings
          (asset_id, skill, score, manual_offset, comparison_count, updated_at)
        VALUES ('asset-one', 0.75, 64, 61, 8, '2026-09-28T00:00:00.000Z');
        INSERT INTO comparison_events
          (id, event_type, asset_low_id, asset_high_id, winner_id,
           previous_event_id, target_event_id, created_at)
        VALUES
          ('event-1', 'decision', 'asset-one', 'asset-two', 'asset-one',
           NULL, NULL, '2026-09-28T00:00:00.000Z'),
          ('event-2', 'decision', 'asset-one', 'asset-two', 'asset-two',
           'event-1', NULL, '2026-09-28T00:01:00.000Z'),
          ('undo-2', 'undo', 'asset-one', 'asset-two', NULL,
           'event-1', 'event-2', '2026-09-28T00:02:00.000Z');
        INSERT INTO pair_preferences
          (asset_low_id, asset_high_id, winner_id, event_id, updated_at)
        VALUES
          ('asset-one', 'asset-two', 'asset-one', 'event-1', '2026-09-28T00:00:00.000Z');
      `);

      const markHistoricalMigrations = db.prepare(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, ?)`
      );
      for (let version = 1; version <= 9; version += 1) {
        markHistoricalMigrations.run(
          version,
          `historical-${version}`,
          "2026-09-28T00:00:00.000Z"
        );
      }

      applyMigrations(db);

      expect(
        db
          .prepare(
            `SELECT asset_id, manual_score, favorite
             FROM asset_annotations
             ORDER BY asset_id`
          )
          .all()
      ).toEqual([
        {
          asset_id: "asset-one",
          manual_score: 125,
          favorite: 1
        },
        {
          asset_id: "asset-two",
          manual_score: 0,
          favorite: 1
        }
      ]);
      expect(
        db
          .prepare(
            `SELECT asset_id, comparison_score, manual_adjustment, comparison_count
             FROM asset_rankings
             ORDER BY asset_id`
          )
          .all()
      ).toEqual([
        {
          asset_id: "asset-one",
          comparison_score: 58,
          manual_adjustment: 61,
          comparison_count: 1
        },
        {
          asset_id: "asset-two",
          comparison_score: 42,
          manual_adjustment: 0,
          comparison_count: 1
        }
      ]);
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 11")
          .get()
      ).toEqual({ name: "zero_default_score" });
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 12")
          .get()
      ).toEqual({ name: "rebuild_comparison_projections" });
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 13")
          .get()
      ).toEqual({ name: "cascade_deleted_comparison_targets" });
      expect(
        db.prepare("SELECT COUNT(*) AS total FROM comparison_events").get()
      ).toEqual({ total: 3 });
      expect(() =>
        db.prepare("DELETE FROM assets WHERE id = 'asset-two'").run()
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("rebuilds stale comparison projections from active preferences", () => {
    const db = new Database(":memory:");

    try {
      db.pragma("foreign_keys = ON");
      db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE assets (id TEXT PRIMARY KEY);

        CREATE TABLE asset_annotations (
          asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
          manual_score INTEGER NOT NULL DEFAULT 0 CHECK(manual_score >= 0),
          favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
          updated_at TEXT NOT NULL
        );

        CREATE TABLE comparison_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL CHECK(event_type IN ('decision', 'undo')),
          asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          winner_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
          previous_event_id TEXT REFERENCES comparison_events(id) ON DELETE SET NULL,
          target_event_id TEXT REFERENCES comparison_events(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          CHECK(asset_low_id < asset_high_id),
          CHECK(
            (event_type = 'decision' AND winner_id IN (asset_low_id, asset_high_id)) OR
            (event_type = 'undo' AND winner_id IS NULL AND target_event_id IS NOT NULL)
          )
        );

        CREATE TABLE pair_preferences (
          asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          winner_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL REFERENCES comparison_events(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(asset_low_id, asset_high_id)
        );

        CREATE TABLE asset_rankings (
          asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
          skill REAL NOT NULL DEFAULT 0,
          comparison_score INTEGER NOT NULL DEFAULT 50 CHECK(comparison_score >= 0),
          manual_adjustment INTEGER NOT NULL DEFAULT 0,
          comparison_count INTEGER NOT NULL DEFAULT 0 CHECK(comparison_count >= 0),
          updated_at TEXT NOT NULL
        );

        INSERT INTO assets (id)
        VALUES ('asset-a'), ('asset-b'), ('asset-c'), ('stale-orphan');

        INSERT INTO comparison_events
          (id, event_type, asset_low_id, asset_high_id, winner_id,
           previous_event_id, target_event_id, created_at)
        VALUES
          ('event-1', 'decision', 'asset-a', 'asset-b', 'asset-a',
           NULL, NULL, '2026-09-28T00:00:00.000Z'),
          ('event-2', 'decision', 'asset-a', 'asset-c', 'asset-c',
           NULL, NULL, '2026-09-28T00:00:00.000Z');

        INSERT INTO pair_preferences
          (asset_low_id, asset_high_id, winner_id, event_id, updated_at)
        VALUES
          ('asset-a', 'asset-b', 'asset-a', 'event-1', '2026-09-28T00:00:00.000Z'),
          ('asset-a', 'asset-c', 'asset-c', 'event-2', '2026-09-28T00:00:00.000Z');

        INSERT INTO asset_rankings
          (asset_id, skill, comparison_score, manual_adjustment, comparison_count, updated_at)
        VALUES
          ('asset-a', 8, 99, 4, 3, '2026-09-28T00:00:00.000Z'),
          ('asset-b', -8, 0, -2, 2, '2026-09-28T00:00:00.000Z'),
          ('asset-c', 0, 50, 6, 1, '2026-09-28T00:00:00.000Z'),
          ('stale-orphan', 2, 80, 0, 1, '2026-09-28T00:00:00.000Z');
      `);

      const markHistoricalMigration = db.prepare(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, ?)`
      );
      for (let version = 1; version <= 11; version += 1) {
        markHistoricalMigration.run(
          version,
          `historical-${version}`,
          "2026-09-28T00:00:00.000Z"
        );
      }

      applyMigrations(db);
      applyMigrations(db);

      expect(
        db
          .prepare(
            `SELECT asset_id, comparison_score, manual_adjustment, comparison_count
             FROM asset_rankings
             ORDER BY asset_id`
          )
          .all()
      ).toEqual([
        {
          asset_id: "asset-a",
          comparison_count: 2,
          comparison_score: 50,
          manual_adjustment: 4
        },
        {
          asset_id: "asset-b",
          comparison_count: 1,
          comparison_score: 40,
          manual_adjustment: -2
        },
        {
          asset_id: "asset-c",
          comparison_count: 1,
          comparison_score: 60,
          manual_adjustment: 6
        }
      ]);
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 12")
          .get()
      ).toEqual({ name: "rebuild_comparison_projections" });
    } finally {
      db.close();
    }
  });
});
