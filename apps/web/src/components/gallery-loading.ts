import type {
  MediaTypeFilter,
  ScoreFilter,
  SortCriterion,
  TagMatch,
  TagStatus,
  SortDirection,
  SortMode
} from "../api/client";

export interface AssetListQueryKeyInput {
  folderId: string | null;
  randomSeed?: number;
  sort: SortMode;
  sortDirection: SortDirection;
  sortCriteria?: SortCriterion[];
  tagMatch?: TagMatch;
  tagStatus?: TagStatus;
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
  // Keep existing resume keys unless user text contains the legacy separators.
  // A tag containing the tag separator must not alias two separate tags.
  if (
    [input.folderId ?? "", input.search, ...input.tagFilters].some(
      (value) => value.includes("\u001e") || value.includes("\u001f")
    )
  )
    return JSON.stringify([
      input.folderId ?? "",
      input.sort,
      input.randomSeed ?? "",
      input.sortDirection,
      input.mediaType,
      input.search,
      input.tagFilters,
      input.scoreFilter,
      input.sort !== "random" ? (input.sortCriteria ?? null) : null,
      input.tagMatch ?? "all",
      input.tagStatus ?? "all"
    ]);
  const base = [
    input.folderId ?? "",
    input.sort,
    input.randomSeed ?? "",
    input.sortDirection,
    input.mediaType,
    input.search,
    input.tagFilters.join("\u001e"),
    input.scoreFilter
  ].join("\u001f");
  const extra = [
    input.sort !== "random" && input.sortCriteria
      ? JSON.stringify(input.sortCriteria)
      : "",
    input.tagMatch === "any" ? "any" : "",
    input.tagStatus && input.tagStatus !== "all" ? input.tagStatus : ""
  ];
  return extra.some(Boolean) ? `${base}\u001f${extra.join("\u001f")}` : base;
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
