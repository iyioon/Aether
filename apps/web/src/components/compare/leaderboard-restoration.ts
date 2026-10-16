import type { MediaTypeFilter, ScoreFilter } from "../../api/client";
import type { SessionScrollPosition } from "../scroll-restoration";

export const LEADERBOARD_PAGE_LIMIT = 48;
const MAX_RESTORED_ENTRIES = 10_000;

export function leaderboardScrollContextKey(query: {
  folderId: string | null;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
}): string {
  return JSON.stringify([
    query.folderId,
    query.mediaType,
    query.scoreFilter,
    query.search,
    [...query.tagFilters].sort()
  ]);
}

export function leaderboardRestoreCount(
  position: SessionScrollPosition | null,
  contextKey: string
): number {
  if (position?.contextKey !== contextKey) {
    return LEADERBOARD_PAGE_LIMIT;
  }

  return Math.min(
    MAX_RESTORED_ENTRIES,
    Math.max(
      LEADERBOARD_PAGE_LIMIT,
      position.loadedCount ?? 0,
      (position.index ?? -1) + 1
    )
  );
}

export function leaderboardAnchorOffset(
  position: SessionScrollPosition,
  anchorHeight: number
): number {
  const offset = position.anchorOffset ?? 0;
  // Negative offsets preserve the heading above the first visible entry.
  if (offset < 0 || !position.anchorSize || anchorHeight <= 0) {
    return offset;
  }
  return Math.min(1, offset / position.anchorSize) * anchorHeight;
}
