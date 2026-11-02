import type { AetherDatabase } from "../db/database.js";
import { fitRankingModel } from "./ranking-model.js";

interface PreferenceRow {
  asset_low_id: string;
  asset_high_id: string;
  winner_id: string;
}

/**
 * Rebuilds the materialized ranking projection from the currently active pair
 * preferences. Callers that also mutate preferences or assets should invoke
 * this inside the same database transaction so readers never observe a stale
 * projection.
 */
export function recomputeAssetRankings(
  db: AetherDatabase,
  updatedAt: string
): void {
  const managed = Boolean(
    db
      .prepare(
        "SELECT 1 FROM pragma_table_info('assets') WHERE name = 'lifecycle'"
      )
      .get()
  );
  const preferences = db
    .prepare(
      managed
        ? `SELECT p.asset_low_id, p.asset_high_id, p.winner_id FROM pair_preferences p
        JOIN assets low ON low.id = p.asset_low_id AND low.lifecycle = 'active'
        JOIN assets high ON high.id = p.asset_high_id AND high.lifecycle = 'active'`
        : "SELECT asset_low_id, asset_high_id, winner_id FROM pair_preferences"
    )
    .all() as PreferenceRow[];
  const projections = fitRankingModel(
    preferences.map((preference) => ({
      assetLowId: preference.asset_low_id,
      assetHighId: preference.asset_high_id,
      winnerId: preference.winner_id
    }))
  );

  if (projections.size === 0) {
    db.prepare("DELETE FROM asset_rankings").run();
    return;
  }

  const existingAdjustments = new Map(
    (
      db
        .prepare(
          managed
            ? "SELECT asset_id, manual_adjustment, absolute_score FROM asset_manual_adjustments"
            : "SELECT asset_id, manual_adjustment, NULL AS absolute_score FROM asset_rankings"
        )
        .all() as Array<{
        asset_id: string;
        manual_adjustment: number;
        absolute_score: number | null;
      }>
    ).map((row) => [row.asset_id, row])
  );
  const storedManualScores = new Map(
    (
      db
        .prepare(
          "SELECT asset_id, manual_score FROM asset_annotations WHERE manual_score > 0"
        )
        .all() as Array<{ asset_id: string; manual_score: number }>
    ).map((row) => [row.asset_id, row.manual_score])
  );
  const upsert = db.prepare(`
    INSERT INTO asset_rankings
      (asset_id, skill, comparison_score, manual_adjustment, comparison_count, updated_at)
    VALUES
      (@assetId, @skill, @comparisonScore, @manualAdjustment, @comparisonCount, @updatedAt)
    ON CONFLICT(asset_id) DO UPDATE SET
      skill = excluded.skill,
      comparison_score = excluded.comparison_score,
      comparison_count = excluded.comparison_count,
      updated_at = excluded.updated_at
  `);

  for (const [assetId, projection] of projections) {
    const { comparisonCount, comparisonScore, skill } = projection;
    const storedManualScore = storedManualScores.get(assetId);
    const retained = existingAdjustments.get(assetId);
    upsert.run({
      assetId,
      skill,
      comparisonScore,
      manualAdjustment:
        (retained?.absolute_score !== null &&
        retained?.absolute_score !== undefined
          ? retained.absolute_score - comparisonScore
          : retained?.manual_adjustment) ??
        (storedManualScore === undefined
          ? 0
          : storedManualScore - comparisonScore),
      comparisonCount,
      updatedAt
    });
  }

  const stored = db
    .prepare("SELECT asset_id FROM asset_rankings")
    .all() as Array<{ asset_id: string }>;
  const remove = db.prepare("DELETE FROM asset_rankings WHERE asset_id = ?");
  for (const record of stored)
    if (!projections.has(record.asset_id)) remove.run(record.asset_id);
}
