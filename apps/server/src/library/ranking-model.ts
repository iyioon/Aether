const REGULARIZATION = 1;
const FIT_ITERATIONS = 80;
const FIT_DAMPING = 0.55;
const CONVERGENCE_THRESHOLD = 0.00001;

export interface RankingPreference {
  assetLowId: string;
  assetHighId: string;
  winnerId: string;
}

export interface RankingProjection {
  comparisonCount: number;
  comparisonScore: number;
  skill: number;
}

export interface ComparisonCandidate {
  id: string;
  skill: number | null;
  comparisonCount: number | null;
}

type RandomSource = () => number;

export function fitRankingModel(
  preferences: RankingPreference[]
): Map<string, RankingProjection> {
  const activeIds = collectActiveIds(preferences);
  if (activeIds.size === 0) {
    return new Map();
  }

  const comparisonCounts = countComparisons(preferences);
  const skills = new Map([...activeIds].map((assetId) => [assetId, 0]));

  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
    const gradients = new Map([...activeIds].map((assetId) => [assetId, 0]));
    const curvatures = new Map(
      [...activeIds].map((assetId) => [assetId, REGULARIZATION])
    );

    for (const preference of preferences) {
      const loserId =
        preference.winnerId === preference.assetLowId
          ? preference.assetHighId
          : preference.assetLowId;
      const probability = logistic(
        (skills.get(preference.winnerId) ?? 0) - (skills.get(loserId) ?? 0)
      );
      const residual = 1 - probability;
      const curvature = probability * (1 - probability);

      gradients.set(
        preference.winnerId,
        (gradients.get(preference.winnerId) ?? 0) + residual
      );
      gradients.set(loserId, (gradients.get(loserId) ?? 0) - residual);
      curvatures.set(
        preference.winnerId,
        (curvatures.get(preference.winnerId) ?? REGULARIZATION) + curvature
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
      const change = (FIT_DAMPING * gradient) / (curvatures.get(assetId) ?? 1);
      skills.set(assetId, skill + change);
      maxChange = Math.max(maxChange, Math.abs(change));
    }

    centerSkills(skills);
    if (maxChange < CONVERGENCE_THRESHOLD) {
      break;
    }
  }

  return new Map(
    [...skills].map(([assetId, skill]) => [
      assetId,
      {
        comparisonCount: comparisonCounts.get(assetId) ?? 0,
        comparisonScore: Math.round(logistic(skill) * 100),
        skill
      }
    ])
  );
}

export function selectInformativePair(
  candidates: ComparisonCandidate[],
  decidedPairs: ReadonlySet<string>,
  excludedAssetIds: string[],
  random: RandomSource = Math.random
): [string, string] {
  if (candidates.length < 2) {
    throw new Error("At least two candidates are required.");
  }

  const minimumCount = Math.min(
    ...candidates.map((candidate) => candidate.comparisonCount ?? 0)
  );
  const anchorPool = candidates.filter(
    (candidate) => (candidate.comparisonCount ?? 0) <= minimumCount + 1
  );
  const anchor = randomEntry(anchorPool, random);
  const excludedPair =
    excludedAssetIds.length === 2
      ? comparisonPairKey(excludedAssetIds[0]!, excludedAssetIds[1]!)
      : null;
  const opponents = candidates.filter(
    (candidate) => candidate.id !== anchor.id
  );
  const eligibleOpponents = opponents.filter(
    (candidate) => comparisonPairKey(anchor.id, candidate.id) !== excludedPair
  );
  const pool = eligibleOpponents.length > 0 ? eligibleOpponents : opponents;

  if (random() < 0.15) {
    return [anchor.id, randomEntry(pool, random).id];
  }

  const ranked = pool
    .map((opponent) => ({
      opponent,
      cost: opponentCost(anchor, opponent, decidedPairs, random)
    }))
    .sort((left, right) => left.cost - right.cost);

  return [anchor.id, ranked[0]!.opponent.id];
}

export function comparisonPairKey(leftAssetId: string, rightAssetId: string) {
  return canonicalPair(leftAssetId, rightAssetId).join("\u0000");
}

function collectActiveIds(preferences: RankingPreference[]): Set<string> {
  const activeIds = new Set<string>();
  for (const preference of preferences) {
    activeIds.add(preference.assetLowId);
    activeIds.add(preference.assetHighId);
  }
  return activeIds;
}

function countComparisons(
  preferences: RankingPreference[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const preference of preferences) {
    counts.set(
      preference.assetLowId,
      (counts.get(preference.assetLowId) ?? 0) + 1
    );
    counts.set(
      preference.assetHighId,
      (counts.get(preference.assetHighId) ?? 0) + 1
    );
  }
  return counts;
}

function centerSkills(skills: Map<string, number>): void {
  const mean =
    [...skills.values()].reduce((total, value) => total + value, 0) /
    skills.size;
  for (const [assetId, skill] of skills) {
    skills.set(assetId, skill - mean);
  }
}

function opponentCost(
  anchor: ComparisonCandidate,
  opponent: ComparisonCandidate,
  decidedPairs: ReadonlySet<string>,
  random: RandomSource
): number {
  const repeatCost = decidedPairs.has(comparisonPairKey(anchor.id, opponent.id))
    ? 2
    : 0;
  const uncertaintyCost = Math.abs((anchor.skill ?? 0) - (opponent.skill ?? 0));
  const exposureCost = (opponent.comparisonCount ?? 0) * 0.03;
  return repeatCost + uncertaintyCost + exposureCost + random() * 0.08;
}

function canonicalPair(
  leftAssetId: string,
  rightAssetId: string
): [string, string] {
  return leftAssetId < rightAssetId
    ? [leftAssetId, rightAssetId]
    : [rightAssetId, leftAssetId];
}

function randomEntry<T>(entries: T[], random: RandomSource): T {
  return entries[Math.floor(random() * entries.length)]!;
}

function logistic(value: number): number {
  const bounded = Math.max(-20, Math.min(20, value));
  return 1 / (1 + Math.exp(-bounded));
}
