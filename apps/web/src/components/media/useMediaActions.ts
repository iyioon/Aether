import { useEffect, useMemo, useState } from "react";
import {
  updateAssetRating,
  type AssetRecord,
  type TagRecord
} from "../../api/client";
import {
  optimisticRatingAsset,
  ratingActionErrorMessage
} from "../app/app-helpers";

interface UseMediaActionsOptions {
  assets: AssetRecord[];
  shouldReloadAfterRatingChange: boolean;
  onAssetError: (message: string | null) => void;
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
  onReloadAssets: () => void;
}

export function useMediaActions({
  assets,
  shouldReloadAfterRatingChange,
  onAssetError,
  onAssetsUpdated,
  onAssetTagsUpdated,
  onReloadAssets
}: UseMediaActionsOptions) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [annotationAssetId, setAnnotationAssetId] = useState<string | null>(
    null
  );
  const [savingRatingAssetIds, setSavingRatingAssetIds] = useState<Set<string>>(
    () => new Set()
  );
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );
  const annotationAsset = useMemo(
    () => assets.find((asset) => asset.id === annotationAssetId) ?? null,
    [annotationAssetId, assets]
  );

  useEffect(() => {
    if (selectedAssetId && !selectedAsset) {
      setSelectedAssetId(null);
    }

    if (annotationAssetId && !annotationAsset) {
      setAnnotationAssetId(null);
    }
  }, [annotationAsset, annotationAssetId, selectedAsset, selectedAssetId]);

  function closeFullscreen() {
    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function openAssetFullscreen(assetId: string) {
    setAnnotationAssetId(null);
    setSelectedAssetId(assetId);
  }

  function selectAdjacentAsset(direction: -1 | 1) {
    if (!selectedAsset) {
      return;
    }

    const currentIndex = assets.findIndex((asset) => asset.id === selectedAsset.id);
    const nextAsset = assets[currentIndex + direction];

    if (nextAsset) {
      setSelectedAssetId(nextAsset.id);
    }
  }

  function handleAssetUpdated(updatedAsset: AssetRecord) {
    onAssetsUpdated([updatedAsset]);
  }

  function handleAssetTagsUpdated(assetId: string, tags: TagRecord[]) {
    onAssetTagsUpdated(assetId, tags);
  }

  async function saveAssetRating(
    asset: AssetRecord,
    input: { rating?: number | null; favorite?: boolean }
  ) {
    onAssetError(null);
    setSavingRatingAssetIds((current) => {
      const next = new Set(current);
      next.add(asset.id);
      return next;
    });

    onAssetsUpdated([optimisticRatingAsset(asset, input)]);

    try {
      const { asset: updatedAsset } = await updateAssetRating(asset.id, input);
      onAssetsUpdated([updatedAsset]);

      if (shouldReloadAfterRatingChange) {
        onReloadAssets();
      }
    } catch (caught) {
      onAssetsUpdated([asset]);
      onAssetError(ratingActionErrorMessage(caught));
    } finally {
      setSavingRatingAssetIds((current) => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
    }
  }

  return {
    annotationAsset,
    annotationAssetId,
    closeFullscreen,
    handleAssetTagsUpdated,
    handleAssetUpdated,
    openAssetFullscreen,
    saveAssetRating,
    savingRatingAssetIds,
    selectAdjacentAsset,
    selectedAsset,
    selectedAssetId,
    setAnnotationAssetId,
    setSelectedAssetId
  };
}
