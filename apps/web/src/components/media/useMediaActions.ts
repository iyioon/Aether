import { useEffect, useMemo, useRef, useState } from "react";
import {
  updateAssetScore,
  type AssetRecord,
  type TagRecord
} from "../../api/client";
import {
  scoreActionErrorMessage
} from "../app/app-helpers";
import {
  createAssetScoreMutationQueue,
  type AssetScoreMutationQueue
} from "./asset-score-mutation-queue";

interface UseMediaActionsOptions {
  assets: AssetRecord[];
  shouldReloadAfterScoreChange: boolean;
  onAssetError: (message: string | null) => void;
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
  onReloadAssets: () => void;
}

export function useMediaActions({
  assets,
  shouldReloadAfterScoreChange,
  onAssetError,
  onAssetsUpdated,
  onAssetTagsUpdated,
  onReloadAssets
}: UseMediaActionsOptions) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [annotationAssetId, setAnnotationAssetId] = useState<string | null>(
    null
  );
  const [viewerAssetFallback, setViewerAssetFallback] =
    useState<AssetRecord | null>(null);
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
    if (selectedAssetId && !selectedAsset) {
      setSelectedAssetId(null);
    }

    if (annotationAssetId && !annotationAsset) {
      setAnnotationAssetId(null);
    }
  }, [annotationAsset, annotationAssetId, selectedAsset, selectedAssetId]);

  useEffect(() => {
    if (!selectedAssetId && !annotationAssetId) {
      setViewerAssetFallback(null);
    }
  }, [annotationAssetId, selectedAssetId]);

  function openAssetFullscreen(assetOrId: AssetRecord | string) {
    const assetId = typeof assetOrId === "string" ? assetOrId : assetOrId.id;

    setViewerAssetFallback(
      typeof assetOrId === "string"
        ? assets.find((asset) => asset.id === assetOrId) ?? null
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
    setViewerAssetFallback((current) =>
      current?.id === assetId ? { ...current, tags } : current
    );
    onAssetTagsUpdated(assetId, tags);
  }

  function updateViewerAssetFallback(updatedAsset: AssetRecord) {
    setViewerAssetFallback((current) =>
      current?.id === updatedAsset.id ? updatedAsset : current
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
    return viewerAssetFallback;
  }

  return assets.find((asset) => asset.id === assetId) ?? null;
}
