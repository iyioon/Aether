import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync
} from "node:fs";
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
  },
  {
    version: 14,
    name: "stable_media_content_identity",
    sql: `
      ALTER TABLE assets ADD COLUMN content_sha256 TEXT;

      CREATE INDEX idx_assets_content_sha256
        ON assets(content_sha256)
        WHERE content_sha256 IS NOT NULL;
    `
  },
  {
    version: 15,
    name: "secure_deleted_media_metadata",
    apply: (db) => {
      const assetSearchExists = db
        .prepare(
          `SELECT 1
           FROM sqlite_schema
           WHERE type = 'table' AND name = 'asset_search'`
        )
        .get();

      if (assetSearchExists) {
        db.prepare(
          "INSERT INTO asset_search(asset_search, rank) VALUES('secure-delete', 1)"
        ).run();
        db.prepare(
          "INSERT INTO asset_search(asset_search) VALUES('rebuild')"
        ).run();
      }
    }
  },
  {
    version: 16,
    name: "same_filesystem_media_identity",
    sql: `
      ALTER TABLE assets ADD COLUMN fs_device_id TEXT;
      ALTER TABLE assets ADD COLUMN fs_inode TEXT;
      ALTER TABLE assets ADD COLUMN fs_birthtime_ns TEXT;
      ALTER TABLE assets ADD COLUMN fs_ctime_ns TEXT;

      CREATE INDEX idx_assets_fs_identity_birth
        ON assets(fs_device_id, fs_inode, fs_birthtime_ns)
        WHERE fs_device_id IS NOT NULL
          AND fs_inode IS NOT NULL
          AND fs_birthtime_ns IS NOT NULL;

      CREATE INDEX idx_assets_fs_identity_ctime
        ON assets(fs_device_id, fs_inode, fs_ctime_ns)
        WHERE fs_device_id IS NOT NULL
          AND fs_inode IS NOT NULL
          AND fs_birthtime_ns IS NULL
          AND fs_ctime_ns IS NOT NULL;
    `
  },
  {
    version: 17,
    name: "persist_session_cookie_mode",
    sql: `
      CREATE TABLE security_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 18,
    name: "saved_media_presentations",
    sql: `
      CREATE TABLE asset_presentations (
        asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        highlight_start_ms INTEGER,
        highlight_end_ms INTEGER,
        fit TEXT NOT NULL CHECK(fit IN ('auto', 'contain', 'cover')),
        focal_x REAL NOT NULL CHECK(focal_x >= 0 AND focal_x <= 1),
        focal_y REAL NOT NULL CHECK(focal_y >= 0 AND focal_y <= 1),
        zoom REAL NOT NULL CHECK(zoom >= 1 AND zoom <= 4),
        playback_rate REAL NOT NULL CHECK(playback_rate IN (0.5, 0.75, 1, 1.25, 1.5, 2)),
        loop_mode TEXT NOT NULL CHECK(loop_mode IN ('repeat', 'bounce')),
        updated_at TEXT NOT NULL,
        CHECK((highlight_start_ms IS NULL AND highlight_end_ms IS NULL) OR
          (highlight_start_ms IS NOT NULL AND highlight_end_ms IS NOT NULL
           AND highlight_start_ms >= 0 AND highlight_end_ms > highlight_start_ms))
      );
    `
  }
];

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;

export class InvalidAetherSchemaError extends Error {
  constructor() {
    super("Aether database schema is incomplete or incompatible.");
    this.name = "InvalidAetherSchemaError";
  }
}

const REQUIRED_TABLE_COLUMNS = new Map<string, readonly string[]>([
  ["schema_migrations", ["version", "name", "applied_at"]],
  ["roots", ["id", "label", "real_path", "created_at"]],
  [
    "folders",
    [
      "id",
      "root_id",
      "parent_id",
      "relative_path",
      "name",
      "asset_count",
      "created_at",
      "updated_at"
    ]
  ],
  [
    "assets",
    [
      "id",
      "root_id",
      "folder_id",
      "relative_path",
      "name",
      "extension",
      "media_type",
      "mime_type",
      "size_bytes",
      "mtime_ms",
      "width",
      "height",
      "duration_ms",
      "codec",
      "fingerprint",
      "indexed_at",
      "status",
      "error",
      "content_sha256",
      "fs_device_id",
      "fs_inode",
      "fs_birthtime_ns",
      "fs_ctime_ns"
    ]
  ],
  [
    "derivatives",
    [
      "id",
      "asset_id",
      "kind",
      "width",
      "height",
      "path",
      "source_mtime_ms",
      "status",
      "error",
      "created_at"
    ]
  ],
  [
    "tags",
    ["id", "normalized_name", "display_name", "usage_count", "created_at"]
  ],
  ["asset_tags", ["asset_id", "tag_id", "created_at"]],
  ["asset_annotations", ["asset_id", "manual_score", "favorite", "updated_at"]],
  [
    "asset_presentations",
    [
      "asset_id",
      "revision",
      "highlight_start_ms",
      "highlight_end_ms",
      "fit",
      "focal_x",
      "focal_y",
      "zoom",
      "playback_rate",
      "loop_mode",
      "updated_at"
    ]
  ],
  [
    "sessions",
    [
      "id",
      "token_hash",
      "csrf_token_hash",
      "created_at",
      "expires_at",
      "last_seen_at"
    ]
  ],
  [
    "jobs",
    [
      "id",
      "type",
      "asset_id",
      "status",
      "priority",
      "attempts",
      "error",
      "created_at",
      "updated_at",
      "result"
    ]
  ],
  [
    "login_attempts",
    ["key", "failed_count", "first_failed_at", "last_failed_at", "locked_until"]
  ],
  [
    "comparison_events",
    [
      "id",
      "event_type",
      "asset_low_id",
      "asset_high_id",
      "winner_id",
      "previous_event_id",
      "target_event_id",
      "created_at"
    ]
  ],
  [
    "pair_preferences",
    ["asset_low_id", "asset_high_id", "winner_id", "event_id", "updated_at"]
  ],
  [
    "asset_rankings",
    [
      "asset_id",
      "skill",
      "comparison_score",
      "manual_adjustment",
      "comparison_count",
      "updated_at"
    ]
  ],
  [
    "asset_search",
    [
      "asset_id",
      "root_id",
      "folder_id",
      "name",
      "relative_path",
      "search_ngrams"
    ]
  ],
  ["database_maintenance", ["name", "completed_at"]],
  ["security_state", ["key", "value", "updated_at"]]
]);

const REQUIRED_INDEX_COLUMNS = new Map<string, readonly string[]>([
  ["idx_assets_folder", ["folder_id"]],
  ["idx_assets_type", ["media_type"]],
  ["idx_assets_mtime", ["mtime_ms"]],
  ["idx_assets_content_sha256", ["content_sha256"]],
  [
    "idx_assets_fs_identity_birth",
    ["fs_device_id", "fs_inode", "fs_birthtime_ns"]
  ],
  ["idx_assets_fs_identity_ctime", ["fs_device_id", "fs_inode", "fs_ctime_ns"]],
  ["idx_sessions_expires_at", ["expires_at"]],
  ["idx_jobs_status_priority", ["status", "priority", "created_at"]],
  ["idx_tags_usage", ["usage_count", "normalized_name"]],
  ["idx_asset_tags_tag", ["tag_id"]],
  ["idx_asset_annotations_sort", ["favorite", "manual_score"]],
  ["idx_login_attempts_locked_until", ["locked_until"]],
  ["idx_login_attempts_last_failed_at", ["last_failed_at"]],
  [
    "idx_comparison_events_pair",
    ["asset_low_id", "asset_high_id", "created_at"]
  ],
  ["idx_pair_preferences_winner", ["winner_id"]],
  [
    "idx_asset_rankings_comparison_score",
    ["comparison_score", "comparison_count"]
  ]
]);

export function validateLatestAetherSchema(db: AetherDatabase): void {
  const migrationRows = db
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; name: string }>;

  if (
    migrationRows.length !== migrations.length ||
    migrationRows.some(
      (row, index) =>
        row.version !== migrations[index]?.version ||
        row.name !== migrations[index]?.name
    )
  ) {
    throw new InvalidAetherSchemaError();
  }

  for (const [tableName, requiredColumns] of REQUIRED_TABLE_COLUMNS) {
    const table = db
      .prepare(
        `SELECT sql
         FROM sqlite_schema
         WHERE type = 'table' AND name = ?`
      )
      .get(tableName) as { sql: string | null } | undefined;
    if (!table) {
      throw new InvalidAetherSchemaError();
    }

    if (
      tableName === "asset_search" &&
      !/\bUSING\s+fts5\s*\(/i.test(table.sql ?? "")
    ) {
      throw new InvalidAetherSchemaError();
    }

    const actualColumns = new Set(
      (
        db.pragma(`table_info(${quoteSqliteIdentifier(tableName)})`) as Array<{
          name: string;
        }>
      ).map((column) => column.name)
    );
    if (requiredColumns.some((column) => !actualColumns.has(column))) {
      throw new InvalidAetherSchemaError();
    }
  }

  for (const [indexName, requiredColumns] of REQUIRED_INDEX_COLUMNS) {
    const index = db
      .prepare(
        `SELECT 1
         FROM sqlite_schema
         WHERE type = 'index' AND name = ?`
      )
      .get(indexName);
    if (!index) {
      throw new InvalidAetherSchemaError();
    }

    const actualColumns = (
      db.pragma(`index_info(${quoteSqliteIdentifier(indexName)})`) as Array<{
        name: string;
      }>
    ).map((column) => column.name);
    if (
      actualColumns.length !== requiredColumns.length ||
      actualColumns.some((column, index) => column !== requiredColumns[index])
    ) {
      throw new InvalidAetherSchemaError();
    }
  }
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function openDatabase(configDir: string): AetherDatabase {
  mkdirSync(configDir, { recursive: true });
  const databasePath = path.join(configDir, "aether.sqlite");
  prepareDatabaseFiles(databasePath);
  const db = new Database(databasePath);

  try {
    db.function(
      "aether_search_ngrams",
      { deterministic: true },
      (input: unknown) =>
        typeof input === "string" ? searchNgramText(input) : ""
    );
    db.function(
      "aether_seeded_rank",
      { deterministic: true },
      (input: unknown, seed: unknown) => seededRank(input, seed)
    );
    db.pragma("foreign_keys = ON");
    db.pragma("secure_delete = ON");
    db.pragma("temp_store = MEMORY");
    db.pragma("journal_mode = WAL");
    db.pragma("journal_size_limit = 0");
    db.pragma("busy_timeout = 5000");
    applyMigrations(db);
    runPendingPrivacyMaintenance(db);
    validateLatestAetherSchema(db);

    restrictDatabaseFilePermissions(databasePath);

    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve the startup failure that caused the cleanup.
    }

    throw error instanceof Error
      ? error
      : new Error("Database initialization failed", { cause: error });
  }
}

function seededRank(input: unknown, seed: unknown): number {
  const value = `${normalizeSeed(seed)}:${typeof input === "string" ? input : ""}`;
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function normalizeSeed(seed: unknown): number {
  return typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : 0;
}

function runPendingPrivacyMaintenance(db: AetherDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS database_maintenance (
      name TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
  `);

  const privacyMigration = db
    .prepare("SELECT 1 FROM schema_migrations WHERE version = 15")
    .get();
  const alreadyCompleted = db
    .prepare(
      "SELECT 1 FROM database_maintenance WHERE name = 'secure_delete_v15_vacuum'"
    )
    .get();

  if (!privacyMigration || alreadyCompleted) {
    return;
  }

  // Migration 15 enables secure deletion inside FTS. VACUUM is deliberately
  // tracked separately because it cannot run inside the migration transaction.
  // A crash or disk-full failure before the completion row causes a safe retry
  // on the next start instead of silently skipping the privacy cleanup forever.
  db.exec("VACUUM;");
  if (!checkpointDatabase(db)) {
    throw new Error("Database privacy maintenance could not finish.");
  }
  db.prepare(
    `INSERT INTO database_maintenance (name, completed_at)
     VALUES ('secure_delete_v15_vacuum', ?)`
  ).run(new Date().toISOString());
}

export function applyMigrations(db: AetherDatabase): number[] {
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
  const appliedNow: number[] = [];

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
      appliedNow.push(migration.version);
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }

  return appliedNow;
}

/**
 * Copies committed WAL pages into the main database and truncates the WAL.
 * A busy reader may postpone truncation; callers can safely retry later.
 */
export function checkpointDatabase(db: AetherDatabase): boolean {
  const [result] = db.pragma("wal_checkpoint(TRUNCATE)") as Array<{
    busy: number;
  }>;
  return result?.busy === 0;
}

function restrictDatabaseFilePermissions(databasePath: string): void {
  for (const filePath of [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`
  ]) {
    if (existsSync(filePath)) {
      const stats = lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
        throw new Error("Unsafe SQLite data file.");
      }
      chmodSync(filePath, 0o600);
    }
  }
}

function prepareDatabaseFiles(databasePath: string): void {
  if (existsSync(databasePath)) {
    restrictDatabaseFilePermissions(databasePath);
    return;
  }

  closeSync(openSync(databasePath, "wx", 0o600));
  restrictDatabaseFilePermissions(databasePath);
}
