import { preservePresentation } from "./presentation-record";
import { useEffect, useMemo, useRef, useState } from "react";
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
  shouldReloadAfterScoreChange: boolean;
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
        updateViewerAssetFallback(updatedAsset);
        mutationCallbacksRef.current.onAssetsUpdated([updatedAsset]);
      },
      onPendingChange: (assetId, isPending) => {
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
      onPersistedChanges: () => {
        const callbacks = mutationCallbacksRef.current;

        if (callbacks.shouldReloadAfterScoreChange) {
          callbacks.onReloadAssets();
        }
      },
      onError: (caught) => {
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
          setSelectedAssetId(null);
      });
    return () => {
      controller.abort();
      if (!completed && validatedViewerRef.current === validationKey)
        validatedViewerRef.current = null;
    };
  }, [hasSelectedAsset, selectedAssetId, viewerRefreshRevision]);

  useEffect(() => {
    if (!selectedAssetId && !annotationAssetId) {
      setViewerAssetFallback(null);
    }
  }, [annotationAssetId, selectedAssetId]);

  function openAssetFullscreen(assetOrId: AssetRecord | string) {
    const assetId = typeof assetOrId === "string" ? assetOrId : assetOrId.id;

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

    const currentIndex = assets.findIndex(
      (asset) => asset.id === selectedAsset.id
    );
    const nextAsset = assets[currentIndex + direction];

    if (nextAsset) {
      setViewerAssetFallback(null);
      setSelectedAssetId(nextAsset.id);
    }
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
    onAssetError(null);
    scoreMutationQueueRef.current?.enqueue(asset, input);
  }

  return {
    annotationAsset,
    annotationAssetId,
    handleAssetTagsUpdated,
    handleAssetUpdated,
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
    return listed
      ? preservePresentation(listed, viewerAssetFallback)
      : viewerAssetFallback;
  }

  return assets.find((asset) => asset.id === assetId) ?? null;
}
