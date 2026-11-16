import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultPlaybackMuted,
  defaultPlaybackPreferences,
  parsePlaybackPreferences,
  PLAYBACK_SETTINGS_STORAGE_KEY,
  readPlaybackPreferences,
  rememberPlaybackSound,
  resolvePlaybackFraming,
  resolvePlaybackHighlights,
  setPlaybackFramingMode,
  setPlaybackHighlightsMode,
  setPlaybackSoundMode,
  writePlaybackPreferences
} from "./playback-settings";

describe("playback sound preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts both surfaces muted until a preference or sound choice is made", () => {
    const preferences = defaultPlaybackPreferences();
    expect(defaultPlaybackMuted(preferences.fullView)).toBe(true);
    expect(defaultPlaybackMuted(preferences.feed)).toBe(true);
    expect(defaultPlaybackMuted({ mode: "sound-on", lastMuted: true })).toBe(
      false
    );
    expect(defaultPlaybackMuted({ mode: "muted", lastMuted: false })).toBe(
      true
    );
    expect(defaultPlaybackMuted({ mode: "remember", lastMuted: false })).toBe(
      false
    );
    expect(defaultPlaybackMuted({ mode: "remember", lastMuted: true })).toBe(
      true
    );
  });

  it("keeps each view's mode and explicit last choice independent", () => {
    const original = defaultPlaybackPreferences();
    const chosen = rememberPlaybackSound(original, "fullView", false);
    expect(original.fullView.lastMuted).toBe(true);
    expect(chosen.feed).toBe(original.feed);
    expect(chosen.fullView).toEqual({ mode: "muted", lastMuted: false });
    expect(defaultPlaybackMuted(chosen.fullView)).toBe(true);

    const remembered = setPlaybackSoundMode(chosen, "fullView", "remember");
    expect(defaultPlaybackMuted(remembered.fullView)).toBe(false);
    const feed = setPlaybackSoundMode(remembered, "feed", "sound-on");
    expect(feed.fullView).toBe(remembered.fullView);
    expect(feed.feed).toEqual({ mode: "sound-on", lastMuted: true });
    expect(defaultPlaybackMuted(feed.feed)).toBe(false);
    expect(setPlaybackSoundMode(feed, "feed", "sound-on")).toBe(feed);
    expect(rememberPlaybackSound(feed, "feed", true)).toBe(feed);
  });

  it.each([
    null,
    "",
    "not-json",
    "null",
    "[]",
    JSON.stringify({
      version: 2,
      fullView: { mode: "sound-on", lastMuted: false }
    }),
    " ".repeat(513)
  ])(
    "ignores unavailable, corrupt, oversized or unsupported data: %s",
    (raw) => {
      expect(parsePlaybackPreferences(raw)).toEqual(
        defaultPlaybackPreferences()
      );
    }
  );

  it("validates surfaces separately and keeps only supported fields", () => {
    expect(
      parsePlaybackPreferences(
        JSON.stringify({
          version: 1,
          fullView: { mode: "remember", lastMuted: false, ignored: "value" },
          feed: { mode: "sound-on", lastMuted: "false" }
        })
      )
    ).toEqual({
      ...defaultPlaybackPreferences(),
      fullView: { mode: "remember", lastMuted: false },
      feed: { mode: "muted", lastMuted: true }
    });
    expect(
      parsePlaybackPreferences(
        JSON.stringify({
          version: 1,
          fullView: { mode: "invalid", lastMuted: false },
          feed: { mode: "sound-on", lastMuted: false }
        })
      )
    ).toEqual({
      ...defaultPlaybackPreferences(),
      fullView: { mode: "muted", lastMuted: true },
      feed: { mode: "sound-on", lastMuted: false }
    });
  });

  it("persists versioned sound preferences for the next launch", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    expect(readPlaybackPreferences()).toEqual(defaultPlaybackPreferences());
    const preferences = {
      ...defaultPlaybackPreferences(),
      fullView: { mode: "remember" as const, lastMuted: false },
      feed: { mode: "muted" as const, lastMuted: true }
    };
    expect(writePlaybackPreferences(preferences)).toBe(true);
    expect(readPlaybackPreferences()).toEqual(preferences);
    expect(JSON.parse(values.get(PLAYBACK_SETTINGS_STORAGE_KEY)!)).toEqual({
      version: 1,
      ...preferences
    });
  });

  it("keeps sound choices usable when storage is unavailable or full", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("Storage is blocked.", "SecurityError");
      }
    });
    expect(readPlaybackPreferences()).toEqual(defaultPlaybackPreferences());
    const preferences = rememberPlaybackSound(
      setPlaybackSoundMode(defaultPlaybackPreferences(), "feed", "remember"),
      "feed",
      false
    );
    expect(writePlaybackPreferences(preferences)).toBe(false);
    expect(defaultPlaybackMuted(preferences.feed)).toBe(false);

    const setItem = vi.fn(() => {
      throw new DOMException("Storage is full.", "QuotaExceededError");
    });
    vi.stubGlobal("window", { localStorage: { setItem } });
    expect(writePlaybackPreferences(preferences)).toBe(false);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(defaultPlaybackMuted(preferences.feed)).toBe(false);
  });
});

