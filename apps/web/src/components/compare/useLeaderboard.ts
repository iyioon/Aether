import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getAssets,
  type AssetRecord,
  type MediaTypeFilter,
  type ScoreFilter
} from "../../api/client";
import { compareLeaderboardAssets } from "./leaderboard-model";

const LEADERBOARD_PAGE_LIMIT = 48;

interface UseLeaderboardOptions {
  assetUpdate: AssetRecord | null;
  folderId: string | null;
  mediaType: MediaTypeFilter;
  refreshRevision: number;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
}

export function useLeaderboard({
  assetUpdate,
  folderId,
  mediaType,
  refreshRevision,
  scoreFilter,
  search,
  tagFilters
}: UseLeaderboardOptions) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  const loadMoreInFlightRef = useRef(false);
  const queryKey = useMemo(
    () =>
      [
        folderId ?? "",
        mediaType,
        scoreFilter,
        search,
        refreshRevision,
        reloadRevision,
        ...tagFilters
      ].join("\u0000"),
    [
      folderId,
      mediaType,
      refreshRevision,
      reloadRevision,
      scoreFilter,
      search,
      tagFilters
    ]
  );
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  useEffect(() => {
    if (!folderId) {
      setAssets([]);
      setTotal(0);
      setError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      return;
    }

    let active = true;
    const requestQueryKey = queryKey;
    setAssets([]);
    setTotal(0);
    setError(null);
    setIsLoading(true);
    setIsLoadingMore(false);

    getAssets({
      folderId,
      offset: 0,
      limit: LEADERBOARD_PAGE_LIMIT,
      sort: "score",
      order: "desc",
      type: mediaType,
      recursive: true,
      search,
      tags: tagFilters,
      score: scoreFilter
    })
      .then((response) => {
        if (active && queryKeyRef.current === requestQueryKey) {
          setAssets(response.items);
          setTotal(response.page.total);
        }
      })
      .catch((caught) => {
        if (active && queryKeyRef.current === requestQueryKey) {
          setError(
            caught instanceof ApiError
              ? caught.code
              : "Unable to load the leaderboard."
          );
        }
      })
      .finally(() => {
        if (active && queryKeyRef.current === requestQueryKey) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [folderId, mediaType, queryKey, scoreFilter, search, tagFilters]);

  useEffect(() => {
    if (!assetUpdate) {
      return;
    }

    if (!matchesScoreFilter(assetUpdate, scoreFilter)) {
      setReloadRevision((current) => current + 1);
      return;
    }

    setAssets((currentAssets) => {
      const currentIndex = currentAssets.findIndex(
        (asset) => asset.id === assetUpdate.id
      );
      if (currentIndex === -1) {
        return currentAssets;
      }

      return currentAssets
        .map((asset) => (asset.id === assetUpdate.id ? assetUpdate : asset))
        .sort(compareLeaderboardAssets);
    });
  }, [assetUpdate, scoreFilter]);

  const loadMore = useCallback(async () => {
    if (!folderId || assets.length >= total || loadMoreInFlightRef.current) {
      return;
    }

    const requestQueryKey = queryKey;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    setError(null);

    try {
      const response = await getAssets({
        folderId,
        offset: assets.length,
        limit: LEADERBOARD_PAGE_LIMIT,
        sort: "score",
        order: "desc",
        type: mediaType,
        recursive: true,
        search,
        tags: tagFilters,
        score: scoreFilter
      });

      if (queryKeyRef.current !== requestQueryKey) {
        return;
      }

      setAssets((currentAssets) => {
        const existingIds = new Set(currentAssets.map((asset) => asset.id));
        return [
          ...currentAssets,
          ...response.items.filter((asset) => !existingIds.has(asset.id))
        ];
      });
      setTotal(response.page.total);
    } catch (caught) {
      if (queryKeyRef.current === requestQueryKey) {
        setError(
          caught instanceof ApiError
            ? caught.code
            : "Unable to load more leaderboard entries."
        );
      }
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [
    assets.length,
    folderId,
    mediaType,
    queryKey,
    scoreFilter,
    search,
    tagFilters,
    total
  ]);

  return {
    assets,
    error,
    hasMore: assets.length < total,
    isLoading,
    isLoadingMore,
    loadMore,
    reload: () => setReloadRevision((current) => current + 1),
    total
  };
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
