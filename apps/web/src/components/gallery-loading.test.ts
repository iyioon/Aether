import { describe, expect, it } from "vitest";
import {
  buildAssetListQueryKey,
  canRequestMoreAssets,
  isAssetListPending
} from "./gallery-loading";

describe("gallery loading helpers", () => {
  it("allows loading the next page only when a folder has more assets", () => {
    expect(
      canRequestMoreAssets({
        folderId: "folder-1",
        isLoadingMore: false,
        isRequestInFlight: false,
        loadedCount: 80,
        totalCount: 120
      })
    ).toBe(true);
  });

  it("prevents duplicate or impossible load-more requests", () => {
    const baseState = {
      folderId: "folder-1",
      isLoadingMore: false,
      isRequestInFlight: false,
      loadedCount: 120,
      totalCount: 120
    };

    expect(canRequestMoreAssets(baseState)).toBe(false);
    expect(canRequestMoreAssets({ ...baseState, totalCount: 160 })).toBe(true);
    expect(
      canRequestMoreAssets({
        ...baseState,
        totalCount: 160,
        isRequestInFlight: true
      })
    ).toBe(false);
    expect(
      canRequestMoreAssets({
        ...baseState,
        totalCount: 160,
        isLoadingMore: true
      })
    ).toBe(false);
    expect(
      canRequestMoreAssets({
        ...baseState,
        folderId: null,
        totalCount: 160
      })
    ).toBe(false);
  });

  it("changes the active query key when filters or sort direction change", () => {
    const baseKey = buildAssetListQueryKey({
      folderId: "folder-1",
      sort: "date",
      sortDirection: "desc",
      mediaType: "all",
      search: "",
      tagFilters: [],
      scoreFilter: "all"
    });

    const filteredKey = buildAssetListQueryKey({
      folderId: "folder-1",
      sort: "date",
      sortDirection: "asc",
      mediaType: "image",
      search: "sky",
      tagFilters: ["travel", "family"],
      scoreFilter: "favorites"
    });

    expect(filteredKey).not.toBe(baseKey);
  });

  it("keeps separate random orders in separate query keys", () => {
    const input = {
      folderId: "folder-1",
      sort: "random" as const,
      sortDirection: "desc" as const,
      mediaType: "all" as const,
      search: "",
      tagFilters: [],
      scoreFilter: "all" as const
    };

    expect(buildAssetListQueryKey({ ...input, randomSeed: 1 })).not.toBe(
      buildAssetListQueryKey({ ...input, randomSeed: 2 })
    );
  });

  it("distinguishes tag and field separators in user text without changing normal resume keys", () => {
    const input = {
      folderId: "folder-1",
      sort: "date" as const,
      sortDirection: "desc" as const,
      mediaType: "all" as const,
      search: "",
      tagFilters: ["one", "two"],
      scoreFilter: "all" as const
    };
    expect(buildAssetListQueryKey(input)).toBe(
      "folder-1\u001fdate\u001f\u001fdesc\u001fall\u001f\u001fone\u001etwo\u001fall"
    );
    expect(
      buildAssetListQueryKey({ ...input, tagFilters: ["one\u001etwo"] })
    ).not.toBe(buildAssetListQueryKey(input));
    expect(
      buildAssetListQueryKey({
        ...input,
        search: "one\u001ftwo",
        tagFilters: ["three"]
      })
    ).not.toBe(
      buildAssetListQueryKey({
        ...input,
        search: "one",
        tagFilters: ["two\u001fthree"]
      })
    );
    expect(
      buildAssetListQueryKey({
        ...input,
        tagFilters: ["one\u001etwo"],
        tagMatch: "all",
        tagStatus: "all"
      })
    ).toBe(buildAssetListQueryKey({ ...input, tagFilters: ["one\u001etwo"] }));
  });

  it("stays pending until the tree and current asset query are ready", () => {
    const readyState = {
      folderId: "folder-1",
      hasTree: true,
      isLoadingAssets: false,
      isLoadingTree: false,
      listQueryKey: "current-query",
      loadedQueryKey: "current-query"
    };

    expect(isAssetListPending(readyState)).toBe(false);
    expect(isAssetListPending({ ...readyState, isLoadingTree: true })).toBe(
      true
    );
    expect(isAssetListPending({ ...readyState, isLoadingAssets: true })).toBe(
      true
    );
    expect(
      isAssetListPending({ ...readyState, loadedQueryKey: "previous-query" })
    ).toBe(true);
  });

  it("allows an empty state after an empty or unavailable tree resolves", () => {
    expect(
      isAssetListPending({
        folderId: null,
        hasTree: false,
        isLoadingAssets: false,
        isLoadingTree: false,
        listQueryKey: "",
        loadedQueryKey: null
      })
    ).toBe(false);
  });
});

it("invalidates loaded windows when secondary sort priority or tag matching changes", () => {
  const input = {
    folderId: "folder-1",
    sort: "score" as const,
    sortDirection: "desc" as const,
    mediaType: "all" as const,
    search: "",
    tagFilters: ["one", "two"],
    scoreFilter: "all" as const
  };
  const legacy = buildAssetListQueryKey(input);
  expect(
    buildAssetListQueryKey({ ...input, tagMatch: "all", tagStatus: "all" })
  ).toBe(legacy);
  const rules = [
    { field: "score" as const, direction: "desc" as const },
    { field: "filename" as const, direction: "asc" as const }
  ];
  const ordered = buildAssetListQueryKey({ ...input, sortCriteria: rules });
  expect(ordered).not.toBe(legacy);
  expect(
    buildAssetListQueryKey({ ...input, sortCriteria: [...rules].reverse() })
  ).not.toBe(ordered);
  expect(buildAssetListQueryKey({ ...input, tagMatch: "any" })).not.toBe(
    legacy
  );
  expect(buildAssetListQueryKey({ ...input, tagStatus: "untagged" })).not.toBe(
    legacy
  );
});

it("keeps Random's query identity independent of inactive ordered rules", () => {
  const input = {
    folderId: "folder",
    sort: "random" as const,
    sortDirection: "desc" as const,
    randomSeed: 42,
    mediaType: "all" as const,
    search: "",
    tagFilters: [],
    scoreFilter: "all" as const
  };
  expect(
    buildAssetListQueryKey({
      ...input,
      sortCriteria: [{ field: "tags", direction: "asc" }]
    })
  ).toBe(buildAssetListQueryKey(input));
});
