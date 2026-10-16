import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkpointScrollPositionOnPageLifecycle,
  clearSessionScrollPositions,
  findScrollAnchorItem,
  flushSessionScrollPositions,
  hasScrollOrderChanged,
  readSessionScrollPosition,
  scaleScrollAnchorOffset,
  writeSessionScrollPosition
} from "./scroll-restoration";

function installSessionStorage() {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => values.set(key, value));
  const durableValues = new Map<string, string>();
  const durableSetItem = vi.fn((key: string, value: string) =>
    durableValues.set(key, value)
  );
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const document = Object.assign(documentEvents, {
    visibilityState: "visible"
  });

  vi.stubGlobal(
    "window",
    Object.assign(windowEvents, {
      localStorage: {
        getItem: (key: string) => durableValues.get(key) ?? null,
        removeItem: (key: string) => durableValues.delete(key),
        setItem: durableSetItem
      },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem
      }
    })
  );
  vi.stubGlobal("document", document);

  return {
    document,
    durableSetItem,
    durableValues,
    setItem,
    values,
    windowEvents
  };
}

describe("session scroll restoration", () => {
  afterEach(() => {
    clearSessionScrollPositions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stores a rounded, non-negative position", () => {
    installSessionStorage();

    writeSessionScrollPosition("library-content", {
      contextKey: "folder-1",
      scrollTop: 123.6
    });

    expect(readSessionScrollPosition("library-content")).toEqual({
      anchorId: undefined,
      anchorOffset: undefined,
      anchorSize: undefined,
      contextKey: "folder-1",
      index: undefined,
      loadedCount: undefined,
      scrollTop: 124
    });
  });

  it("keeps surfaces separate and clears them together", () => {
    installSessionStorage();

    writeSessionScrollPosition("library-content", {
      anchorId: "asset-3",
      anchorSize: 320,
      contextKey: "folder-1",
      index: 2,
      scrollTop: 600
    });
    writeSessionScrollPosition("folder-tree", {
      contextKey: "library",
      scrollTop: 80
    });

    expect(readSessionScrollPosition("library-content")?.anchorId).toBe(
      "asset-3"
    );
    expect(readSessionScrollPosition("library-content")?.anchorSize).toBe(320);

    clearSessionScrollPositions();

    expect(readSessionScrollPosition("library-content")).toBeNull();
    expect(readSessionScrollPosition("folder-tree")).toBeNull();
  });

  it("coalesces frequent writes while keeping the latest position readable", () => {
    vi.useFakeTimers();
    const { setItem, values } = installSessionStorage();

    for (let scrollTop = 1; scrollTop <= 40; scrollTop += 1) {
      writeSessionScrollPosition("library-content", {
        contextKey: "folder-1",
        scrollTop
      });
    }

    expect(setItem).not.toHaveBeenCalled();
    expect(readSessionScrollPosition("library-content")?.scrollTop).toBe(40);

    vi.advanceTimersByTime(120);

    expect(setItem).toHaveBeenCalledOnce();
    expect(
      JSON.parse(values.get("aether.scroll.v2.library-content") ?? "null")
    ).toMatchObject({ contextKey: "folder-1", scrollTop: 40 });
  });

  it("can synchronously flush a pending position before the page is hidden", () => {
    vi.useFakeTimers();
    const { setItem, values } = installSessionStorage();

    writeSessionScrollPosition("folder-tree", {
      contextKey: "library",
      scrollTop: 96
    });
    flushSessionScrollPositions("folder-tree");

    expect(setItem).toHaveBeenCalledOnce();
    expect(
      JSON.parse(values.get("aether.scroll.v2.folder-tree") ?? "null")
    ).toMatchObject({ contextKey: "library", scrollTop: 96 });
    expect(readSessionScrollPosition("folder-tree")?.scrollTop).toBe(96);

    vi.advanceTimersByTime(120);
    expect(setItem).toHaveBeenCalledOnce();
  });

  it("restores a durable checkpoint in a fresh application context", async () => {
    const { durableValues, values } = installSessionStorage();
    writeSessionScrollPosition("leaderboard", {
      anchorId: "asset-84",
      anchorOffset: 24,
      anchorSize: 96,
      contextKey: "query-1",
      index: 83,
      loadedCount: 96,
      scrollTop: 8123
    });
    flushSessionScrollPositions();
    values.clear();
    vi.resetModules();
    const freshContext = await import("./scroll-restoration");

    expect(freshContext.readSessionScrollPosition("leaderboard")).toMatchObject(
      {
        anchorId: "asset-84",
        anchorOffset: 24,
        anchorSize: 96,
        index: 83,
        loadedCount: 96,
        scrollTop: 8123
      }
    );
    expect(durableValues.size).toBe(1);
  });

  it("migrates an existing session checkpoint to durable storage", () => {
    const { durableValues, values } = installSessionStorage();
    values.set(
      "aether.scroll.v2.library-content",
      JSON.stringify({ contextKey: "folder-1", index: 16, scrollTop: 480 })
    );

    expect(readSessionScrollPosition("library-content")?.index).toBe(16);
    expect(
      JSON.parse(
        durableValues.get("aether.scroll.v3.library-content") ?? "null"
      )
    ).toMatchObject({ contextKey: "folder-1", index: 16, scrollTop: 480 });
  });

  it("ignores invalid durable data and can recover a valid session checkpoint", () => {
    const { durableValues, values } = installSessionStorage();
    durableValues.set("aether.scroll.v3.folder-tree", "{invalid");
    values.set(
      "aether.scroll.v2.folder-tree",
      JSON.stringify({ contextKey: "library", scrollTop: 120 })
    );

    expect(readSessionScrollPosition("folder-tree")?.scrollTop).toBe(120);
  });

  it.each([
    "null",
    "[]",
    '{"scrollTop":1}',
    '{"contextKey":"x"}',
    "x".repeat(20_000)
  ])("ignores malformed or oversized checkpoints", (stored) => {
    const { durableValues } = installSessionStorage();
    durableValues.set("aether.scroll.v3.folder-tree", stored);
    expect(readSessionScrollPosition("folder-tree")).toBeNull();
  });

  it("rejects non-finite offsets and normalizes optional restoration fields", () => {
    installSessionStorage();
    writeSessionScrollPosition("library-content", {
      contextKey: "folder-1",
      scrollTop: Number.NaN
    });
    expect(readSessionScrollPosition("library-content")).toBeNull();

    writeSessionScrollPosition("library-content", {
      contextKey: "folder-1",
      anchorOffset: Number.POSITIVE_INFINITY,
      anchorSize: -1,
      index: -1,
      loadedCount: 1.5,
      scrollTop: -20
    });
    expect(readSessionScrollPosition("library-content")).toMatchObject({
      anchorOffset: undefined,
      anchorSize: undefined,
      index: undefined,
      loadedCount: undefined,
      scrollTop: 0
    });
  });

  it("keeps navigation working when localStorage is restricted", () => {
    const { setItem, values } = installSessionStorage();
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("Storage access denied");
      }
    });
    expect(() =>
      writeSessionScrollPosition("folder-tree", {
        contextKey: "library",
        scrollTop: 80
      })
    ).not.toThrow();
    expect(() => flushSessionScrollPositions()).not.toThrow();
    expect(setItem).toHaveBeenCalledOnce();
    expect(values.size).toBe(1);
    expect(readSessionScrollPosition("folder-tree")?.scrollTop).toBe(80);
    expect(() => clearSessionScrollPositions()).not.toThrow();
    expect(values.size).toBe(0);
  });

  it("captures and flushes the latest DOM position synchronously on hidden and pagehide", () => {
    vi.useFakeTimers();
    const { document, durableSetItem, durableValues, windowEvents } =
      installSessionStorage();
    let scrollTop = 40;
    const savePosition = vi.fn(() => {
      writeSessionScrollPosition("folder-tree", {
        contextKey: "library",
        scrollTop
      });
    });
    const cleanup = checkpointScrollPositionOnPageLifecycle(
      "folder-tree",
      savePosition
    );

    document.dispatchEvent(new Event("visibilitychange"));
    expect(savePosition).not.toHaveBeenCalled();
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(durableSetItem).toHaveBeenCalledOnce();
    expect(
      JSON.parse(durableValues.get("aether.scroll.v3.folder-tree") ?? "null")
    ).toMatchObject({ scrollTop: 40 });

    scrollTop = 96;
    windowEvents.dispatchEvent(new Event("pagehide"));
    expect(durableSetItem).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(durableValues.get("aether.scroll.v3.folder-tree") ?? "null")
    ).toMatchObject({ scrollTop: 96 });
    vi.advanceTimersByTime(120);
    expect(durableSetItem).toHaveBeenCalledTimes(2);

    cleanup();
    document.dispatchEvent(new Event("visibilitychange"));
    windowEvents.dispatchEvent(new Event("pagehide"));
    expect(savePosition).toHaveBeenCalledTimes(2);
  });

  it("flushes pending writes on lifecycle teardown and clears all stores on explicit reset", () => {
    vi.useFakeTimers();
    const { durableValues, values } = installSessionStorage();
    values.set("aether.scroll.v1.gallery", "old checkpoint");
    const cleanup = checkpointScrollPositionOnPageLifecycle(
      "leaderboard",
      () => undefined
    );
    writeSessionScrollPosition("leaderboard", {
      contextKey: "query-1",
      loadedCount: 96,
      scrollTop: 640
    });
    cleanup();
    expect(durableValues.size).toBe(1);
    clearSessionScrollPositions();
    expect(durableValues.size).toBe(0);
    expect(values.size).toBe(0);
    vi.advanceTimersByTime(120);
    expect(durableValues.size).toBe(0);
  });
});

