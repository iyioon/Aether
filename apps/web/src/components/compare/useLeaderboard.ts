import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getAssets,
  type AssetRecord,
  type MediaTypeFilter,
  type ScoreFilter
} from "../../api/client";
import { leaderboardUpdateRequiresReload } from "./leaderboard-model";
import { readSessionScrollPosition } from "../scroll-restoration";
import {
  LEADERBOARD_PAGE_LIMIT,
  leaderboardRestoreCount,
  leaderboardScrollContextKey
} from "./leaderboard-restoration";

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
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const loadMoreInFlightRef = useRef(false);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const scrollContextKey = useMemo(
    () =>
      leaderboardScrollContextKey({
        folderId,
        mediaType,
        scoreFilter,
        search,
        tagFilters
      }),
    [folderId, mediaType, scoreFilter, search, tagFilters]
  );
  const queryKey = useMemo(
    () => JSON.stringify([scrollContextKey, refreshRevision, reloadRevision]),
    [scrollContextKey, refreshRevision, reloadRevision]
  );
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  useEffect(() => {
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadMoreInFlightRef.current = false;

    if (!folderId) {
      setAssets([]);
      setTotal(0);
      setError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      setLoadedQueryKey(null);
      return;
    }

    const controller = new AbortController();
    const requestQueryKey = queryKey;
    setAssets([]);
    setTotal(0);
    setError(null);
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadedQueryKey(null);

    const restoreCount = leaderboardRestoreCount(
      readSessionScrollPosition("leaderboard"),
      scrollContextKey
    );
    const loadRestoredEntries = async () => {
      const items: AssetRecord[] = [];
      let pageTotal = 0;
      do {
        const response = await getAssets({
          folderId,
          offset: items.length,
          limit: Math.min(250, restoreCount - items.length),
          sort: "score",
          order: "desc",
          type: mediaType,
          recursive: true,
          search,
          tags: tagFilters,
          score: scoreFilter,
          signal: controller.signal
        });
        if (
          controller.signal.aborted ||
          queryKeyRef.current !== requestQueryKey
        ) {
          return null;
        }
        items.push(...response.items);
        pageTotal = response.page.total;
        if (response.items.length === 0) {
          break;
        }
      } while (items.length < restoreCount && items.length < pageTotal);
      return { items, total: pageTotal };
    };

    loadRestoredEntries()
      .then((response) => {
        if (
          response &&
          !controller.signal.aborted &&
          queryKeyRef.current === requestQueryKey
        ) {
          setAssets(response.items);
          setTotal(response.total);
          setLoadedQueryKey(requestQueryKey);
        }
      })
      .catch((caught) => {
        if (
          !controller.signal.aborted &&
          queryKeyRef.current === requestQueryKey
        ) {
          setError(
            caught instanceof ApiError
              ? caught.code
              : "Unable to load the leaderboard."
          );
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          queryKeyRef.current === requestQueryKey
        ) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
      loadMoreAbortRef.current?.abort();
      loadMoreAbortRef.current = null;
      loadMoreInFlightRef.current = false;
    };
  }, [
    folderId,
    mediaType,
    queryKey,
    scoreFilter,
    scrollContextKey,
    search,
    tagFilters
  ]);

  useEffect(() => {
    if (!assetUpdate) {
      return;
    }

    const currentAsset = assetsRef.current.find(
      (asset) => asset.id === assetUpdate.id
    );
    if (
      leaderboardUpdateRequiresReload(currentAsset, assetUpdate, scoreFilter)
    ) {
      setReloadRevision((current) => current + 1);
      return;
    }

    setAssets((currentAssets) => {
      return currentAssets.map((asset) =>
        asset.id === assetUpdate.id ? assetUpdate : asset
      );
    });
  }, [assetUpdate, scoreFilter]);

  const loadMore = useCallback(async () => {
    if (!folderId || assets.length >= total || loadMoreInFlightRef.current) {
      return;
    }

    const requestQueryKey = queryKey;
    const controller = new AbortController();
    loadMoreInFlightRef.current = true;
    loadMoreAbortRef.current = controller;
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
        score: scoreFilter,
        signal: controller.signal
      });

      if (
        controller.signal.aborted ||
        queryKeyRef.current !== requestQueryKey
      ) {
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
      if (
        !controller.signal.aborted &&
        queryKeyRef.current === requestQueryKey
      ) {
        setError(
          caught instanceof ApiError
            ? caught.code
            : "Unable to load more leaderboard entries."
        );
      }
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        loadMoreInFlightRef.current = false;
        setIsLoadingMore(false);
      }
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
    isContentReady: loadedQueryKey === queryKey,
    isLoading,
    isLoadingMore,
    loadMore,
    reload: () => setReloadRevision((current) => current + 1),
    scrollContextKey,
    total
  };
}
