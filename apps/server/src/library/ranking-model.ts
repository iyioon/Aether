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

  const assetIds = [...activeIds];
  const indexByAssetId = new Map(
    assetIds.map((assetId, index) => [assetId, index])
  );
  const comparisonCounts = new Uint32Array(assetIds.length);
  const winnerIndexes = new Uint32Array(preferences.length);
  const loserIndexes = new Uint32Array(preferences.length);

  preferences.forEach((preference, index) => {
    const lowIndex = indexByAssetId.get(preference.assetLowId)!;
    const highIndex = indexByAssetId.get(preference.assetHighId)!;
    const winnerIndex = indexByAssetId.get(preference.winnerId)!;
    winnerIndexes[index] = winnerIndex;
    loserIndexes[index] = winnerIndex === lowIndex ? highIndex : lowIndex;
    comparisonCounts[lowIndex] = comparisonCounts[lowIndex]! + 1;
    comparisonCounts[highIndex] = comparisonCounts[highIndex]! + 1;
  });

  const skills = new Float64Array(assetIds.length);
  const gradients = new Float64Array(assetIds.length);
  const curvatures = new Float64Array(assetIds.length);

  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
    gradients.fill(0);
    curvatures.fill(REGULARIZATION);

    for (let index = 0; index < preferences.length; index += 1) {
      const winnerIndex = winnerIndexes[index]!;
      const loserIndex = loserIndexes[index]!;
      const probability = logistic(skills[winnerIndex]! - skills[loserIndex]!);
      const residual = 1 - probability;
      const curvature = probability * (1 - probability);

      gradients[winnerIndex] = gradients[winnerIndex]! + residual;
      gradients[loserIndex] = gradients[loserIndex]! - residual;
      curvatures[winnerIndex] = curvatures[winnerIndex]! + curvature;
      curvatures[loserIndex] = curvatures[loserIndex]! + curvature;
    }

    let maxChange = 0;
    let skillTotal = 0;
    for (let index = 0; index < skills.length; index += 1) {
      const skill = skills[index]!;
      const gradient = gradients[index]! - REGULARIZATION * skill;
      const change = (FIT_DAMPING * gradient) / curvatures[index]!;
      skills[index] = skill + change;
      skillTotal += skills[index]!;
      maxChange = Math.max(maxChange, Math.abs(change));
    }

    const meanSkill = skillTotal / skills.length;
    for (let index = 0; index < skills.length; index += 1) {
      skills[index] = skills[index]! - meanSkill;
    }

    if (maxChange < CONVERGENCE_THRESHOLD) {
      break;
    }
  }

  return new Map(
    assetIds.map((assetId, index) => [
      assetId,
      {
        comparisonCount: comparisonCounts[index]!,
        comparisonScore: Math.max(
          1,
          Math.round(logistic(skills[index]!) * 100)
        ),
        skill: skills[index]!
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

  let minimumCount = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    minimumCount = Math.min(minimumCount, candidate.comparisonCount ?? 0);
  }
  const anchorPool = candidates.filter(
    (candidate) => (candidate.comparisonCount ?? 0) <= minimumCount + 1
  );
  const anchor = randomEntry(anchorPool, random);
  const excludedPair =
    excludedAssetIds.length === 2
      ? comparisonPairKey(excludedAssetIds[0]!, excludedAssetIds[1]!)
      : null;
  const opponents: ComparisonCandidate[] = [];
  const eligibleOpponents: ComparisonCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.id === anchor.id) {
      continue;
    }

    opponents.push(candidate);
    if (comparisonPairKey(anchor.id, candidate.id) !== excludedPair) {
      eligibleOpponents.push(candidate);
    }
  }
  const pool = eligibleOpponents.length > 0 ? eligibleOpponents : opponents;

  if (random() < 0.15) {
    return [anchor.id, randomEntry(pool, random).id];
  }

  let bestOpponent = pool[0]!;
  let bestCost = opponentCost(anchor, bestOpponent, decidedPairs, random);
  for (let index = 1; index < pool.length; index += 1) {
    const opponent = pool[index]!;
    const cost = opponentCost(anchor, opponent, decidedPairs, random);
    if (cost < bestCost) {
      bestOpponent = opponent;
      bestCost = cost;
    }
  }

  return [anchor.id, bestOpponent.id];
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
