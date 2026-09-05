import { useEffect, useMemo, useState } from "react";
import {
  updateAssetRatingsBatch,
  updateAssetTagsBatch,
  type AssetRecord
} from "../../api/client";
import {
  batchActionErrorMessage,
  batchRatingStatus,
  batchTagStatus
} from "../app/app-helpers";
import { uniqueTagNames } from "../tags/tag-utils";
import { useTagSuggestions } from "../tags/useTagSuggestions";

interface UseBatchSelectionOptions {
  assets: AssetRecord[];
  listQueryKey: string;
  shouldReloadAfterRatingChange: boolean;
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onReloadAssets: () => void;
}

export function useBatchSelection({
  assets,
  listQueryKey,
  shouldReloadAfterRatingChange,
  onAssetsUpdated,
  onReloadAssets
}: UseBatchSelectionOptions) {
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    () => new Set()
  );
  const [batchTagDraft, setBatchTagDraft] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const selectedAssetIdList = useMemo(
    () => [...selectedAssetIds],
    [selectedAssetIds]
  );
  const selectedAssetCount = selectedAssetIdList.length;
  const batchTagSuggestions = useTagSuggestions({
    enabled: selectedAssetCount > 0,
    query: batchTagDraft
  });

  useEffect(() => {
    setSelectedAssetIds(new Set());
    setBatchError(null);
    setBatchStatus(null);
    setBatchTagDraft("");
  }, [listQueryKey]);

  useEffect(() => {
    const loadedAssetIds = new Set(assets.map((asset) => asset.id));

    setSelectedAssetIds((current) => {
      let changed = false;
      const next = new Set<string>();

      for (const assetId of current) {
        if (loadedAssetIds.has(assetId)) {
          next.add(assetId);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [assets]);

  function toggleAssetSelection(assetId: string) {
    setBatchError(null);
    setBatchStatus(null);
    setSelectedAssetIds((current) => {
      const next = new Set(current);

      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }

      return next;
    });
  }

  function selectLoadedAssets() {
    setBatchError(null);
    setBatchStatus(null);
    setSelectedAssetIds(new Set(assets.map((asset) => asset.id)));
  }

  function clearSelectedAssets() {
    setSelectedAssetIds(new Set());
    setBatchError(null);
    setBatchStatus(null);
    setBatchTagDraft("");
  }

  async function saveBatchRating(input: {
    rating?: number | null;
    favorite?: boolean;
  }) {
    if (selectedAssetIdList.length === 0) {
      return;
    }

    setIsSavingBatch(true);
    setBatchError(null);
    setBatchStatus(null);

    try {
      const response = await updateAssetRatingsBatch(selectedAssetIdList, input);
      onAssetsUpdated(response.assets);
      setBatchStatus(batchRatingStatus(response.updated));

      if (shouldReloadAfterRatingChange) {
        onReloadAssets();
      }
    } catch (caught) {
      setBatchError(batchActionErrorMessage(caught, "Unable to update selection."));
    } finally {
      setIsSavingBatch(false);
    }
  }

  async function saveBatchTags(tagNames: string[], mode: "add" | "replace") {
    const tags = uniqueTagNames(tagNames);

    if (
      selectedAssetIdList.length === 0 ||
      (mode === "add" && tags.length === 0)
    ) {
      return;
    }

    setIsSavingBatch(true);
    setBatchError(null);
    setBatchStatus(null);

    try {
      const response = await updateAssetTagsBatch(selectedAssetIdList, {
        tags,
        mode
      });
      setBatchTagDraft("");
      setBatchStatus(batchTagStatus(tags, mode, response.updated));
      onReloadAssets();
    } catch (caught) {
      setBatchError(batchActionErrorMessage(caught, "Unable to update tags."));
    } finally {
      setIsSavingBatch(false);
    }
  }

  return {
    batchError,
    batchStatus,
    batchTagDraft,
    batchTagSuggestions,
    clearSelectedAssets,
    isSavingBatch,
    saveBatchRating,
    saveBatchTags,
    selectLoadedAssets,
    selectedAssetCount,
    selectedAssetIds,
    setBatchTagDraft,
    toggleAssetSelection
  };
}
