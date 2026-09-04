import { describe, expect, it } from "vitest";
import {
  buildLibraryStateSearch,
  defaultLibraryState,
  parseLibraryStateSearch
} from "./library-state";

describe("library state URL helpers", () => {
  it("restores valid library controls from query parameters", () => {
    const state = parseLibraryStateSearch(
      "?folder=root-folder&view=feed&size=large&aspect=portrait&sort=rating&type=video&rating=favorites&q=%20night%20sky%20&tag=%20Family%20%20Trip%20"
    );

    expect(state).toEqual({
      folderId: "root-folder",
      view: "feed",
      gridSize: "Large",
      aspect: "Portrait",
      sort: "rating",
      mediaType: "video",
      ratingFilter: "favorites",
      search: "night sky",
      tag: "Family Trip"
    });
  });

  it("falls back to safe defaults for invalid enum values", () => {
    const state = parseLibraryStateSearch(
      "?folder=&view=timeline&size=oversized&aspect=panorama&sort=path&type=audio&rating=private"
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
      search: "city sky",
      tag: "travel"
    });
    const params = new URLSearchParams(search);

    expect(params.get("folder")).toBe("folder-1");
    expect(params.get("view")).toBe("feed");
    expect(params.get("size")).toBe("compact");
    expect(params.get("aspect")).toBe("landscape");
    expect(params.get("q")).toBe("city sky");
    expect(params.get("tag")).toBe("travel");
    expect(search).not.toContain("password");
    expect(search).not.toContain("session");
    expect(search).not.toContain("csrf");
  });
});
