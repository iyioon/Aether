import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type AssetListResponse,
  type AssetRecord
} from "../../api/client";
import {
  readAssetAppend,
  readAssetWindow,
  sameAssetOrder
} from "./asset-window";

afterEach(() => vi.useRealTimers());
function page(
  ids: string[],
  revision: string,
  total: number
): AssetListResponse {
  return {
    items: ids.map((id) => ({ id }) as AssetRecord),
    page: { revision, total, limit: ids.length, offset: 0 }
  } as AssetListResponse;
}
describe("readAssetWindow", () => {
  it("keeps all pages on the same revision", async () => {
    const getPage = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b"], "9", 4))
      .mockResolvedValueOnce(page(["c", "d"], "9", 4));
    const result = await readAssetWindow(
      4,
      getPage,
      new AbortController().signal
    );
    expect(result.items.map((asset) => asset.id)).toEqual(["a", "b", "c", "d"]);
    expect(getPage.mock.calls[1]).toEqual([2, 2, "9"]);
  });
  it("restarts the whole window when an intervening write invalidates a page", async () => {
    const getPage = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b"], "9", 4))
      .mockRejectedValueOnce(new ApiError(409, "library_changed"))
      .mockResolvedValueOnce(page(["d", "a", "b", "c"], "10", 4));
    const result = await readAssetWindow(
      4,
      getPage,
      new AbortController().signal
    );
    expect(result.items.map((asset) => asset.id)).toEqual(["d", "a", "b", "c"]);
    expect(getPage.mock.calls[2]?.[0]).toBe(0);
  });
  it("bounds retries instead of exposing duplicated or mixed results", async () => {
    const getPage = vi.fn().mockResolvedValue(page(["a", "a"], "1", 2));
    await expect(
      readAssetWindow(2, getPage, new AbortController().signal)
    ).rejects.toMatchObject({ status: 409 });
    expect(getPage).toHaveBeenCalledTimes(3);
  });
  it("does not retry ordinary failures or cancelled reads", async () => {
    const getPage = vi
      .fn()
      .mockRejectedValue(new ApiError(500, "request_failed"));
    await expect(
      readAssetWindow(2, getPage, new AbortController().signal)
    ).rejects.toMatchObject({ status: 500 });
    expect(getPage).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      readAssetWindow(2, getPage, controller.signal)
    ).rejects.toThrow();
    expect(getPage).toHaveBeenCalledTimes(1);
  });
});
describe("sameAssetOrder", () => {
  it("distinguishes changed membership, order and page length", () => {
    expect(sameAssetOrder([{ id: "a" }], [{ id: "a" }])).toBe(true);
    expect(sameAssetOrder([{ id: "a" }], [{ id: "b" }])).toBe(false);
    expect(
      sameAssetOrder([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }])
    ).toBe(false);
    expect(sameAssetOrder([{ id: "a" }], [])).toBe(false);
  });
});

