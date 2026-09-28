import type {
  MediaTypeFilter,
  ScoreFilter,
  SortDirection,
  SortMode
} from "../api/client";

export interface AssetListQueryKeyInput {
  folderId: string | null;
  sort: SortMode;
  sortDirection: SortDirection;
  mediaType: MediaTypeFilter;
  search: string;
  tagFilters: string[];
  scoreFilter: ScoreFilter;
}

export interface LoadMoreState {
  folderId: string | null;
  isLoadingMore: boolean;
  isRequestInFlight: boolean;
  loadedCount: number;
  totalCount: number;
}

export interface AssetListPendingState {
  folderId: string | null;
  hasTree: boolean;
  isLoadingAssets: boolean;
  isLoadingTree: boolean;
  listQueryKey: string;
  loadedQueryKey: string | null;
}

export function buildAssetListQueryKey(input: AssetListQueryKeyInput): string {
  return [
    input.folderId ?? "",
    input.sort,
    input.sortDirection,
    input.mediaType,
    input.search,
    input.tagFilters.join("\u001e"),
    input.scoreFilter
  ].join("\u001f");
}

export function canRequestMoreAssets(state: LoadMoreState): boolean {
  return (
    Boolean(state.folderId) &&
    !state.isLoadingMore &&
    !state.isRequestInFlight &&
    state.loadedCount < state.totalCount
  );
}

export function isAssetListPending(state: AssetListPendingState): boolean {
  return (
    state.isLoadingTree ||
    state.isLoadingAssets ||
    (state.hasTree &&
      Boolean(state.folderId) &&
      state.loadedQueryKey !== state.listQueryKey)
  );
}
