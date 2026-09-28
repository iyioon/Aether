import { randomUUID } from "node:crypto";
import type { AetherDatabase } from "../db/database.js";
import { buildAssetFilterQuery } from "./asset-query.js";
import {
  comparisonPairKey,
  fitRankingModel,
  selectInformativePair,
  type ComparisonCandidate
} from "./ranking-model.js";
import { getFolder } from "./repository-folders.js";
import type {
  AssetListOptions,
  ComparisonDecisionInput,
  ComparisonDecisionResult,
  ComparisonPairResult,
  ComparisonUndoResult
} from "./repository-types.js";

interface PreferenceRow {
  asset_low_id: string;
  asset_high_id: string;
  winner_id: string;
}

interface PreferenceEventRow {
  id: string;
  asset_low_id: string;
  asset_high_id: string;
  winner_id: string;
  previous_event_id: string | null;
}

export class ComparisonConflictError extends Error {
  constructor(public readonly code: "comparison_changed" | "invalid_pair") {
    super(code);
    this.name = "ComparisonConflictError";
  }
}

export function getNextComparisonPair(
  db: AetherDatabase,
  options: Omit<
    AssetListOptions,
    "offset" | "limit" | "sort" | "sortDirection"
  > & {
    excludeAssetIds?: string[];
  }
): ComparisonPairResult | null {
  const folder = getFolder(db, options.folderId);
  if (!folder) {
    return null;
  }

  const { whereClause, parameters } = buildAssetFilterQuery(folder, options);
  const candidates = db
    .prepare(
      `SELECT
        a.id,
        ar.skill,
        ar.comparison_count
      FROM assets a
      LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
      LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
      WHERE ${whereClause}`
    )
    .all(parameters) as Array<{
    id: string;
    skill: number | null;
    comparison_count: number | null;
  }>;

  if (candidates.length < 2) {
    return null;
  }

  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const preferences = db
    .prepare(
      "SELECT asset_low_id, asset_high_id, winner_id FROM pair_preferences"
    )
    .all() as PreferenceRow[];
  const decidedPairs = new Set(
    preferences.map((preference) =>
      comparisonPairKey(preference.asset_low_id, preference.asset_high_id)
    )
  );
  const candidateModels: ComparisonCandidate[] = candidates.map(
    (candidate) => ({
      id: candidate.id,
      skill: candidate.skill,
      comparisonCount: candidate.comparison_count
    })
  );
  const selected = selectInformativePair(
    candidateModels,
    decidedPairs,
    options.excludeAssetIds ?? []
  );
  const [leftAssetId, rightAssetId] =
    Math.random() < 0.5 ? selected : [selected[1], selected[0]];

  return {
    leftAssetId,
    rightAssetId,
    progress: {
      candidateCount: candidates.length,
      rankedCount: candidates.filter(
        (candidate) => (candidate.comparison_count ?? 0) > 0
      ).length,
      decidedPairCount: preferences.filter(
        (preference) =>
          candidateIds.has(preference.asset_low_id) &&
          candidateIds.has(preference.asset_high_id)
      ).length
    }
  };
}

export function recordComparisonDecision(
  db: AetherDatabase,
  input: ComparisonDecisionInput
): ComparisonDecisionResult | null {
  if (
    input.leftAssetId === input.rightAssetId ||
    ![input.leftAssetId, input.rightAssetId].includes(input.winnerAssetId)
  ) {
    throw new ComparisonConflictError("invalid_pair");
  }

  if (!assetsExist(db, [input.leftAssetId, input.rightAssetId])) {
    return null;
  }

  const [assetLowId, assetHighId] = canonicalPair(
    input.leftAssetId,
    input.rightAssetId
  );
  const eventId = randomUUID();
  let replacedDecision = false;

  const transaction = db.transaction(() => {
    const current = db
      .prepare(
        `SELECT event_id
         FROM pair_preferences
         WHERE asset_low_id = ? AND asset_high_id = ?`
      )
      .get(assetLowId, assetHighId) as { event_id: string } | undefined;
    replacedDecision = Boolean(current);

    db.prepare(
      `
      INSERT INTO comparison_events
        (id, event_type, asset_low_id, asset_high_id, winner_id,
         previous_event_id, target_event_id, created_at)
      VALUES
        (@id, 'decision', @assetLowId, @assetHighId, @winnerId,
         @previousEventId, NULL, @createdAt)
    `
    ).run({
      id: eventId,
      assetLowId,
      assetHighId,
      winnerId: input.winnerAssetId,
      previousEventId: current?.event_id ?? null,
      createdAt: input.createdAt
    });

    db.prepare(
      `
      INSERT INTO pair_preferences
        (asset_low_id, asset_high_id, winner_id, event_id, updated_at)
      VALUES
        (@assetLowId, @assetHighId, @winnerId, @eventId, @createdAt)
      ON CONFLICT(asset_low_id, asset_high_id) DO UPDATE SET
        winner_id = excluded.winner_id,
        event_id = excluded.event_id,
        updated_at = excluded.updated_at
    `
    ).run({
      assetLowId,
      assetHighId,
      winnerId: input.winnerAssetId,
      eventId,
      createdAt: input.createdAt
    });

    recomputeRankings(db, input.createdAt);
  });

  transaction();

  return {
    eventId,
    assetIds: [input.leftAssetId, input.rightAssetId],
    replacedDecision
  };
}

