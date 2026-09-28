import { describe, expect, it } from "vitest";
import {
  buildLibraryStateSearch,
  defaultLibraryState,
  MAX_TAG_FILTERS,
  parseLibraryStateSearch
} from "./library-state";

describe("library state URL helpers", () => {
  it("restores valid library controls from query parameters", () => {
    const state = parseLibraryStateSearch(
      "?folder=root-folder&view=feed&size=large&aspect=portrait&sort=rating&order=asc&type=video&rating=favorites&q=%20night%20sky%20&tag=%20Family%20%20Trip%20&tag=Friends&tag=family%20trip"
    );

    expect(state).toEqual({
      folderId: "root-folder",
      view: "feed",
      gridSize: "Large",
      aspect: "Portrait",
      sort: "rating",
      sortDirection: "asc",
      mediaType: "video",
      ratingFilter: "favorites",
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
      "?folder=&view=timeline&size=oversized&aspect=panorama&sort=path&order=sideways&type=audio&rating=private"
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
      sort: "rating",
      sortDirection: "asc",
      search: "city sky",
      tags: ["travel", "family"]
    });
    const params = new URLSearchParams(search);

    expect(params.get("folder")).toBe("folder-1");
    expect(params.get("view")).toBe("feed");
    expect(params.get("size")).toBe("compact");
    expect(params.get("aspect")).toBe("landscape");
    expect(params.get("sort")).toBe("rating");
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
});
