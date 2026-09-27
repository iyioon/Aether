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
      ratingFilter: "all"
    });

    const filteredKey = buildAssetListQueryKey({
      folderId: "folder-1",
      sort: "date",
      sortDirection: "asc",
      mediaType: "image",
      search: "sky",
      tagFilters: ["travel", "family"],
      ratingFilter: "favorites"
    });

    expect(filteredKey).not.toBe(baseKey);
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
    expect(isAssetListPending({ ...readyState, isLoadingTree: true })).toBe(true);
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
