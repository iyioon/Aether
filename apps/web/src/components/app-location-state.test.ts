import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultLibraryState,
  MAX_SEARCH_LENGTH,
  serializeLibraryState
} from "./library-state";
import {
  clearAppResumeState,
  readInitialAppLocation,
  readStoredAppLocation,
  resolveAppLocation,
  saveAppLocation,
  writeAppLocationToUrl,
  type AppLocationState
} from "./app-location-state";

const stored: AppLocationState = {
  library: {
    ...defaultLibraryState,
    folderId: "folder-1",
    view: "compare",
    search: "saved",
    highlightsOnly: false
  },
  navigation: {
    page: "settings",
    comparisonWorkspace: "ranking",
    settingsTab: "server",
    guideTopic: "browse",
    viewerAssetId: null
  }
};

describe("application resume and explicit locations", () => {
  it("restores an explicit Activity page without losing the library query or reopening media", () => {
    const activity = resolveAppLocation("?page=activity&asset=asset-1", stored);
    expect(activity.library).toEqual(stored.library);
    expect(activity.navigation).toMatchObject({
      page: "activity",
      viewerAssetId: null
    });
    expect(resolveAppLocation("?page=library", activity).navigation.page).toBe(
      "library"
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it("resumes the complete checkpoint from the Home Screen launch", () => {
    expect(resolveAppLocation("?launch=resume&folder=old", stored)).toEqual(
      stored
    );
    expect(resolveAppLocation("", stored)).toEqual(stored);
    expect(resolveAppLocation("?folder=old", stored, true)).toEqual(stored);
  });
  it("lets an explicit library link replace a saved Settings page and filters", () => {
    expect(
      resolveAppLocation(
        "?folder=folder-2&view=compare&workspace=leaderboard",
        stored
      )
    ).toMatchObject({
      library: { folderId: "folder-2", view: "compare", search: "" },
      navigation: {
        page: "library",
        comparisonWorkspace: "leaderboard",
        viewerAssetId: null
      }
    });
    expect(resolveAppLocation("?view=not-a-view", stored).library).toEqual(
      defaultLibraryState
    );
  });
  it("retains inactive sort rules when reloading Random without restoring saved filters", () => {
    const criteria = [
      { field: "tags" as const, direction: "asc" as const },
      { field: "score" as const, direction: "desc" as const }
    ];
    const checkpoint: AppLocationState = {
      ...stored,
      library: {
        ...stored.library,
        sort: "random",
        sortCriteria: criteria,
        tags: ["saved tag"]
      }
    };
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      location: {
        search: "?view=feed&sort=random&type=video&q=current&highlight=0"
      },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    saveAppLocation(checkpoint);

    expect(readInitialAppLocation().library).toEqual({
      ...defaultLibraryState,
      view: "feed",
      aspect: "Fill screen",
      sort: "random",
      sortCriteria: criteria,
      mediaType: "video",
      search: "current",
      highlightsOnly: false
    });
    expect(
      resolveAppLocation("?sortBy=filename:desc&sortBy=size:asc", checkpoint)
        .library.sortCriteria
    ).toEqual([
      { field: "filename", direction: "desc" },
      { field: "size", direction: "asc" }
    ]);
    expect(
      resolveAppLocation("?sort=filename", checkpoint).library.sortCriteria
    ).toBeUndefined();
  });
  it("resumes older Home Screen URLs and honors explicit view links", () => {
    const location = { search: "?folder=old&size=huge&sort=score" };
    vi.stubGlobal("window", {
      location,
      matchMedia: () => ({ matches: true }),
      localStorage: {
        getItem: (key: string) =>
          key === "aether.resume.v1"
            ? JSON.stringify({ version: 1, ...stored })
            : null
      }
    });
    expect(readInitialAppLocation()).toEqual(stored);
    location.search += "&view=gallery";
    expect(readInitialAppLocation()).toMatchObject({
      library: { folderId: "old", view: "gallery", search: "" },
      navigation: { page: "library" }
    });
    location.search = "?launch=resume&view=gallery";
    expect(readInitialAppLocation()).toEqual(stored);
  });
  it("bounds legacy and new resume searches without discarding navigation", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      location: { search: "?launch=resume" },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    const legacy = {
      ...stored,
      library: { ...stored.library, search: "x".repeat(160) }
    };
    values.set("aether.resume.v1", JSON.stringify({ version: 1, ...legacy }));
    expect(readInitialAppLocation()).toEqual({
      ...stored,
      library: { ...stored.library, search: "x".repeat(MAX_SEARCH_LENGTH) }
    });

    const next = {
      ...stored,
      library: { ...stored.library, search: `  Ａ${"b".repeat(150)}  ` }
    };
    saveAppLocation(next);
    const expectedSearch = `A${"b".repeat(MAX_SEARCH_LENGTH - 1)}`;
    expect(
      JSON.parse(values.get("aether.resume.v1")!) as unknown
    ).toMatchObject({ library: { search: expectedSearch } });
    expect(
      JSON.parse(values.get("aether.library-state.v1")!) as unknown
    ).toMatchObject({ state: { search: expectedSearch } });
    expect(readInitialAppLocation()).toEqual({
      ...stored,
      library: { ...stored.library, search: expectedSearch }
    });
  });
  it("round trips Settings tab and ordered workspace through the URL", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState }
    });
    writeAppLocationToUrl(stored);
    const url = String(replaceState.mock.calls[0]?.[2]);
    expect(
      resolveAppLocation(new URL(url, "https://aether.test").search, stored)
    ).toEqual(stored);
  });
  it("opens and resumes the Playback settings tab", () => {
    const values = new Map<string, string>();
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    const playback = resolveAppLocation("?page=settings&tab=playback", stored);
    expect(playback.navigation.settingsTab).toBe("playback");
    saveAppLocation(playback);
    expect(readStoredAppLocation()).toEqual(playback);
    expect(
      resolveAppLocation("?launch=resume", readStoredAppLocation())
    ).toEqual(playback);
    writeAppLocationToUrl(playback);
    const url = String(replaceState.mock.calls[0]?.[2]);
    expect(new URL(url, "https://aether.test").searchParams.get("tab")).toBe(
      "playback"
    );
  });
  it("restores validated viewer IDs only on the library page", () => {
    expect(
      resolveAppLocation("?view=feed&asset=asset-1", stored).navigation
        .viewerAssetId
    ).toBe("asset-1");
    expect(
      resolveAppLocation("?page=settings&asset=asset-1", stored).navigation
        .viewerAssetId
    ).toBeNull();
    expect(
      resolveAppLocation(`?asset=${"x".repeat(161)}`, stored).navigation
        .viewerAssetId
    ).toBeNull();
  });
  it("migrates older preferences and rejects oversized or corrupt checkpoints", () => {
    const legacyLibrary = {
      ...defaultLibraryState,
      folderId: "folder-7",
      view: "compare" as const,
      gridSize: "Huge" as const,
      aspect: "Original" as const,
      sort: "filename" as const,
      sortDirection: "asc" as const,
      mediaType: "image" as const,
      scoreFilter: "unranked" as const,
      search: "summer trip",
      tags: ["Family", "Seoul"]
    };
    const values = new Map<string, string>([
      ["aether.library-state.v1", serializeLibraryState(legacyLibrary)],
      [
        "aether.navigation.v1",
        JSON.stringify({
          version: 1,
          page: "library",
          comparisonWorkspace: "ranking"
        })
      ]
    ]);
    const location = { pathname: "/", search: "" };
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      location,
      history: { replaceState: vi.fn() }
    });
    expect(readStoredAppLocation().navigation.comparisonWorkspace).toBe(
      "ranking"
    );
    expect(readInitialAppLocation().library).toEqual({
      ...legacyLibrary,
      highlightsOnly: false
    });
    location.search = "?utm_source=homescreen";
    expect(readInitialAppLocation().library).toEqual({
      ...legacyLibrary,
      highlightsOnly: false
    });
    saveAppLocation(stored);
    expect(readStoredAppLocation()).toEqual(stored);
    values.set("aether.resume.v1", "x".repeat(16385));
    expect(readStoredAppLocation().navigation.viewerAssetId).toBeNull();
    values.set("aether.resume.v1", "not-json");
    expect(readStoredAppLocation().library).toEqual(defaultLibraryState);
    clearAppResumeState();
    expect(values.size).toBe(0);
  });
  it("keeps opening and navigation usable when browser storage is blocked", () => {
    const location = { pathname: "/", search: "" };
    vi.stubGlobal("window", {
      location,
      history: { replaceState: vi.fn() },
      get localStorage() {
        throw new DOMException("Storage is blocked.", "SecurityError");
      }
    });
    expect(() => saveAppLocation(stored)).not.toThrow();
    expect(readInitialAppLocation().library).toEqual(defaultLibraryState);
    location.search = "?view=feed";
    expect(readInitialAppLocation().library.view).toBe("feed");
    expect(() => clearAppResumeState()).not.toThrow();
  });
});