describe("readAssetAppend", () => {
  const assets = page(["a", "b"], "9", 4).items;
  it("appends directly when the accepted revision still matches", async () => {
    const getPage = vi.fn().mockResolvedValue(page(["c", "d"], "9", 4));
    const result = await readAssetAppend({
      assets,
      revision: "9",
      getPage,
      signal: new AbortController().signal
    });
    expect(result?.response.items.map((asset) => asset.id)).toEqual(["c", "d"]);
    expect(result?.refreshed).toBeUndefined();
    expect(getPage.mock.calls).toEqual([[2, 80, "9"]]);
  });
  it("revalidates every loaded ID after a harmless revision change and returns current records", async () => {
    const refreshed = page(["a", "b"], "10", 4);
    refreshed.items[0] = { ...refreshed.items[0]!, width: 320 };
    const getPage = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "library_changed"))
      .mockResolvedValueOnce(refreshed)
      .mockResolvedValueOnce(page(["c", "d"], "10", 4));
    const result = await readAssetAppend({
      assets,
      revision: "9",
      getPage,
      signal: new AbortController().signal
    });
    expect(result?.refreshed?.items[0]?.width).toBe(320);
    expect(getPage.mock.calls).toEqual([
      [2, 80, "9"],
      [0, 2],
      [2, 80, "10"]
    ]);
  });
  it("stops for an explicit update when membership, order or loaded depth changed", async () => {
    for (const ids of [["b", "a"], ["a", "new"], ["a"]]) {
      const getPage = vi
        .fn()
        .mockResolvedValueOnce(page(ids, "10", ids.length));
      expect(
        await readAssetAppend({
          assets,
          revision: "9",
          refresh: true,
          getPage,
          signal: new AbortController().signal
        })
      ).toBeNull();
      expect(getPage).toHaveBeenCalledTimes(1);
    }
  });
  it("uses one revision for a loaded prefix spanning multiple pages and its append", async () => {
    const many = Array.from(
      { length: 260 },
      (_, index) => ({ id: String(index) }) as AssetRecord
    );
    const getPage = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          many.slice(0, 250).map((asset) => asset.id),
          "10",
          261
        )
      )
      .mockResolvedValueOnce(
        page(
          many.slice(250).map((asset) => asset.id),
          "10",
          261
        )
      )
      .mockResolvedValueOnce(page(["260"], "10", 261));
    const result = await readAssetAppend({
      assets: many,
      revision: "9",
      refresh: true,
      getPage,
      signal: new AbortController().signal
    });
    expect(result?.refreshed?.items).toHaveLength(260);
    expect(getPage.mock.calls).toEqual([
      [0, 250],
      [250, 10, "10"],
      [260, 80, "10"]
    ]);
  });
  it("bounds racing appends and rejects duplicate or empty pages without returning partial updates", async () => {
    for (const incoming of [["a", "c"], ["c", "c"], []]) {
      const getPage = vi
        .fn()
        .mockImplementation((offset: number) =>
          Promise.resolve(
            offset === 0 ? page(["a", "b"], "10", 4) : page(incoming, "10", 4)
          )
        );
      await expect(
        readAssetAppend({
          assets,
          revision: "10",
          getPage,
          signal: new AbortController().signal
        })
      ).rejects.toMatchObject({ status: 409 });
      expect(getPage).toHaveBeenCalledTimes(5);
    }
  });
  it("does not continue after cancellation or retry ordinary request failures", async () => {
    const controller = new AbortController();
    const getPage = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve(page(["a", "b"], "10", 4));
    });
    await expect(
      readAssetAppend({
        assets,
        revision: "9",
        refresh: true,
        getPage,
        signal: controller.signal
      })
    ).rejects.toThrow();
    expect(getPage).toHaveBeenCalledTimes(1);
    const failed = vi
      .fn()
      .mockRejectedValue(new ApiError(500, "request_failed"));
    await expect(
      readAssetAppend({
        assets,
        revision: "9",
        getPage: failed,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ status: 500 });
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

describe.each(["window", "append"] as const)("%s revision retries", (kind) => {
  function read(
    getPage: (offset: number) => Promise<AssetListResponse>,
    signal: AbortSignal
  ) {
    return kind === "window"
      ? readAssetWindow(2, getPage, signal)
      : readAssetAppend({
          assets: page(["a", "b"], "9", 4).items,
          revision: "9",
          getPage,
          signal
        });
  }

  it("spaces repeated revision failures and stops after three attempts", async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const getPage = vi.fn().mockImplementation((offset: number) => {
      if (kind === "append" && offset === 0)
        return Promise.resolve(page(["a", "b"], "10", 4));
      calls.push(Date.now());
      return Promise.reject(new ApiError(409, "library_changed"));
    });
    const rejected = expect(
      read(getPage, new AbortController().signal)
    ).rejects.toMatchObject({ status: 409 });
    await vi.advanceTimersByTimeAsync(99);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(getPage).toHaveBeenCalledTimes(kind === "append" ? 5 : 3);
    expect(calls.map((time) => time - calls[0]!)).toEqual([0, 100, 350]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a waiting retry without another request and preserves the reason", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const getPage = vi
      .fn()
      .mockRejectedValue(new ApiError(409, "library_changed"));
    const reason = new DOMException("Query changed", "AbortError");
    const rejected = expect(read(getPage, controller.signal)).rejects.toBe(
      reason
    );
    await vi.advanceTimersByTimeAsync(50);
    controller.abort(reason);
    await rejected;
    await vi.advanceTimersByTimeAsync(500);
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
