import { adjacentViewerId } from "./viewer-navigation";
import { preservePresentation } from "./presentation-record";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  updateAssetScore,
  ApiError,
  getAsset,
  type AssetRecord,
  type TagRecord
} from "../../api/client";
import { scoreActionErrorMessage } from "../app/app-helpers";
import {
  createAssetScoreMutationQueue,
  type AssetScoreMutationQueue
} from "./asset-score-mutation-queue";
import { usePageLifecycle } from "../../hooks/usePageLifecycle";

interface UseMediaActionsOptions {
  initialSelectedAssetId?: string | null;
  assets: AssetRecord[];
  shouldReloadAfterScoreChange: (input: {
    score?: number;
    favorite?: boolean;
  }) => boolean;
  onAssetError: (message: string | null) => void;
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
  onReloadAssets: () => void;
}

export function useMediaActions({
  initialSelectedAssetId = null,
  assets,
  shouldReloadAfterScoreChange,
  onAssetError,
  onAssetsUpdated,
  onAssetTagsUpdated,
  onReloadAssets
}: UseMediaActionsOptions) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    initialSelectedAssetId
  );
  const [annotationAssetId, setAnnotationAssetId] = useState<string | null>(
    null
  );
  const [viewerAssetFallback, setViewerAssetFallback] =
    useState<AssetRecord | null>(null);
  const [viewerRefreshRevision, setViewerRefreshRevision] = useState(0);
  const viewerOrderRef = useRef<string[]>([]);
  const validatedViewerRef = useRef<string | null>(null);
  const viewerMutationRevisionRef = useRef(0);
  usePageLifecycle({
    onResume: () => {
      if (selectedAssetId) setViewerRefreshRevision((current) => current + 1);
    }
  });
  const [savingScoreAssetIds, setSavingScoreAssetIds] = useState<Set<string>>(
    () => new Set()
  );
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const mutationCallbacksRef = useRef({
    onAssetError,
    onAssetsUpdated,
    onReloadAssets,
    shouldReloadAfterScoreChange
  });
  mutationCallbacksRef.current = {
    onAssetError,
    onAssetsUpdated,
    onReloadAssets,
    shouldReloadAfterScoreChange
  };
  const scoreMutationQueueRef = useRef<AssetScoreMutationQueue | null>(null);

  if (!scoreMutationQueueRef.current) {
    scoreMutationQueueRef.current = createAssetScoreMutationQueue({
      persist: async (assetId, input) => {
        const { asset: updatedAsset } = await updateAssetScore(assetId, input);
        return updatedAsset;
      },
      onAssetUpdated: (updatedAsset) => {
        if (!activeRef.current) return;
        updateViewerAssetFallback(updatedAsset);
        mutationCallbacksRef.current.onAssetsUpdated([updatedAsset]);
      },
      onPendingChange: (assetId, isPending) => {
        if (!activeRef.current) return;
        setSavingScoreAssetIds((current) => {
          const next = new Set(current);

          if (isPending) {
            next.add(assetId);
          } else {
            next.delete(assetId);
          }

          return next;
        });
      },
      onPersistedChanges: (input, assetId) => {
        if (
          !activeRef.current ||
          !assetsRef.current.some((asset) => asset.id === assetId)
        )
          return;
        const callbacks = mutationCallbacksRef.current;

        if (callbacks.shouldReloadAfterScoreChange(input)) {
          callbacks.onReloadAssets();
        }
      },
      onError: (caught) => {
        if (
          !activeRef.current ||
          (caught instanceof ApiError && caught.status === 401)
        )
          return;
        mutationCallbacksRef.current.onAssetError(
          scoreActionErrorMessage(caught)
        );
      }
    });
  }
  const selectedAsset = useMemo(
    () => resolveViewerAsset(selectedAssetId, viewerAssetFallback, assets),
    [assets, selectedAssetId, viewerAssetFallback]
  );
  const annotationAsset = useMemo(
    () => resolveViewerAsset(annotationAssetId, viewerAssetFallback, assets),
    [annotationAssetId, assets, viewerAssetFallback]
  );

  useEffect(() => {
    if (annotationAssetId && !annotationAsset) {
      setAnnotationAssetId(null);
    }
  }, [annotationAsset, annotationAssetId, selectedAsset, selectedAssetId]);

  const viewerSelectionRef = useRef({ selectedAssetId, annotationAssetId });
  viewerSelectionRef.current = { selectedAssetId, annotationAssetId };
  const handleAssetsUnavailable = useCallback((ids: string[]) => {
    const unavailable = new Set(ids);
    const { selectedAssetId: selectedId, annotationAssetId: annotationId } =
      viewerSelectionRef.current;
    if (annotationId && unavailable.has(annotationId))
      setAnnotationAssetId(null);
    if (!selectedId || !unavailable.has(selectedId)) return;
    const current = assetsRef.current;
    const available = current.filter(
      (asset) => !asset.unavailable && !unavailable.has(asset.id)
    );
    const availableIds = available.map((asset) => asset.id);
    const previousIds = current.some((asset) => asset.id === selectedId)
      ? current.map((asset) => asset.id)
      : viewerOrderRef.current;
    const nextId =
      adjacentViewerId(selectedId, 1, availableIds, previousIds) ??
      adjacentViewerId(selectedId, -1, availableIds, previousIds);
    const next = available.find((asset) => asset.id === nextId);
    setViewerAssetFallback(next ?? null);
    setSelectedAssetId(next?.id ?? null);
  }, []);

  const hasSelectedAsset = selectedAsset !== null;
  useEffect(() => {
    if (!selectedAssetId || (hasSelectedAsset && viewerRefreshRevision === 0))
      return;
    const validationKey = `${selectedAssetId}:${viewerRefreshRevision}`;
    if (hasSelectedAsset && validatedViewerRef.current === validationKey)
      return;
    validatedViewerRef.current = validationKey;
    const mutationRevision = viewerMutationRevisionRef.current;
    const controller = new AbortController();
    let completed = false;
    getAsset(selectedAssetId, controller.signal)
      .then((asset) => {
        if (!controller.signal.aborted) {
          completed = true;
          if (viewerMutationRevisionRef.current === mutationRevision)
            setViewerAssetFallback(asset);
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          error instanceof ApiError &&
          [400, 404].includes(error.status)
        )
          handleAssetsUnavailable([selectedAssetId]);
      });
    return () => {
      controller.abort();
      if (!completed && validatedViewerRef.current === validationKey)
        validatedViewerRef.current = null;
    };
  }, [
    handleAssetsUnavailable,
    hasSelectedAsset,
    selectedAssetId,
    viewerRefreshRevision
  ]);

  useEffect(() => {
    if (!selectedAssetId && !annotationAssetId) {
      setViewerAssetFallback(null);
    }
  }, [annotationAssetId, selectedAssetId]);

  if (selectedAssetId && assets.some((asset) => asset.id === selectedAssetId))
    viewerOrderRef.current = assets.map((asset) => asset.id);
  const viewerIds = assets.map((asset) => asset.id);
  const nextViewerId = selectedAssetId
    ? adjacentViewerId(selectedAssetId, 1, viewerIds, viewerOrderRef.current)
    : null;
  const previousViewerId = selectedAssetId
    ? adjacentViewerId(selectedAssetId, -1, viewerIds, viewerOrderRef.current)
    : null;

  function openAssetFullscreen(assetOrId: AssetRecord | string) {
    const assetId = typeof assetOrId === "string" ? assetOrId : assetOrId.id;

    viewerOrderRef.current = assets.map((asset) => asset.id);
    setViewerAssetFallback(
      typeof assetOrId === "string"
        ? (assets.find((asset) => asset.id === assetOrId) ?? null)
        : assetOrId
    );
    setAnnotationAssetId(null);
    setSelectedAssetId(assetId);
  }

  function selectAdjacentAsset(direction: -1 | 1) {
    if (!selectedAsset) {
      return;
    }

    const id = direction === 1 ? nextViewerId : previousViewerId;
    const nextAsset = assets.find((asset) => asset.id === id);

    if (nextAsset) {
      setViewerAssetFallback(null);
      setSelectedAssetId(nextAsset.id);
    }
  }

  function handleAssetsUpdated(updatedAssets: AssetRecord[]) {
    for (const asset of updatedAssets) updateViewerAssetFallback(asset);
    onAssetsUpdated(updatedAssets);
  }

  function handleAssetUpdated(updatedAsset: AssetRecord) {
    updateViewerAssetFallback(updatedAsset);
    onAssetsUpdated([updatedAsset]);
  }

  function handleAssetTagsUpdated(assetId: string, tags: TagRecord[]) {
    viewerMutationRevisionRef.current += 1;
    setViewerAssetFallback((current) =>
      current?.id === assetId ? { ...current, tags } : current
    );
    onAssetTagsUpdated(assetId, tags);
  }

  function updateViewerAssetFallback(updatedAsset: AssetRecord) {
    viewerMutationRevisionRef.current += 1;
    setViewerAssetFallback((current) =>
      current?.id === updatedAsset.id
        ? preservePresentation(current, updatedAsset)
        : current
    );
  }

  function saveAssetScore(
    asset: AssetRecord,
    input: { score?: number; favorite?: boolean }
  ) {
    if (asset.unavailable) return;
    onAssetError(null);
    scoreMutationQueueRef.current?.enqueue(asset, input);
  }

  return {
    annotationAsset,
    annotationAssetId,
    hasNextViewerAsset: nextViewerId !== null,
    hasPreviousViewerAsset: previousViewerId !== null,
    handleAssetTagsUpdated,
    handleAssetUpdated,
    handleAssetsUpdated,
    handleAssetsUnavailable,
    openAssetFullscreen,
    saveAssetScore,
    savingScoreAssetIds,
    selectAdjacentAsset,
    selectedAsset,
    selectedAssetId,
    setAnnotationAssetId,
    setSelectedAssetId
  };
}

function resolveViewerAsset(
  assetId: string | null,
  viewerAssetFallback: AssetRecord | null,
  assets: AssetRecord[]
): AssetRecord | null {
  if (!assetId) {
    return null;
  }

  if (viewerAssetFallback?.id === assetId) {
    const listed = assets.find((asset) => asset.id === assetId);
    if (listed?.unavailable) return listed;
    return listed
      ? preservePresentation(listed, viewerAssetFallback)
      : viewerAssetFallback;
  }

  return assets.find((asset) => asset.id === assetId) ?? null;
}
