import type { AssetRecord, ScoreFilter } from "../../api/client";

export interface LeaderboardEntry {
  asset: AssetRecord;
  rank: number | null;
}

export function buildLeaderboardEntries(
  assets: AssetRecord[]
): LeaderboardEntry[] {
  const sortedAssets = [...assets].sort(compareLeaderboardAssets);
  let previousScore: number | null = null;
  let previousRank: number | null = null;

  return sortedAssets.map((asset, index) => {
    if (asset.score === 0) {
      return { asset, rank: null };
    }

    const rank = asset.score === previousScore ? previousRank : index + 1;
    previousScore = asset.score;
    previousRank = rank;
    return { asset, rank };
  });
}

export function compareLeaderboardAssets(
  left: AssetRecord,
  right: AssetRecord
): number {
  if ((left.score === 0) !== (right.score === 0)) {
    return left.score === 0 ? 1 : -1;
  }

  return (
    right.score - left.score ||
    Number(right.favorite) - Number(left.favorite) ||
    right.mtimeMs - left.mtimeMs ||
    compareIds(left.id, right.id)
  );
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function leaderboardUpdateRequiresReload(
  currentAsset: AssetRecord | undefined,
  updatedAsset: AssetRecord,
  scoreFilter: ScoreFilter
): boolean {
  if (!currentAsset || !matchesScoreFilter(updatedAsset, scoreFilter)) {
    return true;
  }

  return (
    currentAsset.score !== updatedAsset.score ||
    currentAsset.favorite !== updatedAsset.favorite ||
    currentAsset.mtimeMs !== updatedAsset.mtimeMs ||
    currentAsset.name !== updatedAsset.name ||
    rankingProjectionChanged(currentAsset.ranking, updatedAsset.ranking)
  );
}

function rankingProjectionChanged(
  current: AssetRecord["ranking"],
  updated: AssetRecord["ranking"]
): boolean {
  if (!current || !updated) {
    return current !== updated;
  }

  return (
    current.skill !== updated.skill ||
    current.comparisonScore !== updated.comparisonScore ||
    current.manualAdjustment !== updated.manualAdjustment ||
    current.comparisonCount !== updated.comparisonCount
  );
}

function matchesScoreFilter(
  asset: AssetRecord,
  scoreFilter: ScoreFilter
): boolean {
  switch (scoreFilter) {
    case "favorites":
      return asset.favorite;
    case "ranked":
      return asset.score > 0;
    case "unranked":
      return asset.score === 0;
    case "all":
      return true;
  }
}
