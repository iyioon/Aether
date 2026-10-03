import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { recomputeAssetRankings } from "../library/repository-rankings.js";
import { searchNgramText } from "../library/search-text.js";

export type AetherDatabase = Database.Database;

interface Migration {
  version: number;
  name: string;
  sql?: string;
  apply?: (db: AetherDatabase, appliedAt: string) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS roots (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        real_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(root_id, relative_path)
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
        folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        relative_path TEXT NOT NULL,
        name TEXT NOT NULL,
        extension TEXT NOT NULL,
        media_type TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        duration_ms INTEGER,
        codec TEXT,
        fingerprint TEXT,
        indexed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        UNIQUE(root_id, relative_path)
      );

      CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id);
      CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(media_type);
      CREATE INDEX IF NOT EXISTS idx_assets_mtime ON assets(mtime_ms);

      CREATE TABLE IF NOT EXISTS derivatives (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        path TEXT NOT NULL,
        source_mtime_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(asset_id, kind, width, height)
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        normalized_name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_tags (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(asset_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS ratings (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        rating INTEGER CHECK(rating BETWEEN 0 AND 10),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs(status, priority, created_at);
    `
  },
  {
    version: 2,
    name: "job_results",
    sql: `
      ALTER TABLE jobs ADD COLUMN result TEXT;
    `
  },
  {
    version: 3,
    name: "annotation_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_tags_usage
        ON tags(usage_count DESC, normalized_name);

      CREATE INDEX IF NOT EXISTS idx_asset_tags_tag
        ON asset_tags(tag_id);

      CREATE INDEX IF NOT EXISTS idx_ratings_sort
        ON ratings(favorite, rating);
    `
  },
  {
    version: 4,
    name: "asset_search_index",
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(
        asset_id UNINDEXED,
        root_id UNINDEXED,
        folder_id UNINDEXED,
        name,
        relative_path,
        tokenize = 'unicode61'
      );

      INSERT INTO asset_search (asset_id, root_id, folder_id, name, relative_path)
      SELECT id, root_id, folder_id, name, relative_path
      FROM assets;
    `
  },
  {
    version: 5,
    name: "persistent_login_attempts",
    sql: `
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY,
        failed_count INTEGER NOT NULL DEFAULT 0,
        first_failed_at TEXT NOT NULL,
        last_failed_at TEXT NOT NULL,
        locked_until TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_login_attempts_locked_until
        ON login_attempts(locked_until);

      CREATE INDEX IF NOT EXISTS idx_login_attempts_last_failed_at
        ON login_attempts(last_failed_at);
    `
  },
  {
    version: 6,
    name: "asset_search_cjk_ngrams",
    sql: `
      DROP TABLE IF EXISTS asset_search;

      CREATE VIRTUAL TABLE asset_search USING fts5(
        asset_id UNINDEXED,
        root_id UNINDEXED,
        folder_id UNINDEXED,
        name,
        relative_path,
        search_ngrams,
        tokenize = 'unicode61'
      );

      INSERT INTO asset_search
        (asset_id, root_id, folder_id, name, relative_path, search_ngrams)
      SELECT
        id,
        root_id,
        folder_id,
        name,
        relative_path,
        aether_search_ngrams(name || ' ' || relative_path)
      FROM assets;
    `
  },
  {
    version: 7,
    name: "rating_scale_0_to_10",
    sql: `
      CREATE TABLE ratings_next (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        rating INTEGER CHECK(rating BETWEEN 0 AND 10),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
        updated_at TEXT NOT NULL
      );

      INSERT INTO ratings_next (asset_id, rating, favorite, updated_at)
      SELECT asset_id, rating, favorite, updated_at
      FROM ratings;

      DROP TABLE ratings;

      ALTER TABLE ratings_next RENAME TO ratings;

      CREATE INDEX IF NOT EXISTS idx_ratings_sort
        ON ratings(favorite, rating);
    `
  },
  {
    version: 8,
    name: "unbounded_media_score",
    sql: `
      CREATE TABLE ratings_next (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        rating INTEGER CHECK(rating >= 0),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
        updated_at TEXT NOT NULL
      );

      INSERT INTO ratings_next (asset_id, rating, favorite, updated_at)
      SELECT asset_id, rating, favorite, updated_at
      FROM ratings;

      DROP TABLE ratings;

      ALTER TABLE ratings_next RENAME TO ratings;

      CREATE INDEX IF NOT EXISTS idx_ratings_sort
        ON ratings(favorite, rating);
    `
  },
  {
    version: 9,
    name: "pairwise_media_rankings",
    sql: `
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

      CREATE INDEX idx_comparison_events_pair
        ON comparison_events(asset_low_id, asset_high_id, created_at);

      CREATE TABLE pair_preferences (
        asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        winner_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES comparison_events(id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(asset_low_id, asset_high_id),
        CHECK(asset_low_id < asset_high_id),
        CHECK(winner_id IN (asset_low_id, asset_high_id))
      );

      CREATE INDEX idx_pair_preferences_winner
        ON pair_preferences(winner_id);

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
    `
  },
  {
    version: 10,
    name: "consistent_score_terminology",
    sql: `
      DROP INDEX IF EXISTS idx_ratings_sort;
      ALTER TABLE ratings RENAME TO asset_annotations;
      ALTER TABLE asset_annotations RENAME COLUMN rating TO manual_score;

      CREATE INDEX idx_asset_annotations_sort
        ON asset_annotations(favorite, manual_score);

      DROP INDEX IF EXISTS idx_asset_rankings_score;
      ALTER TABLE asset_rankings RENAME COLUMN score TO comparison_score;
      ALTER TABLE asset_rankings RENAME COLUMN manual_offset TO manual_adjustment;

      CREATE INDEX idx_asset_rankings_comparison_score
        ON asset_rankings(comparison_score DESC, comparison_count DESC);
    `
  },
  {
    version: 11,
    name: "zero_default_score",
    sql: `
      DROP INDEX IF EXISTS idx_asset_annotations_sort;

      CREATE TABLE asset_annotations_next (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        manual_score INTEGER NOT NULL DEFAULT 0 CHECK(manual_score >= 0),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
        updated_at TEXT NOT NULL
      );

      INSERT INTO asset_annotations_next
        (asset_id, manual_score, favorite, updated_at)
      SELECT asset_id, COALESCE(manual_score, 0), favorite, updated_at
      FROM asset_annotations;

      DROP TABLE asset_annotations;
      ALTER TABLE asset_annotations_next RENAME TO asset_annotations;

      CREATE INDEX idx_asset_annotations_sort
        ON asset_annotations(favorite, manual_score);
    `
  },
  {
    version: 12,
    name: "rebuild_comparison_projections",
    apply: (db, appliedAt) => recomputeAssetRankings(db, appliedAt)
  },
  {
    version: 13,
    name: "cascade_deleted_comparison_targets",
    sql: `
      CREATE TABLE comparison_events_next (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL CHECK(event_type IN ('decision', 'undo')),
        asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        winner_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
        previous_event_id TEXT REFERENCES comparison_events_next(id) ON DELETE SET NULL,
        target_event_id TEXT REFERENCES comparison_events_next(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        CHECK(asset_low_id < asset_high_id),
        CHECK(
          (event_type = 'decision' AND winner_id IN (asset_low_id, asset_high_id)) OR
          (event_type = 'undo' AND winner_id IS NULL AND target_event_id IS NOT NULL)
        )
      );

      INSERT INTO comparison_events_next
        (id, event_type, asset_low_id, asset_high_id, winner_id,
         previous_event_id, target_event_id, created_at)
      SELECT
        id, event_type, asset_low_id, asset_high_id, winner_id,
        previous_event_id, target_event_id, created_at
      FROM comparison_events;

      CREATE TABLE pair_preferences_next (
        asset_low_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        asset_high_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        winner_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES comparison_events_next(id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(asset_low_id, asset_high_id),
        CHECK(asset_low_id < asset_high_id),
        CHECK(winner_id IN (asset_low_id, asset_high_id))
      );

      INSERT INTO pair_preferences_next
        (asset_low_id, asset_high_id, winner_id, event_id, updated_at)
      SELECT asset_low_id, asset_high_id, winner_id, event_id, updated_at
      FROM pair_preferences;

      DROP TABLE pair_preferences;
      DELETE FROM comparison_events WHERE event_type = 'undo';
      DROP TABLE comparison_events;

      ALTER TABLE comparison_events_next RENAME TO comparison_events;
      ALTER TABLE pair_preferences_next RENAME TO pair_preferences;

      CREATE INDEX idx_comparison_events_pair
        ON comparison_events(asset_low_id, asset_high_id, created_at);

      CREATE INDEX idx_pair_preferences_winner
        ON pair_preferences(winner_id);
    `
  }
];

export function openDatabase(configDir: string): AetherDatabase {
  mkdirSync(configDir, { recursive: true });
  const databasePath = path.join(configDir, "aether.sqlite");
  const db = new Database(databasePath);

  db.function(
    "aether_search_ngrams",
    { deterministic: true },
    (input: unknown) =>
      typeof input === "string" ? searchNgramText(input) : ""
  );
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  applyMigrations(db);

  return db;
}

export function applyMigrations(db: AetherDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    db.exec("BEGIN;");
    try {
      const appliedAt = new Date().toISOString();
      if (migration.sql) {
        db.exec(migration.sql);
      }
      migration.apply?.(db, appliedAt);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, appliedAt);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}
