import type {
  MediaTypeFilter,
  RatingFilter,
  SortMode
} from "../api/client";

export const viewOptions = ["gallery", "feed"] as const;
export type ViewMode = (typeof viewOptions)[number];

export const aspectOptions = [
  "Square",
  "Original",
  "Portrait",
  "Landscape"
] as const;
export type AspectMode = (typeof aspectOptions)[number];

export const sizeOptions = ["Tiny", "Compact", "Medium", "Large", "Huge"] as const;
export type GridSize = (typeof sizeOptions)[number];

export const sortValues: readonly SortMode[] = [
  "newest",
  "oldest",
  "filename",
  "rating",
  "random"
];

export const mediaFilterValues: readonly MediaTypeFilter[] = [
  "all",
  "image",
  "video"
];

export const ratingFilterValues: readonly RatingFilter[] = [
  "all",
  "favorites",
  "rated",
  "unrated"
];

export interface LibraryUrlState {
  folderId: string | null;
  view: ViewMode;
  gridSize: GridSize;
  aspect: AspectMode;
  sort: SortMode;
  mediaType: MediaTypeFilter;
  ratingFilter: RatingFilter;
  search: string;
  tag: string;
}

export const defaultLibraryState: LibraryUrlState = {
  folderId: null,
  view: "gallery",
  gridSize: "Medium",
  aspect: "Square",
  sort: "newest",
  mediaType: "all",
  ratingFilter: "all",
  search: "",
  tag: ""
};

export function readLibraryStateFromUrl(): LibraryUrlState {
  if (typeof window === "undefined") {
    return defaultLibraryState;
  }

  return parseLibraryStateSearch(window.location.search);
}

export function writeLibraryStateToUrl(state: LibraryUrlState): void {
  if (typeof window === "undefined") {
    return;
  }

  const query = buildLibraryStateSearch(state);
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${
    window.location.hash
  }`;
  const currentUrl = `${window.location.pathname}${window.location.search}${
    window.location.hash
  }`;

  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

export function parseLibraryStateSearch(search: string): LibraryUrlState {
  const params = new URLSearchParams(search);

  return {
    folderId: readTextParam(params, "folder", 160) || null,
    view: readOptionParam(params, "view", viewOptions, defaultLibraryState.view),
    gridSize: readMappedOptionParam(
      params,
      "size",
      sizeOptions,
      defaultLibraryState.gridSize
    ),
    aspect: readMappedOptionParam(
      params,
      "aspect",
      aspectOptions,
      defaultLibraryState.aspect
    ),
    sort: readOptionParam(params, "sort", sortValues, defaultLibraryState.sort),
    mediaType: readOptionParam(
      params,
      "type",
      mediaFilterValues,
      defaultLibraryState.mediaType
    ),
    ratingFilter: readOptionParam(
      params,
      "rating",
      ratingFilterValues,
      defaultLibraryState.ratingFilter
    ),
    search: readTextParam(params, "q", 160),
    tag: normalizeTagDraft(readTextParam(params, "tag", 48))
  };
}

export function buildLibraryStateSearch(state: LibraryUrlState): string {
  const params = new URLSearchParams();

  if (state.folderId) {
    params.set("folder", state.folderId);
  }

  if (state.view !== defaultLibraryState.view) {
    params.set("view", state.view);
  }

  if (state.gridSize !== defaultLibraryState.gridSize) {
    params.set("size", state.gridSize.toLowerCase());
  }

  if (state.aspect !== defaultLibraryState.aspect) {
    params.set("aspect", state.aspect.toLowerCase());
  }

  if (state.sort !== defaultLibraryState.sort) {
    params.set("sort", state.sort);
  }

  if (state.mediaType !== defaultLibraryState.mediaType) {
    params.set("type", state.mediaType);
  }

  if (state.ratingFilter !== defaultLibraryState.ratingFilter) {
    params.set("rating", state.ratingFilter);
  }

  if (state.search) {
    params.set("q", state.search);
  }

  if (state.tag) {
    params.set("tag", state.tag);
  }

  return params.toString();
}

export function normalizeTagDraft(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function readTextParam(
  params: URLSearchParams,
  key: string,
  maxLength: number
): string {
  return (params.get(key) ?? "").normalize("NFKC").trim().slice(0, maxLength);
}

function readOptionParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowedValues: readonly T[],
  fallback: T
): T {
  const value = params.get(key);

  if (!value) {
    return fallback;
  }

  return allowedValues.includes(value as T) ? (value as T) : fallback;
}

function readMappedOptionParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowedValues: readonly T[],
  fallback: T
): T {
  const value = params.get(key)?.toLowerCase();

  if (!value) {
    return fallback;
  }

  return (
    allowedValues.find((option) => option.toLowerCase() === value) ?? fallback
  );
}