export function undoComparisonDecision(
  db: AetherDatabase,
  decisionEventId: string,
  createdAt: string
): ComparisonUndoResult | null {
  const decision = db
    .prepare(
      `SELECT id, asset_low_id, asset_high_id, winner_id, previous_event_id
       FROM comparison_events
       WHERE id = ? AND event_type = 'decision'`
    )
    .get(decisionEventId) as PreferenceEventRow | undefined;

  if (!decision) {
    return null;
  }

  const current = db
    .prepare(
      `SELECT event_id
       FROM pair_preferences
       WHERE asset_low_id = ? AND asset_high_id = ?`
    )
    .get(decision.asset_low_id, decision.asset_high_id) as
    { event_id: string } | undefined;

  if (current?.event_id !== decisionEventId) {
    throw new ComparisonConflictError("comparison_changed");
  }

  const undoEventId = randomUUID();
  let restoredDecision = false;
  const transaction = db.transaction(() => {
    const previous = decision.previous_event_id
      ? (db
          .prepare(
            `SELECT id, asset_low_id, asset_high_id, winner_id, previous_event_id
             FROM comparison_events
             WHERE id = ? AND event_type = 'decision'`
          )
          .get(decision.previous_event_id) as PreferenceEventRow | undefined)
      : undefined;

    db.prepare(
      `
      INSERT INTO comparison_events
        (id, event_type, asset_low_id, asset_high_id, winner_id,
         previous_event_id, target_event_id, created_at)
      VALUES
        (@id, 'undo', @assetLowId, @assetHighId, NULL,
         @previousEventId, @targetEventId, @createdAt)
    `
    ).run({
      id: undoEventId,
      assetLowId: decision.asset_low_id,
      assetHighId: decision.asset_high_id,
      previousEventId: previous?.id ?? null,
      targetEventId: decision.id,
      createdAt
    });

    if (previous) {
      restoredDecision = true;
      db.prepare(
        `
        UPDATE pair_preferences
        SET winner_id = @winnerId, event_id = @eventId, updated_at = @createdAt
        WHERE asset_low_id = @assetLowId AND asset_high_id = @assetHighId
      `
      ).run({
        winnerId: previous.winner_id,
        eventId: previous.id,
        createdAt,
        assetLowId: decision.asset_low_id,
        assetHighId: decision.asset_high_id
      });
    } else {
      db.prepare(
        `DELETE FROM pair_preferences
         WHERE asset_low_id = ? AND asset_high_id = ?`
      ).run(decision.asset_low_id, decision.asset_high_id);
    }

    recomputeRankings(db, createdAt);
  });

  transaction();

  return {
    eventId: undoEventId,
    assetIds: [decision.asset_low_id, decision.asset_high_id],
    restoredDecision
  };
}

export function resetAssetComparisons(
  db: AetherDatabase,
  assetId: string,
  updatedAt: string
): { removedComparisonCount: number } | null {
  if (!assetsExist(db, [assetId])) {
    return null;
  }

  const removedComparisonCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM pair_preferences
         WHERE asset_low_id = ? OR asset_high_id = ?`
      )
      .get(assetId, assetId) as { total: number }
  ).total;

  if (removedComparisonCount === 0) {
    return { removedComparisonCount };
  }

  const transaction = db.transaction(() => {
    db.prepare(
      `DELETE FROM pair_preferences
       WHERE asset_low_id = ? OR asset_high_id = ?`
    ).run(assetId, assetId);
    recomputeRankings(db, updatedAt);
  });

  transaction();
  return { removedComparisonCount };
}

function recomputeRankings(db: AetherDatabase, updatedAt: string): void {
  const preferences = db
    .prepare(
      "SELECT asset_low_id, asset_high_id, winner_id FROM pair_preferences"
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
        .prepare("SELECT asset_id, manual_adjustment FROM asset_rankings")
        .all() as Array<{ asset_id: string; manual_adjustment: number }>
    ).map((row) => [row.asset_id, row.manual_adjustment])
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
    upsert.run({
      assetId,
      skill,
      comparisonScore,
      manualAdjustment:
        existingAdjustments.get(assetId) ??
        (storedManualScore === undefined
          ? 0
          : storedManualScore - comparisonScore),
      comparisonCount,
      updatedAt
    });
  }

  const activeIds = [...projections.keys()];
  const placeholders = activeIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM asset_rankings WHERE asset_id NOT IN (${placeholders})`
  ).run(...activeIds);
}

function assetsExist(db: AetherDatabase, assetIds: string[]): boolean {
  const query = db.prepare("SELECT id FROM assets WHERE id = ?");
  return assetIds.every((assetId) => Boolean(query.get(assetId)));
}

function canonicalPair(
  leftAssetId: string,
  rightAssetId: string
): [string, string] {
  return leftAssetId < rightAssetId
    ? [leftAssetId, rightAssetId]
    : [rightAssetId, leftAssetId];
}