describe("individual highlight locations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round trips the selected highlight through its URL and a Home Screen checkpoint", () => {
    const values = new Map<string, string>();
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    const selected = resolveAppLocation(
      "?view=gallery&asset=media-1&highlightId=ending_2-A&highlight=0",
      stored
    );
    expect(selected.navigation).toMatchObject({
      page: "library",
      viewerAssetId: "media-1",
      viewerHighlightId: "ending_2-A"
    });
    expect(selected.library.highlightsOnly).toBe(false);
    writeAppLocationToUrl(selected);
    const url = new URL(
      String(replaceState.mock.calls[0]?.[2]),
      "https://aether.test"
    );
    expect(url.searchParams.get("asset")).toBe("media-1");
    expect(url.searchParams.get("highlightId")).toBe("ending_2-A");
    expect(resolveAppLocation(url.search, stored)).toEqual(selected);
    saveAppLocation(selected);
    expect(readStoredAppLocation()).toEqual(selected);
    expect(
      resolveAppLocation(
        "?launch=resume&asset=other&highlightId=opening",
        readStoredAppLocation()
      )
    ).toEqual(selected);
    expect(
      resolveAppLocation("?asset=media-2", selected).navigation
    ).toMatchObject({
      viewerAssetId: "media-2"
    });
    expect(
      resolveAppLocation("?asset=media-2", selected).navigation
        .viewerHighlightId
    ).toBeUndefined();
  });

  it.each([
    "",
    "x".repeat(65),
    "ending~source",
    "../ending",
    "two words",
    "종료"
  ])(
    "rejects an invalid highlight ID without preventing its source from opening: %s",
    (highlightId) => {
      const navigation = resolveAppLocation(
        `?asset=media-1&highlightId=${encodeURIComponent(highlightId)}`,
        stored
      ).navigation;
      expect(navigation.viewerAssetId).toBe("media-1");
      expect(navigation.viewerHighlightId).toBeUndefined();
    }
  );

  it("accepts bounded IDs and drops highlight IDs without a valid source or on another page", () => {
    const longest = "H".repeat(64);
    expect(
      resolveAppLocation(
        `?asset=${"a".repeat(160)}&highlightId=${longest}`,
        stored
      ).navigation.viewerHighlightId
    ).toBe(longest);
    for (const search of [
      "?highlightId=ending",
      "?asset=&highlightId=ending",
      `?asset=${"a".repeat(161)}&highlightId=ending`,
      "?page=settings&asset=media-1&highlightId=ending",
      "?page=activity&asset=media-1&highlightId=ending",
      "?page=trash&asset=media-1&highlightId=ending"
    ]) {
      const navigation = resolveAppLocation(search, stored).navigation;
      expect(navigation.viewerAssetId).toBeNull();
      expect(navigation.viewerHighlightId).toBeUndefined();
    }
  });

  it("validates checkpoint highlight IDs together with their source and omits invalid IDs when writing a URL", () => {
    const values = new Map<string, string>();
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    for (const viewerAssetId of [null, "", "a".repeat(161)]) {
      saveAppLocation({
        ...stored,
        navigation: {
          ...stored.navigation,
          page: "library",
          viewerAssetId,
          viewerHighlightId: "ending"
        }
      });
      expect(readStoredAppLocation().navigation.viewerAssetId).toBeNull();
      expect(
        readStoredAppLocation().navigation.viewerHighlightId
      ).toBeUndefined();
    }
    for (const viewerHighlightId of ["", "ending/clip", "x".repeat(65)]) {
      const invalid: AppLocationState = {
        ...stored,
        navigation: {
          ...stored.navigation,
          page: "library",
          viewerAssetId: "media-1",
          viewerHighlightId
        }
      };
      saveAppLocation(invalid);
      expect(readStoredAppLocation().navigation.viewerAssetId).toBe("media-1");
      expect(
        readStoredAppLocation().navigation.viewerHighlightId
      ).toBeUndefined();
      replaceState.mockClear();
      writeAppLocationToUrl(invalid);
      expect(
        new URL(
          String(replaceState.mock.calls[0]?.[2]),
          "https://aether.test"
        ).searchParams.has("highlightId")
      ).toBe(false);
    }
  });
});

