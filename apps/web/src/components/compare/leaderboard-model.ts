import type { AssetRecord } from "../../api/client";

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
    left.name.localeCompare(right.name)
  );
}
