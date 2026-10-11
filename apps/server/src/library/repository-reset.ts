import type { AetherDatabase } from "../db/database.js";

export interface LibraryDataResetOptions {
  scores: boolean;
  favorites: boolean;
  tags: boolean;
  comparisons: boolean;
}

export interface LibraryDataResetResult {
  scoresReset: number;
  favoritesReset: number;
  tagsRemoved: number;
  tagAssignmentsRemoved: number;
  comparisonPreferencesRemoved: number;
  comparisonEventsRemoved: number;
}

export function resetLibraryData(
  db: AetherDatabase,
  options: LibraryDataResetOptions,
  updatedAt: string
): LibraryDataResetResult {
  const result: LibraryDataResetResult = {
    scoresReset: options.scores ? countScoresToReset(db) : 0,
    favoritesReset: options.favorites
      ? countRows(
          db,
          "SELECT COUNT(*) AS total FROM asset_annotations WHERE favorite = 1"
        )
      : 0,
    tagsRemoved: options.tags
      ? countRows(db, "SELECT COUNT(*) AS total FROM tags")
      : 0,
    tagAssignmentsRemoved: options.tags
      ? countRows(db, "SELECT COUNT(*) AS total FROM asset_tags")
      : 0,
    comparisonPreferencesRemoved: options.comparisons
      ? countRows(db, "SELECT COUNT(*) AS total FROM pair_preferences")
      : 0,
    comparisonEventsRemoved: options.comparisons
      ? countRows(db, "SELECT COUNT(*) AS total FROM comparison_events")
      : 0
  };

  const transaction = db.transaction(() => {
    if (options.tags) {
      db.prepare("DELETE FROM asset_tags").run();
      db.prepare("DELETE FROM tags").run();
    }

    if (options.comparisons) {
      db.prepare("DELETE FROM pair_preferences").run();
      db.prepare("DELETE FROM comparison_events").run();
      db.prepare("DELETE FROM asset_rankings").run();
    } else if (options.scores) {
      db.prepare(
        `UPDATE asset_rankings
         SET manual_adjustment = 0, updated_at = ?
         WHERE manual_adjustment != 0`
      ).run(updatedAt);
    }

    if (options.scores) {
      db.prepare(
        `UPDATE asset_annotations
         SET manual_score = 0, updated_at = ?
         WHERE manual_score != 0`
      ).run(updatedAt);
    }

    if (options.favorites) {
      db.prepare(
        `UPDATE asset_annotations
         SET favorite = 0, updated_at = ?
         WHERE favorite = 1`
      ).run(updatedAt);
    }

    if (options.scores || options.favorites) {
      db.prepare(
        "DELETE FROM asset_annotations WHERE manual_score = 0 AND favorite = 0"
      ).run();
    }
  });

  transaction();
  return result;
}

function countScoresToReset(db: AetherDatabase): number {
  return countRows(
    db,
    `SELECT COUNT(*) AS total
     FROM (
       SELECT asset_id FROM asset_annotations WHERE manual_score != 0
       UNION
       SELECT asset_id FROM asset_rankings WHERE manual_adjustment != 0
     )`
  );
}

function countRows(db: AetherDatabase, sql: string): number {
  return (db.prepare(sql).get() as { total: number }).total;
}