describe("guide topics and Trash locations", () => {
  it("lets explicit guide topics take precedence and rejects invalid topics", () => {
    const guide = {
      ...stored,
      navigation: {
        ...stored.navigation,
        page: "guide" as const,
        guideTopic: "manage" as const
      }
    };
    expect(
      resolveAppLocation("?page=guide&topic=files", guide).navigation.guideTopic
    ).toBe("files");
    expect(
      resolveAppLocation("?page=guide&topic=unknown", guide).navigation
        .guideTopic
    ).toBe("browse");
    expect(
      resolveAppLocation("?launch=resume&topic=files", guide).navigation
        .guideTopic
    ).toBe("manage");
    expect(resolveAppLocation("?page=guide", guide).navigation.guideTopic).toBe(
      "manage"
    );
  });
  it("keeps a viewer checkpoint while reading a guide and separates Trash from library filters", () => {
    expect(
      resolveAppLocation("?page=guide&topic=help&asset=asset-1", stored)
        .navigation
    ).toMatchObject({
      page: "guide",
      guideTopic: "help",
      viewerAssetId: "asset-1"
    });
    const trash = resolveAppLocation("?page=trash", stored);
    expect(trash.navigation.page).toBe("trash");
    expect(trash.library).toEqual(stored.library);
  });
});

describe("Add media locations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens Add media without losing the library query or opening a viewer", () => {
    const addMedia = resolveAppLocation(
      "?page=add-media&asset=asset-1",
      stored
    );
    expect(addMedia.library).toEqual(stored.library);
    expect(addMedia.navigation).toMatchObject({
      page: "add-media",
      viewerAssetId: null
    });
    expect(resolveAppLocation("?page=library", addMedia).navigation.page).toBe(
      "library"
    );
  });

  it("round trips Add media through URL and resume storage", () => {
    const values = new Map<string, string>();
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
    const addMedia: AppLocationState = {
      ...stored,
      navigation: { ...stored.navigation, page: "add-media" }
    };
    saveAppLocation(addMedia);
    expect(readStoredAppLocation()).toEqual(addMedia);
    writeAppLocationToUrl(addMedia);
    const search = new URL(
      String(replaceState.mock.calls[0]?.[2]),
      "https://aether.test"
    ).search;
    expect(resolveAppLocation(search, stored)).toEqual(addMedia);
    expect(
      resolveAppLocation("?launch=resume", readStoredAppLocation())
    ).toEqual(addMedia);
  });
});
