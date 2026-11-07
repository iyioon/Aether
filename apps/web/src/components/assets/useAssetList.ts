import { preservePresentation } from "../media/presentation-record";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getAssets,
  getAssetDetails,
  type AssetRecord,
  type MediaTypeFilter,
  type ScoreFilter,
  type SortDirection,
  type SortMode,
  type TagRecord,
  type TreeResponse
} from "../../api/client";
import { buildAssetListQueryKey } from "../gallery-loading";
import { randomSeedForQuery } from "./random-order-state";
import {
  hasAssetSourceChanged,
  mergeManagedAssetOrder,
  readAssetAppend,
  readAssetWindow,
  sameAssetOrder,
  shouldRetainManagedAsset
} from "./asset-window";
import { folderWithin } from "../management/management-model";

const ASSET_PAGE_LIMIT = 80;
interface UseAssetListOptions {
  folderId: string | null;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  search: string;
  sort: SortMode;
  sortDirection: SortDirection;
  tagFilters: string[];
  tree: TreeResponse | null;
}

export function useAssetList({
  folderId,
  mediaType,
  scoreFilter,
  search,
  sort,
  sortDirection,
  tagFilters,
  tree
}: UseAssetListOptions) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [unavailableAssetIds, setUnavailableAssetIds] = useState<string[]>([]);
  const [outsideScopeAssetIds, setOutsideScopeAssetIds] = useState<string[]>(
    []
  );
  const unavailableRef = useRef(new Set<string>());
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [pendingQueryKey, setPendingQueryKey] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const appendRef = useRef<AbortController | null>(null);
  const mutationEpochRef = useRef(0);
  const acceptedEpochRef = useRef(0);
  const acceptedQueryRef = useRef<string | null>(null);
  const changedAssetIdsRef = useRef(new Set<string>());
  const structurallyChangedIdsRef = useRef(new Set<string>());
  const revisionRef = useRef<string | undefined>(undefined);
  const explicitReloadRef = useRef(false);
  // File commits can refresh membership without applying deferred curation.
  const deferredOrderQueryRef = useRef<string | null>(null);
  const managedQueryRef = useRef<string | null>(null);
  const managedInterruptedRef = useRef<(() => void) | undefined>(undefined);
  const managedCanApplyRef = useRef<(() => boolean) | undefined>(undefined);
  const stateRef = useRef({
    assets,
    loadedQueryKey,
    totalAssets,
    pendingQueryKey
  });
  stateRef.current = { assets, loadedQueryKey, totalAssets, pendingQueryKey };
  const basis = buildAssetListQueryKey({
    folderId,
    sort,
    sortDirection,
    mediaType,
    search,
    tagFilters,
    scoreFilter
  });
  const randomSeed = useMemo(
    () =>
      sort === "random" && folderId ? randomSeedForQuery(basis) : undefined,
    [basis, folderId, sort]
  );
  const listQueryKey = useMemo(
    () =>
      buildAssetListQueryKey({
        folderId,
        randomSeed,
        sort,
        sortDirection,
        mediaType,
        search,
        tagFilters,
        scoreFilter
      }),
    [
      folderId,
      randomSeed,
      sort,
      sortDirection,
      mediaType,
      search,
      tagFilters,
      scoreFilter
    ]
  );
  const queryRef = useRef(listQueryKey);
  queryRef.current = listQueryKey;
  const isResultsPending = pendingQueryKey === listQueryKey;

  const markResultsStale = useCallback(() => {
    appendRef.current?.abort();
    appendRef.current = null;
    setIsLoadingMore(false);
    setPendingQueryKey(queryRef.current);
  }, []);
  const markResultsPending = useCallback(
    (preserveOrder = true) => {
      if (preserveOrder) deferredOrderQueryRef.current = queryRef.current;
      markResultsStale();
    },
    [markResultsStale]
  );
  const deferManagedRead = useCallback(() => {
    managedQueryRef.current = null;
    requestRef.current?.abort();
    if (acceptedQueryRef.current === queryRef.current)
      setLoadedQueryKey(queryRef.current);
    setIsLoadingAssets(false);
    const interrupted = managedInterruptedRef.current;
    if (interrupted) interrupted();
    else markResultsStale();
  }, [markResultsStale]);
  const invalidateReads = useCallback(() => {
    mutationEpochRef.current += 1;
    requestRef.current?.abort();
    appendRef.current?.abort();
    appendRef.current = null;
    setIsLoadingAssets(false);
    setIsLoadingMore(false);
    if (managedQueryRef.current === queryRef.current) {
      deferManagedRead();
    } else if (acceptedQueryRef.current === queryRef.current)
      setLoadedQueryKey(queryRef.current);
    else {
      explicitReloadRef.current = true;
      setReloadToken((current) => current + 1);
    }
  }, [deferManagedRead]);
  const mergeUpdatedAssets = useCallback(
    (updatedAssets: AssetRecord[]) => {
      invalidateReads();
      for (const asset of updatedAssets)
        changedAssetIdsRef.current.add(asset.id);
      const updates = new Map(updatedAssets.map((asset) => [asset.id, asset]));
      setAssets((current) =>
        current.map((asset) => {
          const updated = updates.get(asset.id);
          if (updated && hasAssetSourceChanged(asset, updated))
            structurallyChangedIdsRef.current.add(asset.id);
          return updated && !unavailableRef.current.has(asset.id)
            ? preservePresentation(asset, updated)
            : asset;
        })
      );
    },
    [invalidateReads]
  );
  const updateAssetTags = useCallback(
    (assetId: string, tags: TagRecord[]) => {
      invalidateReads();
      changedAssetIdsRef.current.add(assetId);
      setAssets((current) =>
        current.map((asset) =>
          asset.id === assetId && !unavailableRef.current.has(assetId)
            ? { ...asset, tags }
            : asset
        )
      );
    },
    [invalidateReads]
  );
  const removeAssets = useCallback(
    (ids: string[]) => {
      invalidateReads();
      const removed = new Set(ids);
      for (const id of ids) unavailableRef.current.add(id);
      setAssets((current) => current.filter((asset) => !removed.has(asset.id)));
      markResultsStale();
    },
    [invalidateReads, markResultsStale]
  );
  const markAssetsUnavailable = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      invalidateReads();
      const removed = new Set(ids);
      for (const id of ids) unavailableRef.current.add(id);
      setUnavailableAssetIds((current) => [...new Set([...current, ...ids])]);
      setAssets((current) =>
        current.map((asset) =>
          removed.has(asset.id) ? { ...asset, unavailable: true } : asset
        )
      );
      markResultsStale();
    },
    [invalidateReads, markResultsStale]
  );
  const reloadAssets = useCallback(() => {
    if (requestRef.current && stateRef.current.loadedQueryKey === null) return;
    managedQueryRef.current = null;
    explicitReloadRef.current = true;
    setReloadToken((current) => current + 1);
  }, []);
  const reconcileManagedAssets = useCallback(
    (onInterrupted?: () => void, canApply?: () => boolean) => {
      managedQueryRef.current = queryRef.current;
      managedInterruptedRef.current = onInterrupted;
      managedCanApplyRef.current = canApply;
      requestRef.current?.abort();
      appendRef.current?.abort();
      setReloadToken((current) => current + 1);
    },
    []
  );

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
        sort,
        order: sortDirection,
        type: mediaType,
        recursive: true,
        search,
        tags: tagFilters,
        score: scoreFilter,
        seed: randomSeed,
        expectedRevision,
        signal
      }),
    [
      folderId,
      sort,
      sortDirection,
      mediaType,
      search,
      tagFilters,
      scoreFilter,
      randomSeed
    ]
  );

  useEffect(() => {
    requestRef.current?.abort();
    appendRef.current?.abort();
    appendRef.current = null;
    setIsLoadingMore(false);
    if (!tree || !folderId) {
      setAssets([]);
      setTotalAssets(0);
      setLoadedQueryKey(null);
      setPendingQueryKey(null);
      setIsLoadingAssets(false);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    const query = listQueryKey;
    const epoch = mutationEpochRef.current;
    const state = stateRef.current;
    const sameQuery = acceptedQueryRef.current === query;
    const managed = managedQueryRef.current === query;
    const explicit = explicitReloadRef.current || !sameQuery;
    explicitReloadRef.current = false;
    if (!sameQuery) {
      deferredOrderQueryRef.current = null;
      if (!managed) managedQueryRef.current = null;
      changedAssetIdsRef.current.clear();
      structurallyChangedIdsRef.current.clear();
      setOutsideScopeAssetIds([]);
      setPendingQueryKey(null);
      setLoadedQueryKey(null);
    }
    if (explicit || managed) {
      if (sameQuery) setLoadedQueryKey(null);
      setIsLoadingAssets(true);
      setAssetError(null);
    }
    const count = sameQuery
      ? Math.max(ASSET_PAGE_LIMIT, state.assets.length)
      : ASSET_PAGE_LIMIT;
    const canPublish = () => {
      if (!managed || managedCanApplyRef.current?.() !== false) return true;
      deferManagedRead();
      return false;
    };
    if (!canPublish()) return () => controller.abort();
    void readAssetWindow(
      count,
      (offset, limit, revision) =>
        getPage(offset, limit, controller.signal, revision),
      controller.signal,
      managed
        ? { previousTotal: state.totalAssets, limit: ASSET_PAGE_LIMIT }
        : undefined
    )
      .then(async (response) => {
        if (
          controller.signal.aborted ||
          queryRef.current !== query ||
          mutationEpochRef.current !== epoch
        )
          return;
        if (!canPublish()) return;
        const current = stateRef.current;
        const orderChanged = !sameAssetOrder(current.assets, response.items);
        const retainManagedOrder =
          managed && sameQuery && deferredOrderQueryRef.current === query;
        const retainOrder =
          retainManagedOrder ||
          (sameQuery &&
            !explicit &&
            !managed &&
            (current.pendingQueryKey === query || orderChanged));
        const incoming = new Map(
          response.items.map((asset) => [asset.id, asset])
        );
        if (retainOrder) {
          const missing = current.assets
            .filter((asset) => !incoming.has(asset.id))
            .map((asset) => asset.id);
          const missingUnavailable: string[] = [];
          const outsideScope: string[] = [];
          const matching = new Set(response.items.map((asset) => asset.id));
          for (let offset = 0; offset < missing.length; offset += 500) {
            const ids = missing.slice(offset, offset + 500);
            const details = await getAssetDetails(
              ids,
              controller.signal,
              managed
                ? {
                    folderId,
                    type: mediaType,
                    recursive: true,
                    search,
                    tags: tagFilters,
                    scoreFilter
                  }
                : undefined
            );
            if (
              details.revision !== response.page.revision ||
              (managed && !details.matchingAssetIds)
            )
              throw new ApiError(409, "library_changed");
            for (const id of details.matchingAssetIds ?? []) matching.add(id);
            for (const asset of details.assets) {
              incoming.set(asset.id, asset);
              if (!folderWithin(tree, asset.folderId, folderId))
                outsideScope.push(asset.id);
            }
            const activeIds = new Set(details.assets.map((asset) => asset.id));
            missingUnavailable.push(...ids.filter((id) => !activeIds.has(id)));
          }
          if (
            controller.signal.aborted ||
            queryRef.current !== query ||
            mutationEpochRef.current !== epoch
          )
            return;
          if (!canPublish()) return;
          if (managed) {
            const structuralChanges = new Set(
              structurallyChangedIdsRef.current
            );
            const removed = new Set([...missingUnavailable, ...outsideScope]);
            for (const asset of incoming.values())
              if (!removed.has(asset.id))
                unavailableRef.current.delete(asset.id);
            setOutsideScopeAssetIds([]);
            setUnavailableAssetIds((previous) =>
              previous.filter((id) => unavailableRef.current.has(id))
            );
            setAssets((previous) => {
              const survivors = previous.flatMap((asset) => {
                const update = incoming.get(asset.id);
                return update &&
                  !removed.has(asset.id) &&
                  shouldRetainManagedAsset(
                    asset,
                    update,
                    matching.has(asset.id),
                    structuralChanges.has(asset.id)
                  )
                  ? [preservePresentation(asset, update)]
                  : [];
              });
              return mergeManagedAssetOrder(survivors, response.items);
            });
            structurallyChangedIdsRef.current.clear();
            setTotalAssets(response.page.total);
            revisionRef.current = response.page.revision;
            acceptedEpochRef.current = epoch;
            acceptedQueryRef.current = query;
            managedQueryRef.current = null;
            setLoadedQueryKey(query);
            setPendingQueryKey(query);
            return;
          }
          for (const id of missingUnavailable) unavailableRef.current.add(id);
          if (outsideScope.length)
            setOutsideScopeAssetIds((previous) => [
              ...new Set([...previous, ...outsideScope])
            ]);
          if (missingUnavailable.length)
            setUnavailableAssetIds((previous) => [
              ...new Set([...previous, ...missingUnavailable])
            ]);
          setAssets((previous) =>
            previous.map((asset) => {
              if (unavailableRef.current.has(asset.id))
                return { ...asset, unavailable: true };
              const update = incoming.get(asset.id);
              const focused =
                typeof document !== "undefined" &&
                document.activeElement instanceof Element &&
                document.activeElement.closest(
                  `[data-asset-id="${CSS.escape(asset.id)}"] .score-control`
                );
              const held =
                typeof document !== "undefined" &&
                document.querySelector(
                  `[data-asset-id="${CSS.escape(asset.id)}"] [data-pressing]`
                );
              return update && !focused && !held
                ? preservePresentation(asset, update)
                : asset;
            })
          );
          markResultsStale();
        } else {
          setOutsideScopeAssetIds([]);
          for (const asset of response.items)
            unavailableRef.current.delete(asset.id);
          setUnavailableAssetIds((previous) =>
            previous.filter((id) => unavailableRef.current.has(id))
          );
          setAssets((previous) => {
            const byId = new Map(previous.map((asset) => [asset.id, asset]));
            return response.items.map((asset) => {
              const old = byId.get(asset.id);
              return old ? preservePresentation(old, asset) : asset;
            });
          });
          setTotalAssets(response.page.total);
          revisionRef.current = response.page.revision;
          acceptedEpochRef.current = epoch;
          acceptedQueryRef.current = query;
          managedQueryRef.current = null;
          deferredOrderQueryRef.current = null;
          changedAssetIdsRef.current.clear();
          structurallyChangedIdsRef.current.clear();
          setLoadedQueryKey(query);
          setPendingQueryKey(null);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || queryRef.current !== query) return;
        setAssetError(
          caught instanceof ApiError && caught.status === 409
            ? "The library changed while updating. Try Update results again."
            : "Unable to update results. Try again."
        );
        if (sameQuery) {
          managedQueryRef.current = null;
          setLoadedQueryKey(query);
          markResultsStale();
        }
      })
      .finally(() => {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setIsLoadingAssets(false);
        }
      });
    return () => controller.abort();
  }, [
    tree,
    folderId,
    listQueryKey,
    reloadToken,
    getPage,
    markResultsPending,
    markResultsStale,
    deferManagedRead,
    mediaType,
    scoreFilter,
    search,
    tagFilters
  ]);

  const handleLoadMore = useCallback(async () => {
    const state = stateRef.current;
    const query = listQueryKey;
    if (
      !folderId ||
      appendRef.current ||
      isLoadingAssets ||
      state.loadedQueryKey !== query ||
      state.pendingQueryKey === query ||
      state.assets.length >= state.totalAssets
    )
      return;
    const controller = new AbortController();
    appendRef.current = controller;
    setIsLoadingMore(true);
    setAssetError(null);
    const epoch = mutationEpochRef.current;
    try {
      const appended = await readAssetAppend({
        assets: state.assets,
        revision: revisionRef.current,
        refresh: acceptedEpochRef.current !== epoch,
        limit: ASSET_PAGE_LIMIT,
        getPage: (offset, limit, revision) => {
          controller.signal.throwIfAborted();
          if (
            queryRef.current !== query ||
            mutationEpochRef.current !== epoch ||
            stateRef.current.pendingQueryKey === query
          )
            throw new DOMException("Obsolete asset page", "AbortError");
          return getPage(offset, limit, controller.signal, revision);
        },
        signal: controller.signal
      });
      if (
        controller.signal.aborted ||
        queryRef.current !== query ||
        mutationEpochRef.current !== epoch ||
        appendRef.current !== controller ||
        stateRef.current.pendingQueryKey === query
      )
        return;
      if (!appended) {
        markResultsPending();
        return;
      }
      const { response, refreshed } = appended;
      revisionRef.current = response.page.revision;
      acceptedEpochRef.current = epoch;
      setAssets((current) => {
        const byId = new Map(
          refreshed?.items.map((asset) => [asset.id, asset])
        );
        return [
          ...current.map((asset) => {
            const updated = byId.get(asset.id);
            return updated ? preservePresentation(asset, updated) : asset;
          }),
          ...response.items
        ];
      });
      setTotalAssets(response.page.total);
    } catch (caught) {
      if (controller.signal.aborted || queryRef.current !== query) return;
      if (caught instanceof ApiError && caught.status === 409)
        markResultsPending();
      else setAssetError("Unable to load more assets. Try again.");
    } finally {
      if (appendRef.current === controller) {
        appendRef.current = null;
        setIsLoadingMore(false);
      }
    }
  }, [folderId, getPage, isLoadingAssets, listQueryKey, markResultsPending]);
  useEffect(
    () => () => {
      requestRef.current?.abort();
      appendRef.current?.abort();
    },
    []
  );
  return {
    assetError,
    assets,
    changedAssetIds: changedAssetIdsRef.current,
    unavailableAssetIds,
    outsideScopeAssetIds,
    handleLoadMore,
    hasMoreAssets: assets.length < totalAssets,
    isLoadingAssets,
    isLoadingMore,
    isResultsPending,
    listQueryKey,
    loadedQueryKey,
    loadMoreRef,
    markResultsPending,
    mergeUpdatedAssets,
    markAssetsUnavailable,
    reconcileManagedAssets,
    reloadAssets,
    removeAssets,
    setAssetError,
    totalAssets,
    updateAssetTags
  };
}
