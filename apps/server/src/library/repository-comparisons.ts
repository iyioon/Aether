import { randomUUID } from "node:crypto";
import {
  advanceComparisonGeneration,
  getComparisonGeneration
} from "./comparison-generation.js";
import type { AetherDatabase } from "../db/database.js";
import { buildAssetFilterQuery } from "./asset-query.js";
import {
  comparisonPairKey,
  selectInformativePair,
  type ComparisonCandidate
} from "./ranking-model.js";
import { getFolder } from "./repository-folders.js";
import { recomputeAssetRankings } from "./repository-rankings.js";
import type {
  ComparisonDecisionInput,
  ComparisonDecisionResult,
  ComparisonPairOptions,
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
  constructor(
    public readonly code:
      | "comparison_changed"
      | "invalid_pair"
      | "comparison_mutation_conflict"
      | "comparison_session_reset"
  ) {
    super(code);
    this.name = "ComparisonConflictError";
  }
}

export function getNextComparisonPair(
  db: AetherDatabase,
  options: ComparisonPairOptions & {
    excludeAssetIds?: string[];
    preferredPairAssetIds?: [string, string];
  }
): ComparisonPairResult | null {
  const folder = getFolder(db, options.folderId);
  if (!folder) {
    return null;
  }

  const candidates = readComparisonCandidates(db, folder, options);

  if (candidates.length < 2) {
    return null;
  }

  const preferences = readComparisonPreferences(db);
  const preferredPair = options.preferredPairAssetIds;
  if (
    preferredPair &&
    preferredPair[0] !== preferredPair[1] &&
    preferredPair.every((id) => candidates.some((asset) => asset.id === id)) &&
    (candidates.length === 2 ||
      options.excludeAssetIds?.length !== 2 ||
      comparisonPairKey(...preferredPair) !==
        comparisonPairKey(
          options.excludeAssetIds[0]!,
          options.excludeAssetIds[1]!
        ))
  ) {
    return {
      leftAssetId: preferredPair[0],
      rightAssetId: preferredPair[1],
      progress: comparisonProgress(candidates, preferences)
    };
  }
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
    progress: comparisonProgress(candidates, preferences)
  };
}

export function prefetchComparisonPairs(
  db: AetherDatabase,
  options: ComparisonPairOptions & {
    count: number;
    excludePairs?: [string, string][];
  }
): ComparisonPairResult[] {
  const folder = getFolder(db, options.folderId);
  if (!folder) {
    return [];
  }
  const candidates = readComparisonCandidates(db, folder, options);
  if (candidates.length < 2) {
    return [];
  }
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const excludedPairKeys = new Set(
    (options.excludePairs ?? [])
      .filter(
        ([left, right]) =>
          left !== right && candidateIds.has(left) && candidateIds.has(right)
      )
      .map(([left, right]) => comparisonPairKey(left, right))
  );
  const availablePairCount =
    (candidates.length * (candidates.length - 1)) / 2 - excludedPairKeys.size;
  const count = Math.min(3, Math.max(0, options.count), availablePairCount);
  const preferences = readComparisonPreferences(db);
  const decidedPairs = new Set(
    preferences.map((preference) =>
      comparisonPairKey(preference.asset_low_id, preference.asset_high_id)
    )
  );
  const candidateModels = candidates.map((candidate) => ({
    id: candidate.id,
    skill: candidate.skill,
    comparisonCount: candidate.comparison_count
  }));
  const progress = comparisonProgress(candidates, preferences);
  const pairs: ComparisonPairResult[] = [];
  for (let index = 0; index < count; index += 1) {
    const selected = selectInformativePair(
      candidateModels,
      decidedPairs,
      [],
      Math.random,
      excludedPairKeys
    );
    excludedPairKeys.add(comparisonPairKey(...selected));
    const [leftAssetId, rightAssetId] =
      Math.random() < 0.5 ? selected : [selected[1], selected[0]];
    pairs.push({ leftAssetId, rightAssetId, progress });
  }
  return pairs;
}

export function resumeComparisonSession(
  db: AetherDatabase,
  options: Parameters<typeof getNextComparisonPair>[1] & {
    pairAssetIds: [string, string] | null;
    previousDecision: {
      eventId: string;
      pairAssetIds: [string, string];
    } | null;
  }
): {
  pair: ComparisonPairResult | null;
  previousDecision: { eventId: string; pair: ComparisonPairResult } | null;
} {
  const folder = getFolder(db, options.folderId);
  if (!folder) {
    return { pair: null, previousDecision: null };
  }

  const candidates = readComparisonCandidates(db, folder, options);
  const candidateIds = new Set(candidates.map((asset) => asset.id));
  const progress = comparisonProgress(
    candidates,
    readComparisonPreferences(db)
  );
  const makePair = ([leftAssetId, rightAssetId]: [string, string]) => ({
    leftAssetId,
    rightAssetId,
    progress
  });
  const pair =
    options.pairAssetIds?.every((assetId) => candidateIds.has(assetId)) &&
    options.pairAssetIds[0] !== options.pairAssetIds[1]
      ? makePair(options.pairAssetIds)
      : null;
  let previousDecision = null;
  if (options.previousDecision) {
    const decision = options.previousDecision;
    const [lowId, highId] = canonicalPair(...decision.pairAssetIds);
    const active = db
      .prepare(
        `SELECT 1 FROM pair_preferences
         WHERE event_id = ? AND asset_low_id = ? AND asset_high_id = ?`
      )
      .get(decision.eventId, lowId, highId);
    // A confirmed vote can move its assets out of an "unranked" filter.
    // Undo must remain available while folder/type/search/tag context matches.
    const undoScoreFilter =
      options.scoreFilter === "ranked" || options.scoreFilter === "unranked"
        ? "all"
        : options.scoreFilter;
    const undoCandidates = new Set(
      readComparisonCandidates(db, folder, {
        ...options,
        scoreFilter: undoScoreFilter
      }).map((asset) => asset.id)
    );
    if (active && decision.pairAssetIds.every((id) => undoCandidates.has(id))) {
      previousDecision = {
        eventId: decision.eventId,
        pair: makePair(decision.pairAssetIds)
      };
    }
  }
  return { pair, previousDecision };
}

