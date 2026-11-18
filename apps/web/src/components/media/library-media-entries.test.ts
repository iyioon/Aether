import { describe, expect, it } from "vitest";
import type { AssetRecord, SavedHighlight } from "../../api/client";
import { defaultPresentationValues } from "./presentation-model";
import {
  chunkAssetsIntoRows,
  galleryTileChromeHeight
} from "../gallery/gallery-layout";
import {
  buildLibraryMediaEntries,
  findLibraryMediaEntry,
  findLibraryMediaEntryIndex,
  libraryMediaEntryKey,
  libraryMediaEntryLabel,
  libraryMediaRestoreIndex,
  libraryMediaSourceCount,
  libraryMediaSourceId
} from "./library-media-entries";

function source(id = "source"): AssetRecord {
  const highlights: SavedHighlight[] = [
    {
      ...defaultPresentationValues(),
      id: "opening",
      name: "Opening",
      highlight: { startMs: 100, endMs: 1100 },
      renditionKeys: { full: "full", highlight: "opening", bounce: "one" }
    },
    {
      ...defaultPresentationValues(),
      id: "ending",
      name: "Ending",
      highlight: { startMs: 5000, endMs: 8000 },
      playbackRate: 1.5,
      loopMode: "bounce",
      renditionKeys: { full: "full", highlight: "ending", bounce: "two" }
    }
  ];
  return {
    id,
    name: "recording.mp4",
    folderId: "folder",
    extension: ".mp4",
    mediaType: "video",
    mimeType: "video/mp4",
    sizeBytes: 1000,
    mtimeMs: 1000,
    width: 1280,
    height: 720,
    durationMs: 10_000,
    codec: "h264",
    status: "ready",
    error: null,
    score: 3,
    ranking: null,
    favorite: true,
    tags: [],
    presentation: {
      ...defaultPresentationValues(),
      highlight: highlights[1]!.highlight,
      playbackRate: 1.5,
      loopMode: "bounce",
      revision: 1,
      highlights,
      mainHighlightId: "ending",
      renditionKeys: highlights[1]!.renditionKeys
    }
  };
}

