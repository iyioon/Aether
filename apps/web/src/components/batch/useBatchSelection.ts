import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  updateAssetScoresBatch,
  updateAssetTagsBatch,
  type AssetRecord
} from "../../api/client";
import {
  batchActionErrorMessage,
  batchScoreStatus,
  batchTagStatus
} from "../app/app-helpers";
import { uniqueTagNames } from "../tags/tag-utils";
import { useTagSuggestions } from "../tags/useTagSuggestions";

interface UseBatchSelectionOptions {
  assets: AssetRecord[];
  listQueryKey: string;
  shouldReloadAfterScoreChange: (input: {
    score?: number;
    favorite?: boolean;
  }) => boolean;
  shouldReloadAfterTagChange: boolean;
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onReloadAssets: () => void;
}

export function useBatchSelection({
  assets,
  listQueryKey,
  shouldReloadAfterScoreChange,
  shouldReloadAfterTagChange,
  onAssetsUpdated,
  onReloadAssets
}: UseBatchSelectionOptions) {
  const inFlightRef = useRef(false);
  const contextRef = useRef(listQueryKey);
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [batchTagDraft, setBatchTagDraft] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const selectedAssetIdList = useMemo(
    () => [...selectedAssetIds],
    [selectedAssetIds]
  );
  contextRef.current = `${listQueryKey}:${selectedAssetIdList.slice().sort().join("|")}`;
  const selectedAssetCount = selectedAssetIdList.length;
  const batchTagSuggestions = useTagSuggestions({
    enabled: selectedAssetCount > 0,
    query: batchTagDraft
  });

  useEffect(() => {
    setIsSelectionMode(false);
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
    if (inFlightRef.current) return;
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
    if (inFlightRef.current) return;
    setIsSelectionMode(true);
    setBatchError(null);
    setBatchStatus(null);
    setSelectedAssetIds(new Set(assets.map((asset) => asset.id)));
  }

  function clearSelectedAssets() {
    if (inFlightRef.current) return;
    setSelectedAssetIds(new Set());
    setBatchError(null);
    setBatchStatus(null);
    setBatchTagDraft("");
  }

  async function saveBatchScore(input: { score?: number; favorite?: boolean }) {
    if (
      selectedAssetIdList.length === 0 ||
      (input.score === undefined && input.favorite === undefined)
    ) {
      return false;
    }
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    const context = contextRef.current;
    const ids = [...selectedAssetIdList];
    setIsSavingBatch(true);
    setBatchError(null);
    setBatchStatus(null);

    try {
      const response = await updateAssetScoresBatch(ids, input);
      if (!activeRef.current) return false;
      onAssetsUpdated(response.assets);
      if (contextRef.current !== context) return false;
      setBatchStatus(batchScoreStatus(response.updated));

      if (shouldReloadAfterScoreChange(input)) {
        onReloadAssets();
      }
      return true;
    } catch (caught) {
      if (
        activeRef.current &&
        contextRef.current === context &&
        !(caught instanceof ApiError && caught.status === 401)
      )
        setBatchError(
          batchActionErrorMessage(caught, "Unable to update selection.")
        );
      return false;
    } finally {
      inFlightRef.current = false;
      setIsSavingBatch(false);
    }
  }

  async function saveBatchTags(tagNames: string[], mode: "add" | "replace") {
    const tags = uniqueTagNames(tagNames);

    if (
      selectedAssetIdList.length === 0 ||
      (mode === "add" && tags.length === 0)
    ) {
      return false;
    }
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    const context = contextRef.current;
    const ids = [...selectedAssetIdList];
    setIsSavingBatch(true);
    setBatchError(null);
    setBatchStatus(null);

    try {
      const response = await updateAssetTagsBatch(ids, {
        tags,
        mode
      });
      if (!activeRef.current) return false;
      onAssetsUpdated(response.assets);
      if (contextRef.current !== context) return false;
      setBatchTagDraft("");
      setBatchStatus(batchTagStatus(tags, mode, response.updated));
      if (shouldReloadAfterTagChange) onReloadAssets();
      return true;
    } catch (caught) {
      if (
        activeRef.current &&
        contextRef.current === context &&
        !(caught instanceof ApiError && caught.status === 401)
      )
        setBatchError(
          batchActionErrorMessage(caught, "Unable to update tags.")
        );
      return false;
    } finally {
      inFlightRef.current = false;
      setIsSavingBatch(false);
    }
  }

  return {
    batchError,
    batchStatus,
    batchTagDraft,
    batchTagSuggestions,
    clearSelectedAssets,
    isSelectionMode,
    isSavingBatch,
    saveBatchScore,
    saveBatchTags,
    selectLoadedAssets,
    selectedAssetCount,
    selectedAssetIds,
    setBatchTagDraft,
    setIsSelectionMode,
    toggleAssetSelection
  };
}
