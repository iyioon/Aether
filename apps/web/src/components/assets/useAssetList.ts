import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getAssets,
  type AssetRecord,
  type MediaTypeFilter,
  type RatingFilter,
  type SortDirection,
  type SortMode,
  type TagRecord,
  type TreeResponse
} from "../../api/client";
import {
  buildAssetListQueryKey,
  canRequestMoreAssets
} from "../gallery-loading";

const ASSET_PAGE_LIMIT = 80;

interface UseAssetListOptions {
  folderId: string | null;
  mediaType: MediaTypeFilter;
  ratingFilter: RatingFilter;
  search: string;
  sort: SortMode;
  sortDirection: SortDirection;
  tagFilter: string;
  tree: TreeResponse | null;
}

export function useAssetList({
  folderId,
  mediaType,
  ratingFilter,
  search,
  sort,
  sortDirection,
  tagFilter,
  tree
}: UseAssetListOptions) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [assetReloadToken, setAssetReloadToken] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const listQueryKey = useMemo(
    () =>
      buildAssetListQueryKey({
        folderId,
        sort,
        sortDirection,
        mediaType,
        search,
        tagFilter,
        ratingFilter
      }),
    [folderId, sort, sortDirection, mediaType, search, tagFilter, ratingFilter]
  );
  const listQueryKeyRef = useRef(listQueryKey);
  const hasMoreAssets = assets.length < totalAssets;

  useEffect(() => {
    listQueryKeyRef.current = listQueryKey;
  }, [listQueryKey]);

  useEffect(() => {
    if (!tree || !folderId) {
      setAssets([]);
      setTotalAssets(0);
      return;
    }

    let active = true;
    setIsLoadingAssets(true);
    setIsLoadingMore(false);
    setAssetError(null);

    getAssets({
      folderId,
      offset: 0,
      limit: ASSET_PAGE_LIMIT,
      sort,
      order: sortDirection,
      type: mediaType,
      recursive: true,
      search,
      tag: tagFilter,
      rating: ratingFilter
    })
      .then((response) => {
        if (active) {
          setAssets(response.items);
          setTotalAssets(response.page.total);
        }
      })
      .catch((caught) => {
        if (active) {
          const message =
            caught instanceof ApiError ? caught.code : "Unable to load assets.";
          setAssetError(message);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingAssets(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    tree,
    folderId,
    sort,
    sortDirection,
    mediaType,
    search,
    tagFilter,
    ratingFilter,
    assetReloadToken
  ]);

  const reloadAssets = useCallback(() => {
    setAssetReloadToken((current) => current + 1);
  }, []);

  const mergeUpdatedAssets = useCallback((updatedAssets: AssetRecord[]) => {
    const updatedAssetById = new Map(
      updatedAssets.map((asset) => [asset.id, asset])
    );

    setAssets((currentAssets) =>
      currentAssets.map((asset) => updatedAssetById.get(asset.id) ?? asset)
    );
  }, []);

  const updateAssetTags = useCallback((assetId: string, tags: TagRecord[]) => {
    setAssets((currentAssets) =>
      currentAssets.map((asset) =>
        asset.id === assetId ? { ...asset, tags } : asset
      )
    );
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (
      !folderId ||
      !canRequestMoreAssets({
        folderId,
        isLoadingMore,
        isRequestInFlight: loadMoreInFlightRef.current,
        loadedCount: assets.length,
        totalCount: totalAssets
      })
    ) {
      return;
    }

    const requestQueryKey = listQueryKey;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    setAssetError(null);

    try {
      const response = await getAssets({
        folderId,
        offset: assets.length,
        limit: ASSET_PAGE_LIMIT,
        sort,
        order: sortDirection,
        type: mediaType,
        recursive: true,
        search,
        tag: tagFilter,
        rating: ratingFilter
      });

      if (listQueryKeyRef.current !== requestQueryKey) {
        return;
      }

      setAssets((currentAssets) => {
        const existingIds = new Set(currentAssets.map((asset) => asset.id));
        const nextAssets = response.items.filter(
          (asset) => !existingIds.has(asset.id)
        );

        return [...currentAssets, ...nextAssets];
      });
      setTotalAssets(response.page.total);
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.code : "Unable to load more assets.";
      setAssetError(message);
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [
    assets.length,
    folderId,
    isLoadingMore,
    listQueryKey,
    mediaType,
    ratingFilter,
    search,
    sort,
    sortDirection,
    tagFilter,
    totalAssets
  ]);

  return {
    assetError,
    assets,
    handleLoadMore,
    hasMoreAssets,
    isLoadingAssets,
    isLoadingMore,
    listQueryKey,
    loadMoreRef,
    mergeUpdatedAssets,
    reloadAssets,
    setAssetError,
    totalAssets,
    updateAssetTags
  };
}
