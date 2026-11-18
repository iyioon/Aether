import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import type { AssetRecord, SavedHighlight } from "../../api/client";
import {
  defaultPresentationValues,
  getPresentationValues
} from "./presentation-model";
import {
  saveMainHighlight,
  saveHighlightsSeparately
} from "./save-highlight-settings";

function asset(revision = 3, mainHighlightId = "opening"): AssetRecord {
  const highlights: SavedHighlight[] = [
    {
      ...defaultPresentationValues(),
      id: "opening",
      name: "Opening",
      highlight: { startMs: 0, endMs: 2000 },
      renditionKeys: {
        full: "source",
        highlight: "opening",
        bounce: "opening-bounce"
      }
    },
    {
      ...defaultPresentationValues(),
      id: "ending",
      name: "Ending",
      highlight: { startMs: 8000, endMs: 10000 },
      playbackRate: 0.5,
      zoom: 2,
      renditionKeys: {
        full: "source",
        highlight: "ending",
        bounce: "ending-bounce"
      }
    }
  ];
  const main = highlights.find(({ id }) => id === mainHighlightId)!;
  return {
    id: "media",
    presentation: {
      ...getPresentationValues(main),
      highlights,
      mainHighlightId,
      revision,
      renditionKeys: main.renditionKeys
    }
  } as AssetRecord;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("saving highlight settings", () => {
  beforeEach(() => {
    vi.spyOn(api, "getAsset").mockRejectedValue(new Error("Unexpected read"));
    vi.spyOn(api, "updateAssetPresentation");
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([true, false])(
    "saves separate display as %s without changing independent highlights or main",
    async (enabled) => {
      const original = asset();
      original.presentation!.separateHighlights = !enabled;
      const saved = asset(4);
      saved.presentation!.separateHighlights = enabled;
      vi.mocked(api.updateAssetPresentation).mockResolvedValue(saved);
      await expect(
        saveHighlightsSeparately(
          original,
          enabled,
          new AbortController().signal
        )
      ).resolves.toBe(saved);
      expect(api.updateAssetPresentation).toHaveBeenCalledExactlyOnceWith(
        "media",
        {
          ...getPresentationValues(original.presentation),
          separateHighlights: enabled
        },
        3
      );
      const submitted = vi.mocked(api.updateAssetPresentation).mock
        .calls[0]![1];
      expect(submitted.highlights).toEqual(
        getPresentationValues(original.presentation).highlights
      );
      expect(submitted.mainHighlightId).toBe("opening");
      for (const highlight of submitted.highlights!) {
        expect(highlight).not.toHaveProperty("separateHighlights");
        expect(highlight).not.toHaveProperty("renditionKeys");
      }
      expect(original.presentation!.separateHighlights).toBe(!enabled);
      expect(api.getAsset).not.toHaveBeenCalled();
    }
  );

  it("preserves enabled separate display when changing the main highlight", async () => {
    const original = asset();
    original.presentation!.separateHighlights = true;
    const saved = asset(4, "ending");
    saved.presentation!.separateHighlights = true;
    vi.mocked(api.updateAssetPresentation).mockResolvedValue(saved);
    await expect(
      saveMainHighlight(original, "ending", new AbortController().signal)
    ).resolves.toBe(saved);
    expect(
      vi.mocked(api.updateAssetPresentation).mock.calls[0]![1]
    ).toMatchObject({
      separateHighlights: true,
      mainHighlightId: "ending"
    });
  });

  it.each([
    new TypeError("Connection lost"),
    new api.ApiError(503, "temporarily_unavailable")
  ])(
    "reconciles a committed separate-display change after a lost response without repeating it",
    async (failure) => {
      const saved = asset(4);
      saved.presentation!.separateHighlights = true;
      vi.mocked(api.updateAssetPresentation).mockRejectedValue(failure);
      vi.mocked(api.getAsset).mockResolvedValue(saved);
      const controller = new AbortController();
      await expect(
        saveHighlightsSeparately(asset(), true, controller.signal)
      ).resolves.toBe(saved);
      expect(api.updateAssetPresentation).toHaveBeenCalledOnce();
      expect(api.getAsset).toHaveBeenCalledExactlyOnceWith(
        "media",
        controller.signal
      );
    }
  );

  it("does not mistake an acknowledged revision without the display change for success", async () => {
    vi.mocked(api.updateAssetPresentation).mockResolvedValue(asset(4));
    await expect(
      saveHighlightsSeparately(asset(), true, new AbortController().signal)
    ).rejects.toMatchObject({
      status: 409,
      code: "presentation_conflict"
    });
    expect(api.getAsset).not.toHaveBeenCalled();
  });

  it("retains the original error when a lost display change cannot be confirmed", async () => {
    const failure = new TypeError("Connection lost");
    vi.mocked(api.updateAssetPresentation).mockRejectedValue(failure);
    vi.mocked(api.getAsset).mockResolvedValue(asset());
    await expect(
      saveHighlightsSeparately(asset(), true, new AbortController().signal)
    ).rejects.toBe(failure);
    expect(api.updateAssetPresentation).toHaveBeenCalledOnce();
  });

  it("refuses enabling separate display without highlights while allowing an acknowledged disabled record", async () => {
    const original = asset();
    Object.assign(original.presentation!, {
      highlight: null,
      highlights: [],
      mainHighlightId: null,
      separateHighlights: false
    });
    await expect(
      saveHighlightsSeparately(original, true, new AbortController().signal)
    ).rejects.toMatchObject({
      status: 409,
      code: "presentation_conflict"
    });
    expect(api.updateAssetPresentation).not.toHaveBeenCalled();
    expect(api.getAsset).not.toHaveBeenCalled();
    const saved = {
      ...original,
      presentation: { ...original.presentation!, revision: 4 }
    };
    vi.mocked(api.updateAssetPresentation).mockResolvedValue(saved);
    await expect(
      saveHighlightsSeparately(original, false, new AbortController().signal)
    ).resolves.toBe(saved);
    expect(
      vi.mocked(api.updateAssetPresentation).mock.calls[0]![1]
    ).toMatchObject({
      highlights: [],
      mainHighlightId: null,
      separateHighlights: false,
      highlight: null
    });
    expect(original.presentation!.revision).toBe(3);
  });

  it("accepts the acknowledged record and submits all independent highlight settings", async () => {
    const original = asset();
    const saved = asset(4, "ending");
    vi.mocked(api.updateAssetPresentation).mockResolvedValue(saved);
    await expect(
      saveMainHighlight(original, "ending", new AbortController().signal)
    ).resolves.toBe(saved);
    expect(api.updateAssetPresentation).toHaveBeenCalledWith(
      "media",
      expect.objectContaining({
        mainHighlightId: "ending",
        playbackRate: 0.5,
        zoom: 2,
        highlight: { startMs: 8000, endMs: 10000 }
      }),
      3
    );
    const values = vi.mocked(api.updateAssetPresentation).mock.calls[0]![1];
    expect(
      values.highlights!.map(({ id, playbackRate }) => ({ id, playbackRate }))
    ).toEqual([
      { id: "opening", playbackRate: 1 },
      { id: "ending", playbackRate: 0.5 }
    ]);
    expect(values.highlights![0]).not.toHaveProperty("renditionKeys");
    expect(api.getAsset).not.toHaveBeenCalled();
    expect(original.presentation!.mainHighlightId).toBe("opening");
  });

  it.each([
    new TypeError("Connection lost"),
    new api.ApiError(503, "temporarily_unavailable")
  ])(
    "confirms an unknown outcome by reading the committed record",
    async (failure) => {
      const saved = asset(4, "ending");
      vi.mocked(api.updateAssetPresentation).mockRejectedValue(failure);
      vi.mocked(api.getAsset).mockResolvedValue(saved);
      const controller = new AbortController();
      await expect(
        saveMainHighlight(asset(), "ending", controller.signal)
      ).resolves.toBe(saved);
      expect(api.updateAssetPresentation).toHaveBeenCalledOnce();
      expect(api.getAsset).toHaveBeenCalledExactlyOnceWith(
        "media",
        controller.signal
      );
    }
  );

  it.each(["unchanged", "network"])(
    "retains the original failure when a %s read cannot confirm the write",
    async (read) => {
      const failure = new TypeError("Connection lost");
      vi.mocked(api.updateAssetPresentation).mockRejectedValue(failure);
      if (read === "unchanged")
        vi.mocked(api.getAsset).mockResolvedValue(asset());
      else
        vi.mocked(api.getAsset).mockRejectedValue(new TypeError("Read failed"));
      await expect(
        saveMainHighlight(asset(), "ending", new AbortController().signal)
      ).rejects.toBe(failure);
      expect(api.updateAssetPresentation).toHaveBeenCalledOnce();
    }
  );

  it("rejects a conflicting saved record after an unknown write", async () => {
    vi.mocked(api.updateAssetPresentation).mockRejectedValue(
      new TypeError("Connection lost")
    );
    vi.mocked(api.getAsset).mockResolvedValue(asset(4, "opening"));
    await expect(
      saveMainHighlight(asset(), "ending", new AbortController().signal)
    ).rejects.toMatchObject({
      status: 409,
      code: "presentation_conflict"
    });
  });

  it.each(["acknowledged", "reconciled"])(
    "rejects a changed source in the %s result",
    async (outcome) => {
      const current = asset(4, "ending");
      current.presentation!.renditionKeys.full = "replacement-source";
      if (outcome === "acknowledged")
        vi.mocked(api.updateAssetPresentation).mockResolvedValue(current);
      else {
        vi.mocked(api.updateAssetPresentation).mockRejectedValue(
          new TypeError("Connection lost")
        );
        vi.mocked(api.getAsset).mockResolvedValue(current);
      }
      await expect(
        saveMainHighlight(asset(), "ending", new AbortController().signal)
      ).rejects.toMatchObject({
        status: 409,
        code: "source_changed"
      });
    }
  );

  it.each([400, 401, 404, 409, 422])(
    "does not reconcile an explicit %s rejection",
    async (status) => {
      const failure = new api.ApiError(status, "rejected");
      vi.mocked(api.updateAssetPresentation).mockRejectedValue(failure);
      await expect(
        saveMainHighlight(asset(), "ending", new AbortController().signal)
      ).rejects.toBe(failure);
      expect(api.getAsset).not.toHaveBeenCalled();
    }
  );

  it("rejects an unacknowledged revision without treating it as success", async () => {
    vi.mocked(api.updateAssetPresentation).mockResolvedValue(
      asset(3, "ending")
    );
    await expect(
      saveMainHighlight(asset(), "ending", new AbortController().signal)
    ).rejects.toMatchObject({
      status: 409,
      code: "presentation_conflict"
    });
  });

  it("does not send unavailable, removed-highlight or already aborted requests", async () => {
    const controller = new AbortController();
    await expect(
      saveMainHighlight(
        { ...asset(), unavailable: true },
        "ending",
        controller.signal
      )
    ).rejects.toMatchObject({ code: "asset_not_found" });
    await expect(
      saveMainHighlight(asset(), "removed", controller.signal)
    ).rejects.toMatchObject({ code: "presentation_conflict" });
    controller.abort();
    await expect(
      saveMainHighlight(asset(), "ending", controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.updateAssetPresentation).not.toHaveBeenCalled();
    expect(api.getAsset).not.toHaveBeenCalled();
  });

  it("ignores an acknowledged result received after cancellation", async () => {
    const pending = deferred<AssetRecord>();
    vi.mocked(api.updateAssetPresentation).mockReturnValue(pending.promise);
    const controller = new AbortController();
    const request = saveMainHighlight(asset(), "ending", controller.signal);
    controller.abort();
    pending.resolve(asset(4, "ending"));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(api.getAsset).not.toHaveBeenCalled();
  });

  it("ignores a reconciliation read received after cancellation", async () => {
    const pending = deferred<AssetRecord>();
    vi.mocked(api.updateAssetPresentation).mockRejectedValue(
      new TypeError("Connection lost")
    );
    vi.mocked(api.getAsset).mockReturnValue(pending.promise);
    const controller = new AbortController();
    const request = saveMainHighlight(asset(), "ending", controller.signal);
    await vi.waitFor(() => expect(api.getAsset).toHaveBeenCalledOnce());
    controller.abort();
    pending.resolve(asset(4, "ending"));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(api.updateAssetPresentation).toHaveBeenCalledOnce();
  });
});
