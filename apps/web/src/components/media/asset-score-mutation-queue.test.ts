import { describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "../../api/client";
import { createAssetScoreMutationQueue } from "./asset-score-mutation-queue";

describe("asset score mutation queue", () => {
  it("coalesces rapid updates and never restores an older response", async () => {
    const firstRequest = deferred<AssetRecord>();
    const secondRequest = deferred<AssetRecord>();
    const persist = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const updatedAssets: AssetRecord[] = [];
    const pendingChanges: Array<[string, boolean]> = [];
    const onPersistedChanges = vi.fn();
    const queue = createAssetScoreMutationQueue({
      persist,
      onAssetUpdated: (asset) => updatedAssets.push(asset),
      onPendingChange: (assetId, isPending) =>
        pendingChanges.push([assetId, isPending]),
      onPersistedChanges,
      onError: vi.fn()
    });
    const original = asset({ score: 0, favorite: false });

    queue.enqueue(original, { score: 1 });
    queue.enqueue(original, { favorite: true });
    queue.enqueue(original, { score: 3 });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(updatedAssets.at(-1)).toMatchObject({ score: 3, favorite: true });

    firstRequest.resolve(asset({ score: 1, favorite: false }));
    await settlePromiseCallbacks();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("asset-1", {
      favorite: true,
      score: 3
    });
    expect(updatedAssets.at(-1)).toMatchObject({ score: 3, favorite: true });

    secondRequest.resolve(asset({ score: 3, favorite: true }));
    await settlePromiseCallbacks();

    expect(pendingChanges).toEqual([
      ["asset-1", true],
      ["asset-1", false]
    ]);
    expect(onPersistedChanges).toHaveBeenCalledTimes(1);
  });

  it("rolls back to the latest confirmed asset when a queued update fails", async () => {
    const firstRequest = deferred<AssetRecord>();
    const secondRequest = deferred<AssetRecord>();
    const failure = new Error("offline");
    const persist = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const updatedAssets: AssetRecord[] = [];
    const onError = vi.fn();
    const onPersistedChanges = vi.fn();
    const queue = createAssetScoreMutationQueue({
      persist,
      onAssetUpdated: (asset) => updatedAssets.push(asset),
      onPendingChange: vi.fn(),
      onPersistedChanges,
      onError
    });
    const original = asset({ score: 0, favorite: false });

    queue.enqueue(original, { score: 1 });
    queue.enqueue(original, { score: 2 });
    firstRequest.resolve(asset({ score: 1, favorite: false }));
    await settlePromiseCallbacks();
    secondRequest.reject(failure);
    await settlePromiseCallbacks();

    expect(updatedAssets.at(-1)).toMatchObject({ score: 1, favorite: false });
    expect(onPersistedChanges).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("does not report success when the first update fails", async () => {
    const failure = new Error("offline");
    const onPersistedChanges = vi.fn();
    const onError = vi.fn();
    const queue = createAssetScoreMutationQueue({
      persist: vi.fn().mockRejectedValue(failure),
      onAssetUpdated: vi.fn(),
      onPendingChange: vi.fn(),
      onPersistedChanges,
      onError
    });

    queue.enqueue(asset({ score: 0, favorite: false }), { score: 1 });
    await settlePromiseCallbacks();

    expect(onPersistedChanges).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});

function asset({
  favorite,
  score
}: {
  favorite: boolean;
  score: number;
}): AssetRecord {
  return {
    id: "asset-1",
    folderId: "folder-1",
    name: "Example.jpg",
    extension: ".jpg",
    mediaType: "image",
    mimeType: "image/jpeg",
    sizeBytes: 1,
    mtimeMs: 1,
    width: 1,
    height: 1,
    durationMs: null,
    codec: null,
    status: "ready",
    error: null,
    score,
    ranking: null,
    favorite,
    tags: []
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function settlePromiseCallbacks() {
  await Promise.resolve();
  await Promise.resolve();
}
