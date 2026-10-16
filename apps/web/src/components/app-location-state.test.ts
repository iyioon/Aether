import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLibraryState, serializeLibraryState } from "./library-state";
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
    search: "saved"
  },
  navigation: {
    page: "settings",
    comparisonWorkspace: "ranking",
    settingsTab: "server",
    viewerAssetId: null
  }
};

describe("application resume and explicit locations", () => {
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
    expect(readInitialAppLocation().library).toEqual(legacyLibrary);
    location.search = "?utm_source=homescreen";
    expect(readInitialAppLocation().library).toEqual(legacyLibrary);
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