describe("library media entries", () => {
  it("does not reload an entire old window for a missing anchor near the start", () => {
    const entries = buildLibraryMediaEntries(
      Array.from({ length: 80 }, (_, index) => source(`item-${index}`))
    );
    expect(
      libraryMediaRestoreIndex(entries, {
        anchorId: "removed",
        index: 5,
        loadedCount: 1000,
        loadedSourceCount: 1000
      })
    ).toBe(5);
  });
  it("preserves ordinary identity and source order until individually enabled", () => {
    const first = source();
    const second = source("second");
    const entries = buildLibraryMediaEntries([first, second]);
    expect(entries.map((entry) => entry.entryKey)).toEqual([
      first.id,
      second.id
    ]);
    expect(entries[0]).toMatchObject({
      id: first.id,
      highlightId: null,
      highlightName: null
    });
    expect(entries[0]!.source).toBe(first);
  });

  it("replaces an enabled source with its sections while retaining canonical metadata", () => {
    const first = source();
    const expanded = source("second");
    expanded.presentation!.separateHighlights = true;
    const last = source("last");
    const entries = buildLibraryMediaEntries([first, expanded, last]);
    expect(entries.map((entry) => entry.entryKey)).toEqual([
      "source",
      "second~opening",
      "second~ending",
      "last"
    ]);
    expect(new Set(entries.map((entry) => entry.entryKey)).size).toBe(4);
    for (const entry of entries.slice(1, 3)) {
      expect(entry.id).toBe(expanded.id);
      expect(entry.source).toBe(expanded);
      expect(entry.presentation).toBe(expanded.presentation);
      expect(entry.tags).toBe(expanded.tags);
      expect(entry.score).toBe(expanded.score);
    }
    expect(entries[1]!.highlightName).toBe("Opening");
    expect(entries[2]!.highlightId).toBe("ending");
    expect(libraryMediaEntryLabel(entries[1]!)).toBe("Opening · recording.mp4");
    expect(libraryMediaEntryLabel(entries[0]!)).toBe("recording.mp4");
  });

  it("retains one ordinary entry when an enabled source has no highlights", () => {
    const asset = source();
    asset.presentation!.separateHighlights = true;
    asset.presentation!.highlights = [];
    asset.presentation!.highlight = null;
    asset.presentation!.mainHighlightId = null;
    expect(buildLibraryMediaEntries([asset])).toMatchObject([
      { entryKey: asset.id, highlightId: null, source: asset }
    ]);
  });

  it("resolves exact sections and old source anchors to the saved main", () => {
    const asset = source();
    asset.presentation!.separateHighlights = true;
    const entries = buildLibraryMediaEntries([asset]);
    expect(findLibraryMediaEntry(entries, "source~opening")).toBe(entries[0]);
    expect(findLibraryMediaEntry(entries, "source")).toBe(entries[1]);
    expect(findLibraryMediaEntry(entries, "source~removed")).toBe(entries[1]);
    expect(findLibraryMediaEntryIndex(entries, "source")).toBe(1);
    expect(findLibraryMediaEntry(entries, "missing~opening")).toBeUndefined();
    expect(findLibraryMediaEntryIndex(entries, null)).toBe(-1);
  });

  it("falls back to an ordinary entry after collapse and the first section after main removal", () => {
    const asset = source();
    expect(
      findLibraryMediaEntry(buildLibraryMediaEntries([asset]), "source~ending")
        ?.entryKey
    ).toBe("source");
    asset.presentation!.separateHighlights = true;
    asset.presentation!.highlights!.pop();
    expect(
      findLibraryMediaEntry(buildLibraryMediaEntries([asset]), "source~ending")
        ?.entryKey
    ).toBe("source~opening");
  });

  it("keeps source identity separate from entry identity", () => {
    expect(libraryMediaEntryKey("source", "highlight-1")).toBe(
      "source~highlight-1"
    );
    expect(libraryMediaEntryKey("source", null)).toBe("source");
    expect(libraryMediaSourceId("source~highlight-1")).toBe("source");
    expect(libraryMediaSourceId("source")).toBe("source");
  });

  it("reserves identification rows for highlights when optional card metadata is hidden", () => {
    const asset = source();
    asset.presentation!.separateHighlights = true;
    const entries = buildLibraryMediaEntries([asset]);
    const rows = chunkAssetsIntoRows(entries, 1);
    expect(rows[0]![0]!.entryKey).toBe("source~opening");
    expect(galleryTileChromeHeight(new Set(), entries[0])).toBe(56);
    expect(galleryTileChromeHeight(new Set(), source())).toBe(0);
  });

  it("loads source depth before using an unresolved display index after entries expand", () => {
    const assets = Array.from({ length: 10 }, (_, index) => {
      const item = source(`source-${index}`);
      item.presentation!.separateHighlights = true;
      return item;
    });
    const loaded = buildLibraryMediaEntries(assets);
    const position = {
      anchorId: "source-15~ending",
      index: 15,
      loadedCount: 20,
      loadedSourceCount: 20
    };
    expect(loaded).toHaveLength(20);
    expect(libraryMediaSourceCount(loaded)).toBe(10);
    expect(libraryMediaRestoreIndex(loaded, position)).toBe(loaded.length);
    const completed = buildLibraryMediaEntries([
      ...assets,
      ...Array.from({ length: 10 }, (_, index) =>
        source(`source-${index + 10}`)
      )
    ]);
    expect(libraryMediaRestoreIndex(completed, position)).toBe(25);
  });

  it("uses source depth to finish a missing-anchor fallback after entries collapse", () => {
    const entries = buildLibraryMediaEntries([
      source("one"),
      source("two"),
      source("three")
    ]);
    expect(
      libraryMediaRestoreIndex(entries, {
        anchorId: "removed~ending",
        index: 50,
        loadedCount: 60,
        loadedSourceCount: 3
      })
    ).toBe(2);
  });

  it("waits for the saved source depth even when newly expanded entries cover the display index", () => {
    const entries = buildLibraryMediaEntries(
      Array.from({ length: 3 }, (_, index) => {
        const item = source(`expanded-${index}`);
        item.presentation!.separateHighlights = true;
        return item;
      })
    );
    expect(
      libraryMediaRestoreIndex(entries, {
        anchorId: "removed~ending",
        index: 4,
        loadedCount: 20,
        loadedSourceCount: 10
      })
    ).toBe(entries.length);
  });

  it.each([
    {},
    { loadedSourceCount: 80 },
    { loadedSourceCount: 81 },
    { loadedSourceCount: -1 },
    { loadedSourceCount: 1.5 },
    { loadedSourceCount: Number.NaN },
    { loadedSourceCount: Number.MAX_SAFE_INTEGER + 1 }
  ])(
    "preserves an inconsistent deep display index for deferred paging: %j",
    (sourceDepth) => {
      const entries = buildLibraryMediaEntries(
        Array.from({ length: 80 }, (_, index) => source(`source-${index}`))
      );
      expect(
        libraryMediaRestoreIndex(entries, {
          anchorId: "source-81",
          index: 81,
          loadedCount: 80,
          ...sourceDepth
        })
      ).toBe(81);
    }
  );

  it.each([
    { loadedCount: 80 },
    { loadedCount: 80, loadedSourceCount: 81 },
    { loadedCount: 80, loadedSourceCount: -1 },
    { loadedCount: 80, loadedSourceCount: 1.5 },
    { loadedCount: 80, loadedSourceCount: Number.NaN },
    {
      loadedCount: 80,
      loadedSourceCount: Number.MAX_SAFE_INTEGER + 1
    },
    { loadedCount: Number.NaN, loadedSourceCount: 80 },
    { loadedCount: Number.MAX_SAFE_INTEGER + 1, loadedSourceCount: 80 }
  ])(
    "retains bounded legacy index behavior without valid source depth: %j",
    (depth) => {
      const entries = buildLibraryMediaEntries([source()]);
      expect(
        libraryMediaRestoreIndex(entries, {
          anchorId: "removed",
          index: 50,
          ...depth
        })
      ).toBe(50);
    }
  );

  it("keeps legacy and excessive restored depth bounded", () => {
    const entries = buildLibraryMediaEntries([source()]);
    expect(libraryMediaRestoreIndex(entries, { index: 5 })).toBe(5);
    expect(libraryMediaRestoreIndex(entries, { index: 1_000_000 })).toBe(9999);
    expect(libraryMediaRestoreIndex(entries, { index: Number.NaN })).toBe(0);
    expect(
      libraryMediaRestoreIndex(entries, {
        anchorId: "missing",
        index: 0,
        loadedCount: 1_000_000
      })
    ).toBe(0);
    const base = source();
    const deep = buildLibraryMediaEntries(
      Array.from({ length: 10_000 }, (_, index) => ({
        ...base,
        id: `source-${index}`
      }))
    );
    expect(
      libraryMediaRestoreIndex(deep, {
        anchorId: "missing",
        index: 1_000_000,
        loadedCount: 1_000_001,
        loadedSourceCount: 1_000_000
      })
    ).toBe(9999);
  });
});
