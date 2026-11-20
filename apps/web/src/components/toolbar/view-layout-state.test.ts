import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseViewAspects,
  readViewAspects,
  writeViewAspects,
  readViewerUsesSavedFraming,
  writeViewerUsesSavedFraming,
  VIEW_ASPECT_STORAGE_KEY,
  VIEWER_FRAMING_STORAGE_KEY
} from "./view-layout-state";
import {
  parseLibraryStateSearch,
  buildLibraryStateSearch,
  parseStoredLibraryState,
  serializeLibraryState
} from "../library-state";

describe("per-view layout preferences", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps defaults and validates only supported views and ratios", () => {
    expect(parseViewAspects(null)).toEqual({
      gallery: "Square",
      feed: "Fill screen",
      compare: "Original"
    });
    expect(
      parseViewAspects(
        JSON.stringify({
          version: 1,
          aspects: {
            gallery: "Landscape",
            feed: "Square",
            compare: "Circle",
            unknown: "Portrait"
          }
        })
      )
    ).toEqual({
      gallery: "Landscape",
      feed: "Fill screen",
      compare: "Original"
    });
    for (const raw of [
      "bad",
      "[]",
      "null",
      "x".repeat(513),
      '{"version":2,"aspects":{}}'
    ])
      expect(parseViewAspects(raw)).toEqual(parseViewAspects(null));
  });
  it("round-trips supported layouts independently in each view", () => {
    for (const view of ["gallery", "compare"] as const) {
      for (const aspect of [
        "Square",
        "Original",
        "Portrait",
        "Landscape"
      ] as const) {
        const state = { ...parseLibraryStateSearch(`?view=${view}`), aspect };
        expect(parseLibraryStateSearch(buildLibraryStateSearch(state))).toEqual(
          state
        );
      }
    }
    expect(parseLibraryStateSearch("?view=compare").aspect).toBe("Original");
    expect(parseLibraryStateSearch("?view=feed").aspect).toBe("Fill screen");
    for (const aspect of ["Fill screen", "Original"] as const) {
      const state = { ...parseLibraryStateSearch("?view=feed"), aspect };
      expect(parseLibraryStateSearch(buildLibraryStateSearch(state))).toEqual(
        state
      );
      expect(parseStoredLibraryState(serializeLibraryState(state))).toEqual(
        state
      );
    }
  });
  it("normalizes older Feed URLs and checkpoints without discarding other state", () => {
    for (const aspect of ["fill", "square", "landscape", "portrait"]) {
      const state = parseLibraryStateSearch(
        `?view=feed&aspect=${aspect}&folder=kept&q=clip`
      );
      expect(state.aspect).toBe("Fill screen");
      expect(state.folderId).toBe("kept");
      expect(state.search).toBe("clip");
      expect(buildLibraryStateSearch(state)).not.toContain("aspect=");
      expect(parseLibraryStateSearch(buildLibraryStateSearch(state))).toEqual(
        state
      );
    }
    const state = parseLibraryStateSearch("?view=feed&folder=kept&q=clip");
    for (const aspect of ["Fill screen", "Square", "Landscape", "Portrait"]) {
      expect(
        parseStoredLibraryState(
          JSON.stringify({ version: 1, state: { ...state, aspect } })
        )
      ).toEqual(state);
      expect(
        parseViewAspects(
          JSON.stringify({ version: 1, aspects: { feed: aspect } })
        ).feed
      ).toBe("Fill screen");
    }
    expect(parseStoredLibraryState(serializeLibraryState(state))).toEqual(
      state
    );
    expect(
      parseStoredLibraryState(
        JSON.stringify({ version: 1, state: { ...state, aspect: "Circle" } })
      )
    ).toBeNull();
    for (const view of ["gallery", "compare"]) {
      expect(
        parseStoredLibraryState(
          JSON.stringify({
            version: 1,
            state: { ...state, view, aspect: "Fill screen" }
          })
        )
      ).toBeNull();
    }
  });
  it("retains the Original Feed choice in URLs, checkpoints and per-view preferences", () => {
    const state = parseLibraryStateSearch(
      "?view=feed&aspect=original&folder=kept&q=clip&highlight=1"
    );
    expect(state).toMatchObject({
      aspect: "Original",
      folderId: "kept",
      search: "clip",
      highlightsOnly: true
    });
    expect(
      new URLSearchParams(buildLibraryStateSearch(state)).get("aspect")
    ).toBe("original");
    expect(parseStoredLibraryState(serializeLibraryState(state))).toEqual(
      state
    );
    expect(
      parseViewAspects(
        JSON.stringify({
          version: 1,
          aspects: { gallery: "Landscape", feed: "Original", compare: "Square" }
        })
      )
    ).toEqual({ gallery: "Landscape", feed: "Original", compare: "Square" });
  });
  it("limits Fill screen to Feed and rejects malformed or excessive stored layouts", () => {
    for (const view of ["gallery", "compare"] as const) {
      const state = parseLibraryStateSearch(`?view=${view}&aspect=fill`);
      expect(state.aspect).toBe(view === "gallery" ? "Square" : "Original");
      expect(
        parseViewAspects(
          JSON.stringify({ version: 1, aspects: { [view]: "Fill screen" } })
        )[view]
      ).toBe(state.aspect);
    }
    for (const aspect of [null, false, {}, ["Original"], "x".repeat(513)]) {
      expect(
        parseViewAspects(
          JSON.stringify({ version: 1, aspects: { feed: aspect } })
        ).feed
      ).toBe("Fill screen");
      expect(
        parseStoredLibraryState(
          JSON.stringify({
            version: 1,
            state: { ...parseLibraryStateSearch("?view=feed"), aspect }
          })
        )
      ).toBeNull();
    }
    expect(parseStoredLibraryState("x".repeat(8193))).toBeNull();
  });
  it("writes and reads each supported Feed layout without changing the other views", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value)
      }
    });
    for (const feed of ["Original", "Fill screen"] as const) {
      const aspects = {
        gallery: "Landscape" as const,
        feed,
        compare: "Square" as const
      };
      writeViewAspects(aspects);
      expect(readViewAspects()).toEqual(aspects);
      expect([...stored.keys()]).toEqual([VIEW_ASPECT_STORAGE_KEY]);
    }
  });
  it("accepts only an explicit boolean viewer framing preference", () => {
    for (const value of [
      null,
      "false",
      "1",
      "TRUE",
      "null",
      '{"enabled":true}',
      "x".repeat(1024)
    ]) {
      vi.stubGlobal("window", { localStorage: { getItem: () => value } });
      expect(readViewerUsesSavedFraming()).toBe(false);
    }
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value)
      }
    });
    for (const enabled of [true, false]) {
      writeViewerUsesSavedFraming(enabled);
      expect(readViewerUsesSavedFraming()).toBe(enabled);
      expect([...stored]).toEqual([
        [VIEWER_FRAMING_STORAGE_KEY, String(enabled)]
      ]);
    }
  });
  it("ignores denied viewer preference writes without changing the stored choice", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "true",
        setItem: () => {
          throw new DOMException("Full", "QuotaExceededError");
        }
      }
    });
    expect(() => writeViewerUsesSavedFraming(false)).not.toThrow();
    expect(readViewerUsesSavedFraming()).toBe(true);
  });
  it("migrates comparison preferences and tolerates unavailable storage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key === "aether.comparison-aspect.v1"
            ? '{"version":1,"aspect":"Portrait"}'
            : null
      }
    });
    expect(readViewAspects().compare).toBe("Portrait");
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Blocked");
      }
    });
    expect(readViewAspects()).toEqual(parseViewAspects(null));
    expect(() => writeViewAspects(parseViewAspects(null))).not.toThrow();
    expect(readViewerUsesSavedFraming()).toBe(false);
    expect(() => writeViewerUsesSavedFraming(true)).not.toThrow();
  });
});
