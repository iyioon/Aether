import { randomUUID } from "node:crypto";
import type { AetherDatabase } from "../db/database.js";
import { getFolder } from "./repository-folders.js";
import { normalizeTagSearch } from "./repository-tags.js";
import type {
  AssetListOptions,
  ComparisonDecisionInput,
  ComparisonDecisionResult,
  ComparisonPairResult,
  ComparisonUndoResult
} from "./repository-types.js";
import { assetSearchQuery } from "./search-text.js";

const REGULARIZATION = 1;
const FIT_ITERATIONS = 80;
const FIT_DAMPING = 0.55;
const EFFECTIVE_RATING_SQL =
  "CASE WHEN ar.asset_id IS NOT NULL THEN MAX(0, ar.score + ar.manual_offset) ELSE r.rating END";

interface ComparisonCandidateRow {
  id: string;
  skill: number | null;
  comparison_count: number | null;
}

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
  options: Omit<AssetListOptions, "offset" | "limit" | "sort" | "sortDirection"> & {
    excludeAssetIds?: string[];
  }
): ComparisonPairResult | null {
  const folder = getFolder(db, options.folderId);
  if (!folder) {
    return null;
  }

  const { filters, parameters } = comparisonFilters(folder, options);
  const candidates = db
    .prepare(
      `SELECT
        a.id,
        ar.skill,
        ar.comparison_count
      FROM assets a
      LEFT JOIN ratings r ON r.asset_id = a.id
      LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
      WHERE ${filters.join(" AND ")}`
    )
    .all(parameters) as ComparisonCandidateRow[];

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
      pairKey(preference.asset_low_id, preference.asset_high_id)
    )
  );
  const selected = selectInformativePair(
    candidates,
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

    db.prepare(`
      INSERT INTO comparison_events
        (id, event_type, asset_low_id, asset_high_id, winner_id,
         previous_event_id, target_event_id, created_at)
      VALUES
        (@id, 'decision', @assetLowId, @assetHighId, @winnerId,
         @previousEventId, NULL, @createdAt)
    `).run({
      id: eventId,
      assetLowId,
      assetHighId,
      winnerId: input.winnerAssetId,
      previousEventId: current?.event_id ?? null,
      createdAt: input.createdAt
    });

    db.prepare(`
      INSERT INTO pair_preferences
        (asset_low_id, asset_high_id, winner_id, event_id, updated_at)
      VALUES
        (@assetLowId, @assetHighId, @winnerId, @eventId, @createdAt)
      ON CONFLICT(asset_low_id, asset_high_id) DO UPDATE SET
        winner_id = excluded.winner_id,
        event_id = excluded.event_id,
        updated_at = excluded.updated_at
    `).run({
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
    | { event_id: string }
    | undefined;

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

    db.prepare(`
      INSERT INTO comparison_events
        (id, event_type, asset_low_id, asset_high_id, winner_id,
         previous_event_id, target_event_id, created_at)
      VALUES
        (@id, 'undo', @assetLowId, @assetHighId, NULL,
         @previousEventId, @targetEventId, @createdAt)
    `).run({
      id: undoEventId,
      assetLowId: decision.asset_low_id,
      assetHighId: decision.asset_high_id,
      previousEventId: previous?.id ?? null,
      targetEventId: decision.id,
      createdAt
    });

    if (previous) {
      restoredDecision = true;
      db.prepare(`
        UPDATE pair_preferences
        SET winner_id = @winnerId, event_id = @eventId, updated_at = @createdAt
        WHERE asset_low_id = @assetLowId AND asset_high_id = @assetHighId
      `).run({
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

function recomputeRankings(db: AetherDatabase, updatedAt: string): void {
  const preferences = db
    .prepare(
      "SELECT asset_low_id, asset_high_id, winner_id FROM pair_preferences"
    )
    .all() as PreferenceRow[];
  const activeIds = new Set<string>();
  const comparisonCounts = new Map<string, number>();

  for (const preference of preferences) {
    activeIds.add(preference.asset_low_id);
    activeIds.add(preference.asset_high_id);
    comparisonCounts.set(
      preference.asset_low_id,
      (comparisonCounts.get(preference.asset_low_id) ?? 0) + 1
    );
    comparisonCounts.set(
      preference.asset_high_id,
      (comparisonCounts.get(preference.asset_high_id) ?? 0) + 1
    );
  }

  if (activeIds.size === 0) {
    db.prepare("DELETE FROM asset_rankings").run();
    return;
  }

  const skills = new Map([...activeIds].map((assetId) => [assetId, 0]));

  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
    const gradients = new Map([...activeIds].map((assetId) => [assetId, 0]));
    const curvatures = new Map(
      [...activeIds].map((assetId) => [assetId, REGULARIZATION])
    );

    for (const preference of preferences) {
      const loserId =
        preference.winner_id === preference.asset_low_id
          ? preference.asset_high_id
          : preference.asset_low_id;
      const winnerSkill = skills.get(preference.winner_id) ?? 0;
      const loserSkill = skills.get(loserId) ?? 0;
      const probability = logistic(winnerSkill - loserSkill);
      const residual = 1 - probability;
      const curvature = probability * (1 - probability);

      gradients.set(
        preference.winner_id,
        (gradients.get(preference.winner_id) ?? 0) + residual
      );
      gradients.set(loserId, (gradients.get(loserId) ?? 0) - residual);
      curvatures.set(
        preference.winner_id,
        (curvatures.get(preference.winner_id) ?? REGULARIZATION) + curvature
      );
      curvatures.set(
        loserId,
        (curvatures.get(loserId) ?? REGULARIZATION) + curvature
      );
    }

    let maxChange = 0;
    for (const assetId of activeIds) {
      const skill = skills.get(assetId) ?? 0;
      const gradient = (gradients.get(assetId) ?? 0) - REGULARIZATION * skill;
      const change = FIT_DAMPING * gradient / (curvatures.get(assetId) ?? 1);
      skills.set(assetId, skill + change);
      maxChange = Math.max(maxChange, Math.abs(change));
    }

    const mean =
      [...skills.values()].reduce((total, value) => total + value, 0) /
      skills.size;
    for (const [assetId, skill] of skills) {
      skills.set(assetId, skill - mean);
    }

    if (maxChange < 0.00001) {
      break;
    }
  }

  const existingOffsets = new Map(
    (
      db
        .prepare("SELECT asset_id, manual_offset FROM asset_rankings")
        .all() as Array<{ asset_id: string; manual_offset: number }>
    ).map((row) => [row.asset_id, row.manual_offset])
  );
  const upsert = db.prepare(`
    INSERT INTO asset_rankings
      (asset_id, skill, score, manual_offset, comparison_count, updated_at)
    VALUES
      (@assetId, @skill, @score, @manualOffset, @comparisonCount, @updatedAt)
    ON CONFLICT(asset_id) DO UPDATE SET
      skill = excluded.skill,
      score = excluded.score,
      comparison_count = excluded.comparison_count,
      updated_at = excluded.updated_at
  `);

  for (const [assetId, skill] of skills) {
    upsert.run({
      assetId,
      skill,
      score: Math.round(logistic(skill) * 100),
      manualOffset: existingOffsets.get(assetId) ?? 0,
      comparisonCount: comparisonCounts.get(assetId) ?? 0,
      updatedAt
    });
  }

  const placeholders = [...activeIds].map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM asset_rankings WHERE asset_id NOT IN (${placeholders})`
  ).run(...activeIds);
}

function comparisonFilters(
  folder: { rootId: string; relativePath: string },
  options: Omit<AssetListOptions, "offset" | "limit" | "sort" | "sortDirection">
): {
  filters: string[];
  parameters: Record<string, string | number>;
} {
  const parameters: Record<string, string | number> = {
    rootId: folder.rootId,
    folderId: options.folderId
  };
  const filters = ["a.root_id = @rootId"];

  if (options.recursive) {
    if (folder.relativePath !== "") {
      parameters.relativePath = folder.relativePath;
      parameters.relativePrefix = `${folder.relativePath}/%`;
      filters.push(
        "(a.relative_path = @relativePath OR a.relative_path LIKE @relativePrefix)"
      );
    }
  } else {
    filters.push("a.folder_id = @folderId");
  }

  if (options.type !== "all") {
    parameters.mediaType = options.type;
    filters.push("a.media_type = @mediaType");
  }

  const searchQuery = assetSearchQuery(options.search ?? "");
  if (searchQuery) {
    parameters.searchQuery = searchQuery;
    filters.push(
      "a.id IN (SELECT asset_id FROM asset_search WHERE asset_search MATCH @searchQuery)"
    );
  }

  [...new Set((options.tags ?? []).map(normalizeTagSearch).filter(Boolean))]
    .forEach((tagFilter, index) => {
      const parameterName = `tagFilter${index}`;
      parameters[parameterName] = tagFilter;
      filters.push(
        `EXISTS (
           SELECT 1
           FROM asset_tags at
           JOIN tags t ON t.id = at.tag_id
           WHERE at.asset_id = a.id AND t.normalized_name = @${parameterName}
         )`
      );
    });

  switch (options.ratingFilter ?? "all") {
    case "favorites":
      filters.push("COALESCE(r.favorite, 0) = 1");
      break;
    case "rated":
      filters.push(`${EFFECTIVE_RATING_SQL} IS NOT NULL`);
      break;
    case "unrated":
      filters.push(`${EFFECTIVE_RATING_SQL} IS NULL`);
      break;
    default:
      break;
  }

  return { filters, parameters };
}

function selectInformativePair(
  candidates: ComparisonCandidateRow[],
  decidedPairs: Set<string>,
  excludedAssetIds: string[]
): [string, string] {
  const minimumCount = Math.min(
    ...candidates.map((candidate) => candidate.comparison_count ?? 0)
  );
  const anchorPool = candidates.filter(
    (candidate) => (candidate.comparison_count ?? 0) <= minimumCount + 1
  );
  const anchor = anchorPool[Math.floor(Math.random() * anchorPool.length)]!;
  const excludedPair =
    excludedAssetIds.length === 2
      ? pairKey(excludedAssetIds[0]!, excludedAssetIds[1]!)
      : null;
  const opponents = candidates.filter((candidate) => candidate.id !== anchor.id);
  const eligibleOpponents = opponents.filter(
    (candidate) => pairKey(anchor.id, candidate.id) !== excludedPair
  );
  const pool = eligibleOpponents.length > 0 ? eligibleOpponents : opponents;

  if (Math.random() < 0.15) {
    const opponent = pool[Math.floor(Math.random() * pool.length)]!;
    return [anchor.id, opponent.id];
  }

  const ranked = [...pool].sort((left, right) => {
    const leftCost = opponentCost(anchor, left, decidedPairs);
    const rightCost = opponentCost(anchor, right, decidedPairs);
    return leftCost - rightCost;
  });

  return [anchor.id, ranked[0]!.id];
}

function opponentCost(
  anchor: ComparisonCandidateRow,
  opponent: ComparisonCandidateRow,
  decidedPairs: Set<string>
): number {
  const repeatCost = decidedPairs.has(pairKey(anchor.id, opponent.id)) ? 2 : 0;
  const uncertaintyCost = Math.abs((anchor.skill ?? 0) - (opponent.skill ?? 0));
  const exposureCost = (opponent.comparison_count ?? 0) * 0.03;
  return repeatCost + uncertaintyCost + exposureCost + Math.random() * 0.08;
}

function assetsExist(db: AetherDatabase, assetIds: string[]): boolean {
  const query = db.prepare("SELECT id FROM assets WHERE id = ?");
  return assetIds.every((assetId) => Boolean(query.get(assetId)));
}

function canonicalPair(leftAssetId: string, rightAssetId: string): [string, string] {
  return leftAssetId < rightAssetId
    ? [leftAssetId, rightAssetId]
    : [rightAssetId, leftAssetId];
}

function pairKey(leftAssetId: string, rightAssetId: string): string {
  return canonicalPair(leftAssetId, rightAssetId).join("\u0000");
}

function logistic(value: number): number {
  const bounded = Math.max(-20, Math.min(20, value));
  return 1 / (1 + Math.exp(-bounded));
}
