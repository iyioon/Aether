import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLibraryStateSearch,
  defaultLibraryState,
  MAX_TAG_FILTERS,
  parseLibraryStateSearch,
  parseStoredLibraryState,
  readInitialLibraryState,
  resolveInitialLibraryState,
  serializeLibraryState,
  writeLibraryStateToStorage
} from "./library-state";

describe("library state URL helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores valid library controls from query parameters", () => {
    const state = parseLibraryStateSearch(
      "?folder=root-folder&view=feed&size=large&aspect=portrait&sort=score&order=asc&type=video&score=favorites&q=%20night%20sky%20&tag=%20Family%20%20Trip%20&tag=Friends&tag=family%20trip"
    );

    expect(state).toEqual({
      folderId: "root-folder",
      view: "feed",
      gridSize: "Large",
      aspect: "Portrait",
      sort: "score",
      sortDirection: "asc",
      mediaType: "video",
      scoreFilter: "favorites",
      search: "night sky",
      tags: ["Family Trip", "Friends"]
    });
  });

  it("keeps legacy newest and oldest sort URLs working", () => {
    expect(parseLibraryStateSearch("?sort=newest")).toMatchObject({
      sort: "date",
      sortDirection: "desc"
    });
    expect(parseLibraryStateSearch("?sort=oldest")).toMatchObject({
      sort: "date",
      sortDirection: "asc"
    });
  });

  it("round-trips the comparison workspace as a first-class library view", () => {
    const parsed = parseLibraryStateSearch("?folder=root-folder&view=compare");

    expect(parsed.view).toBe("compare");
    expect(
      new URLSearchParams(buildLibraryStateSearch(parsed)).get("view")
    ).toBe("compare");
  });

  it("falls back to safe defaults for invalid enum values", () => {
    const state = parseLibraryStateSearch(
      "?folder=&view=timeline&size=oversized&aspect=panorama&sort=path&order=sideways&type=audio&score=private"
    );

    expect(state).toEqual(defaultLibraryState);
  });

  it("serializes only non-default, non-secret library state", () => {
    const search = buildLibraryStateSearch({
      ...defaultLibraryState,
      folderId: "folder-1",
      view: "feed",
      gridSize: "Compact",
      aspect: "Landscape",
      sort: "score",
      sortDirection: "asc",
      search: "city sky",
      tags: ["travel", "family"]
    });
    const params = new URLSearchParams(search);

    expect(params.get("folder")).toBe("folder-1");
    expect(params.get("view")).toBe("feed");
    expect(params.get("size")).toBe("compact");
    expect(params.get("aspect")).toBe("landscape");
    expect(params.get("sort")).toBe("score");
    expect(params.get("order")).toBe("asc");
    expect(params.get("q")).toBe("city sky");
    expect(params.getAll("tag")).toEqual(["travel", "family"]);
    expect(search).not.toContain("password");
    expect(search).not.toContain("session");
    expect(search).not.toContain("csrf");
  });

  it("does not serialize a direction for random sorting", () => {
    const search = buildLibraryStateSearch({
      ...defaultLibraryState,
      sort: "random",
      sortDirection: "asc"
    });
    const params = new URLSearchParams(search);

    expect(params.get("sort")).toBe("random");
    expect(params.has("order")).toBe(false);
  });

  it("limits repeated tag filters and deduplicates them case-insensitively", () => {
    const params = new URLSearchParams();

    for (let index = 0; index < MAX_TAG_FILTERS + 5; index += 1) {
      params.append("tag", `Tag ${index}`);
    }
    params.append("tag", "tag 0");

    const state = parseLibraryStateSearch(`?${params.toString()}`);

    expect(state.tags).toHaveLength(MAX_TAG_FILTERS);
    expect(state.tags[0]).toBe("Tag 0");
    expect(state.tags.at(-1)).toBe(`Tag ${MAX_TAG_FILTERS - 1}`);
  });

  it("restores a complete gallery workspace on a queryless cold launch", () => {
    const storedState = {
      ...defaultLibraryState,
      folderId: "folder-7",
      gridSize: "Huge" as const,
      aspect: "Original" as const,
      sort: "filename" as const,
      sortDirection: "asc" as const,
      mediaType: "image" as const,
      scoreFilter: "ranked" as const,
      search: "summer trip",
      tags: ["Family", "Seoul"]
    };

    expect(
      resolveInitialLibraryState("", serializeLibraryState(storedState))
    ).toEqual(storedState);
  });

  it("restores the saved library view, including comparison mode", () => {
    const storedState = {
      ...defaultLibraryState,
      folderId: "folder-9",
      view: "compare" as const,
      scoreFilter: "unranked" as const
    };

    expect(
      resolveInitialLibraryState(
        "?utm_source=homescreen",
        serializeLibraryState(storedState)
      )
    ).toEqual(storedState);
  });

  it("lets an explicit library URL override every stored value", () => {
    const storedState = {
      ...defaultLibraryState,
      folderId: "stored-folder",
      view: "feed" as const,
      mediaType: "video" as const,
      search: "stored search"
    };

    expect(
      resolveInitialLibraryState(
        "?folder=url-folder&view=gallery&type=image&q=url%20search",
        serializeLibraryState(storedState)
      )
    ).toMatchObject({
      folderId: "url-folder",
      view: "gallery",
      mediaType: "image",
      search: "url search"
    });

    expect(
      resolveInitialLibraryState(
        "?view=not-a-view",
        serializeLibraryState(storedState)
      )
    ).toEqual(defaultLibraryState);
  });

  it("falls back safely when browser storage is blocked", () => {
    const blockedWindow = { location: { search: "" } };
    Object.defineProperty(blockedWindow, "localStorage", {
      get() {
        throw new DOMException("Storage is blocked.", "SecurityError");
      }
    });
    vi.stubGlobal("window", blockedWindow);

    expect(readInitialLibraryState()).toEqual(defaultLibraryState);
    expect(() => writeLibraryStateToStorage(defaultLibraryState)).not.toThrow();
  });

  it("does not access storage when an explicit library URL is present", () => {
    const storageAccess = vi.fn(() => {
      throw new DOMException("Storage is blocked.", "SecurityError");
    });
    const blockedWindow = { location: { search: "?view=feed" } };
    Object.defineProperty(blockedWindow, "localStorage", {
      get: storageAccess
    });
    vi.stubGlobal("window", blockedWindow);

    expect(readInitialLibraryState().view).toBe("feed");
    expect(storageAccess).not.toHaveBeenCalled();
  });

  it("rejects old, malformed, and invalid stored state", () => {
    const validState = {
      ...defaultLibraryState,
      view: "feed" as const
    };

    expect(parseStoredLibraryState("not-json")).toBeNull();
    expect(
      parseStoredLibraryState(JSON.stringify({ version: 0, state: validState }))
    ).toBeNull();
    expect(
      parseStoredLibraryState(
        JSON.stringify({
          version: 1,
          state: { ...validState, view: "timeline" }
        })
      )
    ).toBeNull();
    expect(resolveInitialLibraryState("", "not-json")).toEqual(
      defaultLibraryState
    );
  });
});