export function recordComparisonDecision(
  db: AetherDatabase,
  input: ComparisonDecisionInput
): ComparisonDecisionResult | null {
  assertMutationGeneration(db, input.mutationId, input.comparisonGeneration);
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
  const eventId = input.mutationId ?? randomUUID();
  const receipt = db
    .prepare(
      `SELECT event_type, asset_low_id, asset_high_id, winner_id, previous_event_id
       FROM comparison_events WHERE id = ?`
    )
    .get(eventId) as (PreferenceEventRow & { event_type: string }) | undefined;
  if (receipt) {
    if (
      receipt.event_type !== "decision" ||
      receipt.asset_low_id !== assetLowId ||
      receipt.asset_high_id !== assetHighId ||
      receipt.winner_id !== input.winnerAssetId
    ) {
      throw new ComparisonConflictError("comparison_mutation_conflict");
    }
    return {
      eventId,
      assetIds: [input.leftAssetId, input.rightAssetId],
      replacedDecision: receipt.previous_event_id !== null
    };
  }
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

    recomputeAssetRankings(db, input.createdAt);
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
  createdAt: string,
  mutationId?: string,
  comparisonGeneration?: string
): ComparisonUndoResult | null {
  assertMutationGeneration(db, mutationId, comparisonGeneration);
  if (mutationId) {
    const receipt = db
      .prepare(
        `SELECT event_type, target_event_id, asset_low_id, asset_high_id, previous_event_id
         FROM comparison_events WHERE id = ?`
      )
      .get(mutationId) as
      | (PreferenceEventRow & { event_type: string; target_event_id: string })
      | undefined;
    if (receipt) {
      if (
        receipt.event_type !== "undo" ||
        receipt.target_event_id !== decisionEventId
      ) {
        throw new ComparisonConflictError("comparison_mutation_conflict");
      }
      return {
        eventId: mutationId,
        assetIds: [receipt.asset_low_id, receipt.asset_high_id],
        restoredDecision: receipt.previous_event_id !== null
      };
    }
  }
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

  const undoEventId = mutationId ?? randomUUID();
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

    recomputeAssetRankings(db, createdAt);
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

  const transaction = db.transaction(() => {
    // Invalidate every older uncertain intent conservatively, including one
    // that never reached the server and has no receipt or active preference.
    advanceComparisonGeneration(db, updatedAt);
    if (removedComparisonCount > 0) {
      db.prepare(
        `DELETE FROM pair_preferences
         WHERE asset_low_id = ? OR asset_high_id = ?`
      ).run(assetId, assetId);
      recomputeAssetRankings(db, updatedAt);
    }
  });

  transaction();
  return { removedComparisonCount };
}

function readComparisonCandidates(
  db: AetherDatabase,
  folder: NonNullable<ReturnType<typeof getFolder>>,
  options: Parameters<typeof getNextComparisonPair>[1]
) {
  const { whereClause, parameters } = buildAssetFilterQuery(folder, options);
  return db
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
}

function readComparisonPreferences(db: AetherDatabase): PreferenceRow[] {
  return db
    .prepare(
      "SELECT asset_low_id, asset_high_id, winner_id FROM pair_preferences"
    )
    .all() as PreferenceRow[];
}

function comparisonProgress(
  candidates: ReturnType<typeof readComparisonCandidates>,
  preferences: PreferenceRow[]
): ComparisonPairResult["progress"] {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  return {
    candidateCount: candidates.length,
    comparedCount: candidates.filter(
      (candidate) => (candidate.comparison_count ?? 0) > 0
    ).length,
    decidedPairCount: preferences.filter(
      (preference) =>
        candidateIds.has(preference.asset_low_id) &&
        candidateIds.has(preference.asset_high_id)
    ).length
  };
}

function assetsExist(db: AetherDatabase, assetIds: string[]): boolean {
  const query = db.prepare("SELECT id FROM assets WHERE id = ?");
  return assetIds.every((assetId) => Boolean(query.get(assetId)));
}

function assertMutationGeneration(
  db: AetherDatabase,
  mutationId: string | undefined,
  comparisonGeneration: string | undefined
): void {
  if (mutationId && comparisonGeneration !== getComparisonGeneration(db)) {
    throw new ComparisonConflictError("comparison_session_reset");
  }
}

function canonicalPair(
  leftAssetId: string,
  rightAssetId: string
): [string, string] {
  return leftAssetId < rightAssetId
    ? [leftAssetId, rightAssetId]
    : [rightAssetId, leftAssetId];
}
