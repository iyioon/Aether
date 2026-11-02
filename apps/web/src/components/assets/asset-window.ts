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

export async function readAssetWindow(
  count: number,
  getPage: (
    offset: number,
    limit: number,
    expectedRevision?: string
  ) => Promise<AssetListResponse>,
  signal: AbortSignal
): Promise<AssetListResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    try {
      const response = await getPage(0, Math.min(250, count));
      const revision = response.page.revision;
      while (response.items.length < Math.min(count, response.page.total)) {
        signal.throwIfAborted();
        const next = await getPage(
          response.items.length,
          Math.min(250, count - response.items.length),
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
