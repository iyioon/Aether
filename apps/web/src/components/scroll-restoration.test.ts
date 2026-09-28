import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionScrollPositions,
  findScrollAnchorItem,
  readSessionScrollPosition,
  scaleScrollAnchorOffset,
  writeSessionScrollPosition
} from "./scroll-restoration";

function installSessionStorage() {
  const values = new Map<string, string>();

  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    }
  });
}

describe("session scroll restoration", () => {
  afterEach(() => vi.unstubAllGlobals());

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
