import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getAssets,
  type AssetRecord,
  type MediaTypeFilter,
  type ScoreFilter,
  type TagMatch,
  type TagStatus
} from "../../api/client";
import { leaderboardUpdateRequiresReload } from "./leaderboard-model";
import { readAssetAppend, readAssetWindow } from "../assets/asset-window";
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
  tagMatch?: TagMatch;
  tagStatus?: TagStatus;
}

export function useLeaderboard({
  assetUpdate,
  folderId,
  mediaType,
  refreshRevision,
  scoreFilter,
  search,
  tagFilters,
  tagMatch = "all",
  tagStatus = "all"
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
  const revisionRef = useRef<string | undefined>(undefined);
  const loadedContextRef = useRef<string | null>(null);
  const scrollContextKey = useMemo(
    () =>
      leaderboardScrollContextKey({
        folderId,
        mediaType,
        scoreFilter,
        search,
        tagFilters,
        tagMatch,
        tagStatus
      }),
    [folderId, mediaType, scoreFilter, search, tagFilters, tagMatch, tagStatus]
  );
  const queryKey = useMemo(
    () => JSON.stringify([scrollContextKey, refreshRevision, reloadRevision]),
    [scrollContextKey, refreshRevision, reloadRevision]
  );
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const getPage = useCallback(
    (
      offset: number,
      limit: number,
      signal: AbortSignal,
      expectedRevision?: string
    ) =>
      getAssets({
        folderId: folderId!,
        offset,
        limit,
        sort: "score",
        order: "desc",
        type: mediaType,
        recursive: true,
        search,
        tags: tagFilters,
        tagMatch,
        tagStatus,
        score: scoreFilter,
        expectedRevision,
        signal
      }),
    [folderId, mediaType, search, tagFilters, tagMatch, tagStatus, scoreFilter]
  );

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
      revisionRef.current = undefined;
      loadedContextRef.current = null;
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

    const restoreCount = Math.max(
      leaderboardRestoreCount(
        readSessionScrollPosition("leaderboard"),
        scrollContextKey
      ),
      loadedContextRef.current === scrollContextKey
        ? assetsRef.current.length
        : 0
    );
    readAssetWindow(
      restoreCount,
      (offset, limit, revision) =>
        getPage(offset, limit, controller.signal, revision),
      controller.signal
    )
      .then((response) => {
        if (
          !controller.signal.aborted &&
          queryKeyRef.current === requestQueryKey
        ) {
          setAssets(response.items);
          setTotal(response.page.total);
          revisionRef.current = response.page.revision;
          loadedContextRef.current = scrollContextKey;
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
  }, [folderId, getPage, queryKey, scrollContextKey]);

  useEffect(() => {
    if (!assetUpdate) {
      return;
    }

    const currentAsset = assetsRef.current.find(
      (asset) => asset.id === assetUpdate.id
    );
    if (
      leaderboardUpdateRequiresReload(
        currentAsset,
        assetUpdate,
        scoreFilter,
        tagFilters.length > 0 || tagStatus !== "all"
      )
    ) {
      setReloadRevision((current) => current + 1);
      return;
    }

    setAssets((currentAssets) => {
      return currentAssets.map((asset) =>
        asset.id === assetUpdate.id ? assetUpdate : asset
      );
    });
  }, [assetUpdate, scoreFilter, tagFilters.length, tagStatus]);

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
      const result = await readAssetAppend({
        assets: assetsRef.current,
        revision: revisionRef.current,
        getPage: (offset, limit, revision) =>
          getPage(offset, limit, controller.signal, revision),
        signal: controller.signal,
        limit: LEADERBOARD_PAGE_LIMIT
      });

      if (
        controller.signal.aborted ||
        queryKeyRef.current !== requestQueryKey
      ) {
        return;
      }
      if (!result) {
        setReloadRevision((current) => current + 1);
        return;
      }
      const { response, refreshed } = result;
      revisionRef.current = response.page.revision;
      setAssets((currentAssets) => [
        ...(refreshed?.items ?? currentAssets),
        ...response.items
      ]);
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
  }, [assets.length, folderId, getPage, queryKey, total]);

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
