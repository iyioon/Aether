import {
  ApiError,
  type AssetListResponse,
  type AssetRecord
} from "../../api/client";

export function sameAssetOrder(
  left: { id: string }[],
  right: { id: string }[]
): boolean {
  return (
    left.length === right.length &&
    left.every((asset, index) => asset.id === right[index]?.id)
  );
}

type AssetSourceIdentity = Pick<
  AssetRecord,
  "sourceVersion" | "folderId" | "name" | "sizeBytes" | "mtimeMs"
>;

export function hasAssetSourceChanged(
  previous: AssetSourceIdentity,
  current: AssetSourceIdentity
): boolean {
  return (
    previous.sourceVersion !== current.sourceVersion ||
    previous.folderId !== current.folderId ||
    previous.name !== current.name ||
    previous.sizeBytes !== current.sizeBytes ||
    previous.mtimeMs !== current.mtimeMs
  );
}

/** A missing prefix entry can still match the query at a later position.
 * Curation-only filter exits also stay visible until results are applied. */
export function shouldRetainManagedAsset(
  previous: AssetSourceIdentity,
  current: AssetSourceIdentity,
  matchesQuery: boolean,
  observedSourceChange: boolean
): boolean {
  return (
    matchesQuery ||
    (!observedSourceChange && !hasAssetSourceChanged(previous, current))
  );
}

/** Keep existing controls in place while inserting new records near their
 * next surviving neighbor in the server's current window. */
export function mergeManagedAssetOrder<T extends { id: string }>(
  previous: T[],
  incoming: T[]
): T[] {
  const survivors = new Set(previous.map((asset) => asset.id));
  const before = new Map<string, T[]>();
  const trailing: T[] = [];
  let nextSurvivor: string | undefined;
  for (let index = incoming.length - 1; index >= 0; index -= 1) {
    const asset = incoming[index]!;
    if (survivors.has(asset.id)) nextSurvivor = asset.id;
    else if (nextSurvivor) {
      const bucket = before.get(nextSurvivor) ?? [];
      bucket.push(asset);
      before.set(nextSurvivor, bucket);
    } else trailing.push(asset);
  }
  return [
    ...previous.flatMap((asset) => [
      ...(before.get(asset.id)?.reverse() ?? []),
      asset
    ]),
    ...trailing.reverse()
  ];
}

export async function readAssetWindow(
  count: number,
  getPage: (
    offset: number,
    limit: number,
    expectedRevision?: string
  ) => Promise<AssetListResponse>,
  signal: AbortSignal,
  growth?: { previousTotal: number; limit: number }
): Promise<AssetListResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    try {
      const response = await getPage(0, Math.min(250, count));
      const revision = response.page.revision;
      const windowCount =
        count +
        (growth
          ? Math.min(
              growth.limit,
              Math.max(0, response.page.total - growth.previousTotal)
            )
          : 0);
      while (
        response.items.length < Math.min(windowCount, response.page.total)
      ) {
        signal.throwIfAborted();
        const next = await getPage(
          response.items.length,
          Math.min(250, windowCount - response.items.length),
          revision
        );
        if (next.page.revision !== revision || next.items.length === 0)
          throw new ApiError(409, "library_changed");
        response.items.push(...next.items);
      }
      if (
        new Set(response.items.map((asset) => asset.id)).size !==
        response.items.length
      )
        throw new ApiError(409, "library_changed");
      return response;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409) || attempt === 2)
        throw error;
      await waitForRevisionRetry(attempt, signal);
    }
  }
  throw new ApiError(409, "library_changed");
}

export async function readAssetAppend({
  assets,
  revision,
  getPage,
  signal,
  refresh = false,
  limit = 80
}: {
  assets: AssetRecord[];
  revision: string | undefined;
  getPage: (
    offset: number,
    limit: number,
    expectedRevision?: string
  ) => Promise<AssetListResponse>;
  signal: AbortSignal;
  refresh?: boolean;
  limit?: number;
}): Promise<{
  response: AssetListResponse;
  refreshed?: AssetListResponse;
} | null> {
  let refreshed: AssetListResponse | undefined;
  const existing = new Set(assets.map((asset) => asset.id));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    if (refresh || attempt > 0) {
      refreshed = await readAssetWindow(assets.length, getPage, signal);
      signal.throwIfAborted();
      if (!sameAssetOrder(assets, refreshed.items)) return null;
      revision = refreshed.page.revision;
    }
    try {
      const response = await getPage(assets.length, limit, revision);
      signal.throwIfAborted();
      if (
        response.page.revision !== revision ||
        (!response.items.length && assets.length < response.page.total) ||
        response.items.some((asset) => existing.has(asset.id)) ||
        new Set(response.items.map((asset) => asset.id)).size !==
          response.items.length
      )
        throw new ApiError(409, "library_changed");
      return { response, refreshed };
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409) || attempt === 2)
        throw error;
      await waitForRevisionRetry(attempt, signal);
    }
  }
  throw new ApiError(409, "library_changed");
}

async function waitForRevisionRetry(attempt: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(
      () => {
        cleanup();
        resolve();
      },
      attempt === 0 ? 100 : 250
    );
    signal.addEventListener("abort", abort, { once: true });
  });
  signal.throwIfAborted();
}
