import type {
  MediaTypeFilter,
  RatingFilter,
  SortDirection,
  SortMode
} from "../api/client";

export interface AssetListQueryKeyInput {
  folderId: string | null;
  sort: SortMode;
  sortDirection: SortDirection;
  mediaType: MediaTypeFilter;
  search: string;
  tagFilter: string;
  ratingFilter: RatingFilter;
}

export interface LoadMoreState {
  folderId: string | null;
  isLoadingMore: boolean;
  isRequestInFlight: boolean;
  loadedCount: number;
  totalCount: number;
}

export function buildAssetListQueryKey(input: AssetListQueryKeyInput): string {
  return [
    input.folderId ?? "",
    input.sort,
    input.sortDirection,
    input.mediaType,
    input.search,
    input.tagFilter,
    input.ratingFilter
  ].join("\u001f");
}

export function canRequestMoreAssets(state: LoadMoreState): boolean {
  return Boolean(state.folderId) &&
    !state.isLoadingMore &&
    !state.isRequestInFlight &&
    state.loadedCount < state.totalCount;
}
