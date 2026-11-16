import { describe, expect, it } from "vitest";
import {
  buildLibraryStateSearch,
  defaultLibraryState,
  MAX_SEARCH_LENGTH,
  MAX_TAG_FILTERS,
  normalizeLibrarySearch,
  parseLibraryStateSearch,
  parseStoredLibraryState,
  serializeLibraryState
} from "./library-state";

describe("library state URL helpers", () => {
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

  it("round-trips the comparison view in library URLs", () => {
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
    expect(params.get("aspect")).toBeNull();
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

  it("normalizes and bounds search in links without reducing folder ID limits", () => {
    const folderId = "f".repeat(160);
    const search = `  Ａ${"b".repeat(150)}  `;
    const expected = `A${"b".repeat(MAX_SEARCH_LENGTH - 1)}`;
    const state = { ...defaultLibraryState, folderId, search };

    expect(normalizeLibrarySearch(search)).toBe(expected);
    expect(normalizeLibrarySearch("  서울 여행  ")).toBe("서울 여행");
    expect(normalizeLibrarySearch("x".repeat(MAX_SEARCH_LENGTH))).toHaveLength(
      MAX_SEARCH_LENGTH
    );
    expect(
      parseLibraryStateSearch(
        `?q=${encodeURIComponent(search)}&folder=${folderId}`
      )
    ).toMatchObject({ folderId, search: expected });
    expect(new URLSearchParams(buildLibraryStateSearch(state)).get("q")).toBe(
      expected
    );
    expect(buildLibraryStateSearch({ ...state, search: "   " })).not.toContain(
      "q="
    );
  });

  it("retains legacy checkpoints while shortening their search to the API limit", () => {
    const legacyState = {
      ...defaultLibraryState,
      folderId: "f".repeat(160),
      search: "x".repeat(160)
    };
    const expected = {
      ...legacyState,
      search: "x".repeat(MAX_SEARCH_LENGTH)
    };
    expect(
      parseStoredLibraryState(
        JSON.stringify({ version: 1, state: legacyState })
      )
    ).toEqual(expected);
    expect(JSON.parse(serializeLibraryState(legacyState)) as unknown).toEqual({
      version: 1,
      state: expected
    });
    expect(
      parseStoredLibraryState(
        JSON.stringify({
          version: 1,
          state: { ...legacyState, search: "x".repeat(161) }
        })
      )
    ).toBeNull();
  });

  it("rejects old, malformed, and invalid stored state", () => {
    const validState = {
      ...defaultLibraryState,
      aspect: "Portrait" as const,
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
    expect(parseStoredLibraryState(serializeLibraryState(validState))).toEqual(
      validState
    );
  });
});

describe("highlight-only preference", () => {
  it("round-trips explicit links and saved state without changing legacy defaults", () => {
    const state = { ...defaultLibraryState, highlightsOnly: true };
    expect(
      parseLibraryStateSearch(buildLibraryStateSearch(state)).highlightsOnly
    ).toBe(true);
    expect(
      parseStoredLibraryState(serializeLibraryState(state))?.highlightsOnly
    ).toBe(true);
    expect(
      parseLibraryStateSearch("?highlight=anything").highlightsOnly
    ).toBeUndefined();
    expect(buildLibraryStateSearch(defaultLibraryState)).not.toContain(
      "highlight"
    );
    expect(
      parseStoredLibraryState(
        JSON.stringify({
          version: 1,
          state: { ...state, highlightsOnly: "true" }
        })
      )
    ).toBeNull();
  });
});

describe("ordered sorting and tag filter state", () => {
  it("round-trips ordered rules, each direction and tag matching", () => {
    const state = parseLibraryStateSearch(
      "?sortBy=tags:asc&sortBy=score:desc&sortBy=filename:asc&tag=one&tag=two&tagMatch=any&tagStatus=tagged&highlight=0"
    );
    expect(state).toMatchObject({
      sort: "tags",
      sortDirection: "asc",
      sortCriteria: [
        { field: "tags", direction: "asc" },
        { field: "score", direction: "desc" },
        { field: "filename", direction: "asc" }
      ],
      tagMatch: "any",
      tagStatus: "tagged",
      highlightsOnly: false
    });
    expect(parseLibraryStateSearch(buildLibraryStateSearch(state))).toEqual(
      state
    );
    expect(parseStoredLibraryState(serializeLibraryState(state))).toEqual(
      state
    );
  });

  it("rejects invalid, duplicate and excessive URL rules without breaking legacy links", () => {
    for (const rules of [
      "sortBy=filename:asc&sortBy=filename:desc",
      "sortBy=unknown:asc",
      "sortBy=date:sideways",
      "sortBy=date:asc:extra",
      "sortBy=date:asc&sortBy=filename:asc&sortBy=score:desc&sortBy=tags:asc&sortBy=size:desc&sortBy=duration:asc"
    ]) {
      expect(parseLibraryStateSearch(`?sort=oldest&${rules}`)).toMatchObject({
        sort: "date",
        sortDirection: "asc"
      });
      expect(parseLibraryStateSearch(`?${rules}`).sortCriteria).toBeUndefined();
    }
    expect(
      parseLibraryStateSearch("?sort=random&sortBy=score:desc")
    ).toMatchObject({ sort: "random" });
    expect(
      parseLibraryStateSearch("?sort=random&sortBy=score:desc").sortCriteria
    ).toBeUndefined();
    expect(
      parseLibraryStateSearch("?sort=filename&order=desc").sortCriteria
    ).toBeUndefined();
  });

  it("rejects malformed persisted rules and filter modes", () => {
    for (const patch of [
      { sortCriteria: [] },
      {
        sortCriteria: [
          { field: "date", direction: "asc" },
          { field: "date", direction: "desc" }
        ]
      },
      { tagMatch: "none" },
      { tagStatus: "missing" }
    ]) {
      expect(
        parseStoredLibraryState(
          JSON.stringify({
            version: 1,
            state: { ...defaultLibraryState, ...patch }
          })
        )
      ).toBeNull();
    }
  });
});

it("retains inactive sort rules for Random without sending them in links", () => {
  const state = {
    ...defaultLibraryState,
    sort: "random" as const,
    sortCriteria: [
      { field: "filename" as const, direction: "asc" as const },
      { field: "score" as const, direction: "desc" as const }
    ]
  };
  expect(parseStoredLibraryState(serializeLibraryState(state))).toEqual(state);
  expect(
    new URLSearchParams(buildLibraryStateSearch(state)).getAll("sortBy")
  ).toEqual([]);
});