describe("playback display defaults", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("migrates sound-only preferences without replacing remembered display choices", () => {
    const preferences = parsePlaybackPreferences(
      JSON.stringify({
        version: 1,
        fullView: { mode: "sound-on", lastMuted: false },
        feed: { mode: "remember", lastMuted: false }
      })
    );
    expect(preferences).toEqual({
      fullView: { mode: "sound-on", lastMuted: false },
      feed: { mode: "remember", lastMuted: false },
      framingMode: "remember",
      highlightsMode: "remember"
    });
    expect(resolvePlaybackFraming(preferences.framingMode, true)).toBe(true);
    expect(resolvePlaybackHighlights(preferences.highlightsMode, true)).toBe(
      true
    );
  });

  it("resolves fixed defaults without changing remembered selections", () => {
    for (const remembered of [false, true]) {
      expect(resolvePlaybackFraming("original", remembered)).toBe(false);
      expect(resolvePlaybackFraming("saved", remembered)).toBe(true);
      expect(resolvePlaybackFraming("remember", remembered)).toBe(remembered);
      expect(resolvePlaybackHighlights("full", remembered)).toBe(false);
      expect(resolvePlaybackHighlights("highlights", remembered)).toBe(true);
      expect(resolvePlaybackHighlights("remember", remembered)).toBe(
        remembered
      );
    }
  });

  it("validates framing and range separately from each other and sound", () => {
    expect(
      parsePlaybackPreferences(
        JSON.stringify({
          version: 1,
          fullView: { mode: "remember", lastMuted: false },
          feed: { mode: "invalid", lastMuted: false },
          framingMode: "saved",
          highlightsMode: "highlights",
          ignored: "value"
        })
      )
    ).toEqual({
      ...defaultPlaybackPreferences(),
      fullView: { mode: "remember", lastMuted: false },
      framingMode: "saved",
      highlightsMode: "highlights"
    });
    expect(
      parsePlaybackPreferences(
        JSON.stringify({
          version: 1,
          framingMode: true,
          highlightsMode: "full"
        })
      )
    ).toEqual({ ...defaultPlaybackPreferences(), highlightsMode: "full" });
    expect(
      parsePlaybackPreferences(
        JSON.stringify({
          version: 1,
          framingMode: "original",
          highlightsMode: { mode: "highlights" }
        })
      )
    ).toEqual({ ...defaultPlaybackPreferences(), framingMode: "original" });
  });

  it("updates display defaults independently and preserves no-op identity", () => {
    const original = defaultPlaybackPreferences();
    const framed = setPlaybackFramingMode(original, "saved");
    const highlighted = setPlaybackHighlightsMode(framed, "highlights");
    expect(original.framingMode).toBe("remember");
    expect(original.highlightsMode).toBe("remember");
    expect(highlighted.framingMode).toBe("saved");
    expect(highlighted.highlightsMode).toBe("highlights");
    expect(highlighted.fullView).toBe(original.fullView);
    expect(highlighted.feed).toBe(original.feed);
    expect(setPlaybackFramingMode(highlighted, "saved")).toBe(highlighted);
    expect(setPlaybackHighlightsMode(highlighted, "highlights")).toBe(
      highlighted
    );
  });

  it("persists display defaults with sound preferences for the next launch", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    const preferences = setPlaybackHighlightsMode(
      setPlaybackFramingMode(defaultPlaybackPreferences(), "original"),
      "highlights"
    );
    expect(writePlaybackPreferences(preferences)).toBe(true);
    expect(readPlaybackPreferences()).toEqual(preferences);
    expect(JSON.parse(values.get(PLAYBACK_SETTINGS_STORAGE_KEY)!)).toEqual({
      version: 1,
      ...preferences
    });
  });
});
