import type { AssetRecord } from "../../api/client";
import { optimisticScoreAsset } from "../app/app-helpers";

export interface AssetScoreUpdate {
  favorite?: boolean;
  score?: number;
}

interface PendingAssetScoreMutation {
  confirmedAsset: AssetRecord;
  optimisticAsset: AssetRecord;
  queuedUpdate: AssetScoreUpdate | null;
}

interface AssetScoreMutationQueueOptions {
  onAssetUpdated: (asset: AssetRecord) => void;
  onError: (error: unknown) => void;
  onPendingChange: (assetId: string, isPending: boolean) => void;
  onPersistedChanges: () => void;
  persist: (
    assetId: string,
    update: AssetScoreUpdate
  ) => Promise<AssetRecord>;
}

export interface AssetScoreMutationQueue {
  enqueue: (asset: AssetRecord, update: AssetScoreUpdate) => void;
}

export function createAssetScoreMutationQueue({
  onAssetUpdated,
  onError,
  onPendingChange,
  onPersistedChanges,
  persist
}: AssetScoreMutationQueueOptions): AssetScoreMutationQueue {
  const pendingByAssetId = new Map<string, PendingAssetScoreMutation>();

  function enqueue(asset: AssetRecord, update: AssetScoreUpdate) {
    const pending = pendingByAssetId.get(asset.id);

    if (pending) {
      pending.queuedUpdate = mergeAssetScoreUpdates(
        pending.queuedUpdate,
        update
      );
      pending.optimisticAsset = optimisticScoreAsset(
        pending.optimisticAsset,
        update
      );
      onAssetUpdated(pending.optimisticAsset);
      return;
    }

    const optimisticAsset = optimisticScoreAsset(asset, update);
    const nextPending: PendingAssetScoreMutation = {
      confirmedAsset: asset,
      optimisticAsset,
      queuedUpdate: update
    };

    pendingByAssetId.set(asset.id, nextPending);
    onPendingChange(asset.id, true);
    onAssetUpdated(optimisticAsset);
    void drain(asset.id, nextPending);
  }

  async function drain(
    assetId: string,
    pending: PendingAssetScoreMutation
  ) {
    let didPersistUpdate = false;

    try {
      while (pending.queuedUpdate) {
        const update = pending.queuedUpdate;
        pending.queuedUpdate = null;
        const updatedAsset = await persist(assetId, update);
        didPersistUpdate = true;

        pending.confirmedAsset = updatedAsset;
        pending.optimisticAsset = pending.queuedUpdate
          ? optimisticScoreAsset(updatedAsset, pending.queuedUpdate)
          : updatedAsset;
        onAssetUpdated(pending.optimisticAsset);
      }

      pendingByAssetId.delete(assetId);
      onPendingChange(assetId, false);
      onPersistedChanges();
    } catch (error) {
      pendingByAssetId.delete(assetId);
      onAssetUpdated(pending.confirmedAsset);
      onPendingChange(assetId, false);
      if (didPersistUpdate) {
        onPersistedChanges();
      }
      onError(error);
    }
  }

  return { enqueue };
}

function mergeAssetScoreUpdates(
  current: AssetScoreUpdate | null,
  next: AssetScoreUpdate
): AssetScoreUpdate {
  return {
    ...current,
    ...next
  };
}
