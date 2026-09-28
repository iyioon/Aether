import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/database.js";

describe("database migrations", () => {
  it("preserves annotations and rankings when adopting score terminology", () => {
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

        INSERT INTO assets (id) VALUES ('asset-one'), ('asset-two');
        INSERT INTO ratings (asset_id, rating, favorite, updated_at)
        VALUES
          ('asset-one', 125, 1, '2026-09-28T00:00:00.000Z'),
          ('asset-two', NULL, 1, '2026-09-28T00:00:00.000Z');
        INSERT INTO asset_rankings
          (asset_id, skill, score, manual_offset, comparison_count, updated_at)
        VALUES ('asset-one', 0.75, 64, 61, 8, '2026-09-28T00:00:00.000Z');
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
             FROM asset_rankings`
          )
          .get()
      ).toEqual({
        asset_id: "asset-one",
        comparison_score: 64,
        manual_adjustment: 61,
        comparison_count: 8
      });
      expect(
        db
          .prepare("SELECT name FROM schema_migrations WHERE version = 11")
          .get()
      ).toEqual({ name: "zero_default_score" });
    } finally {
      db.close();
    }
  });
});