describe("findScrollAnchorItem", () => {
  const items = [
    { index: 4, start: 400, end: 490 },
    { index: 5, start: 502, end: 592 },
    { index: 6, start: 604, end: 694 }
  ];

  it("uses the visible row when the offset is inside it", () => {
    expect(findScrollAnchorItem(items, 540)?.index).toBe(5);
  });

  it("uses the preceding row when the offset is in a grid gap", () => {
    expect(findScrollAnchorItem(items, 598)?.index).toBe(5);
  });

  it("does not fall back to the first overscanned row", () => {
    expect(findScrollAnchorItem(items, 900)?.index).toBe(6);
  });
});

describe("hasScrollOrderChanged", () => {
  it("keeps the current location when another page is appended", () => {
    expect(hasScrollOrderChanged(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(hasScrollOrderChanged(["a", "b"], ["a", "b"])).toBe(false);
  });

  it("requires anchoring after refresh inserts, reorders or replaces entries", () => {
    expect(hasScrollOrderChanged(["a", "b"], ["new", "a", "b"])).toBe(true);
    expect(hasScrollOrderChanged(["a", "b"], ["b", "a"])).toBe(true);
    expect(hasScrollOrderChanged(["a", "b"], ["a", "new"])).toBe(true);
  });

  it("reapplies the location when a refresh removes previously loaded entries", () => {
    expect(hasScrollOrderChanged(["a", "b", "c"], ["a", "b"])).toBe(true);
    expect(hasScrollOrderChanged(["a", "b", "c"], ["b", "c"])).toBe(true);
  });
});

describe("scaleScrollAnchorOffset", () => {
  it("preserves the relative position inside a resized row", () => {
    expect(scaleScrollAnchorOffset(75, 300, 600)).toBe(150);
  });

  it("clamps offsets from the grid gap to the end of the resized row", () => {
    expect(scaleScrollAnchorOffset(312, 300, 180)).toBe(180);
  });

  it("keeps the pixel offset when the previous row size is unavailable", () => {
    expect(scaleScrollAnchorOffset(48, undefined, 240)).toBe(48);
  });
});
