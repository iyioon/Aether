import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/database.js";

describe("database migrations", () => {
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

        CREATE TABLE pair_preferences (
          asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          winner_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL,
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

        CREATE TABLE pair_preferences (
          asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          winner_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL,
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
