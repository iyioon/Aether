import type {
  MediaTypeFilter,
  ScoreFilter,
  SortDirection,
  SortMode
} from "../api/client";

export const viewOptions = ["gallery", "feed", "compare"] as const;
export type ViewMode = (typeof viewOptions)[number];

export const aspectOptions = [
  "Square",
  "Original",
  "Portrait",
  "Landscape"
] as const;
export type AspectMode = (typeof aspectOptions)[number];

export function layoutOptionsForView(view: ViewMode): readonly AspectMode[] {
  return view === "feed" ? ["Portrait"] : aspectOptions;
}

export function normalizeAspectForView(
  view: ViewMode,
  value: unknown
): AspectMode {
  return (
    layoutOptionsForView(view).find((option) => option === value) ??
    defaultAspectForView(view)
  );
}

export function defaultAspectForView(view: ViewMode): AspectMode {
  return view === "gallery"
    ? "Square"
    : view === "feed"
      ? "Portrait"
      : "Original";
}

export const sizeOptions = [
  "Tiny",
  "Compact",
  "Medium",
  "Large",
  "Huge"
] as const;
export type GridSize = (typeof sizeOptions)[number];

export const sortValues: readonly SortMode[] = [
  "date",
  "filename",
  "score",
  "random"
];

export const sortDirectionValues: readonly SortDirection[] = ["desc", "asc"];

export const mediaFilterValues: readonly MediaTypeFilter[] = [
  "all",
  "image",
  "video"
];

export const scoreFilterValues: readonly ScoreFilter[] = [
  "all",
  "favorites",
  "ranked",
  "unranked"
];

export const MAX_TAG_FILTERS = 20;
export const MAX_TAG_FILTER_LENGTH = 48;

export const LIBRARY_STATE_STORAGE_KEY = "aether.library-state.v1";

const LIBRARY_STATE_VERSION = 1;
const MAX_STORED_LIBRARY_STATE_LENGTH = 8_192;
const libraryQueryKeys = [
  "folder",
  "view",
  "size",
  "aspect",
  "sort",
  "order",
  "type",
  "score",
  "q",
  "tag",
  "highlight"
] as const;

export function defaultSortDirectionForSort(sort: SortMode): SortDirection {
  return sort === "filename" ? "asc" : "desc";
}

export interface LibraryUrlState {
  folderId: string | null;
  view: ViewMode;
  gridSize: GridSize;
  aspect: AspectMode;
  sort: SortMode;
  sortDirection: SortDirection;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  search: string;
  tags: string[];
  highlightsOnly?: boolean;
}

export const defaultLibraryState: LibraryUrlState = {
  folderId: null,
  view: "gallery",
  gridSize: "Medium",
  aspect: "Square",
  sort: "date",
  sortDirection: "desc",
  mediaType: "all",
  scoreFilter: "all",
  search: "",
  tags: []
};

export function isResumeLaunch(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("launch") === "resume") return true;
  // Older iOS installations may launch a gallery/filter URL saved at install time.
  // Explicit view/page links retain their usual precedence.
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (typeof navigator !== "undefined" &&
      "standalone" in navigator &&
      navigator.standalone === true);
  return Boolean(
    standalone &&
    hasExplicitLibraryStateQuery(window.location.search) &&
    !["view", "page", "workspace", "asset"].some((key) => params.has(key))
  );
}

export function hasExplicitLibraryStateQuery(search: string): boolean {
  const params = new URLSearchParams(search);

  return libraryQueryKeys.some((key) => params.has(key));
}

export function parseStoredLibraryState(
  serializedState: string | null
): LibraryUrlState | null {
  if (
    !serializedState ||
    serializedState.length > MAX_STORED_LIBRARY_STATE_LENGTH
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(serializedState);

    if (
      !isRecord(parsed) ||
      parsed.version !== LIBRARY_STATE_VERSION ||
      !isLibraryUrlState(parsed.state)
    ) {
      return null;
    }

    return {
      ...parsed.state,
      aspect: normalizeAspectForView(parsed.state.view, parsed.state.aspect),
      folderId: normalizeStoredText(parsed.state.folderId, 160) || null,
      search: normalizeStoredText(parsed.state.search, 160),
      tags: parsed.state.tags.map(normalizeStoredTag)
    };
  } catch {
    return null;
  }
}

export function serializeLibraryState(state: LibraryUrlState): string {
  return JSON.stringify({ version: LIBRARY_STATE_VERSION, state });
}

export function writeLibraryStateToStorage(state: LibraryUrlState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      LIBRARY_STATE_STORAGE_KEY,
      serializeLibraryState(state)
    );
  } catch {
    // Persistence failure must never interrupt navigation or session changes.
  }
}

export function parseLibraryStateSearch(search: string): LibraryUrlState {
  const params = new URLSearchParams(search);
  const parsedSort = readSortParams(params);
  const view = readOptionParam(
    params,
    "view",
    viewOptions,
    defaultLibraryState.view
  );

  return {
    folderId: readTextParam(params, "folder", 160) || null,
    view,
    gridSize: readMappedOptionParam(
      params,
      "size",
      sizeOptions,
      defaultLibraryState.gridSize
    ),
    aspect: normalizeAspectForView(
      view,
      readMappedOptionParam(
        params,
        "aspect",
        aspectOptions,
        defaultAspectForView(view)
      )
    ),
    sort: parsedSort.sort,
    sortDirection: parsedSort.sortDirection,
    mediaType: readOptionParam(
      params,
      "type",
      mediaFilterValues,
      defaultLibraryState.mediaType
    ),
    scoreFilter: readOptionParam(
      params,
      "score",
      scoreFilterValues,
      defaultLibraryState.scoreFilter
    ),
    search: readTextParam(params, "q", 160),
    tags: readTagParams(params),
    ...(params.get("highlight") === "1" ? { highlightsOnly: true } : {})
  };
}

export function buildLibraryStateSearch(state: LibraryUrlState): string {
  const params = new URLSearchParams();
  if (state.highlightsOnly) params.set("highlight", "1");

  if (state.folderId) {
    params.set("folder", state.folderId);
  }

  if (state.view !== defaultLibraryState.view) {
    params.set("view", state.view);
  }

  if (state.gridSize !== defaultLibraryState.gridSize) {
    params.set("size", state.gridSize.toLowerCase());
  }

  if (
    state.view !== "feed" &&
    state.aspect !== defaultAspectForView(state.view)
  ) {
    params.set("aspect", state.aspect.toLowerCase());
  }

  if (state.sort !== defaultLibraryState.sort) {
    params.set("sort", state.sort);
  }

  if (
    state.sort !== "random" &&
    state.sortDirection !== defaultSortDirectionForSort(state.sort)
  ) {
    params.set("order", state.sortDirection);
  }

  if (state.mediaType !== defaultLibraryState.mediaType) {
    params.set("type", state.mediaType);
  }

  if (state.scoreFilter !== defaultLibraryState.scoreFilter) {
    params.set("score", state.scoreFilter);
  }

  if (state.search) {
    params.set("q", state.search);
  }

  for (const tag of state.tags) {
    params.append("tag", tag);
  }

  return params.toString();
}

export function normalizeTagDraft(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeTagIdentity(input: string): string {
  return normalizeTagDraft(input).toLocaleLowerCase("en-US");
}

function readTagParams(params: URLSearchParams): string[] {
  const tags: string[] = [];
  const normalizedTags = new Set<string>();

  for (const rawTag of params.getAll("tag")) {
    const tag = normalizeTagDraft(rawTag).slice(0, MAX_TAG_FILTER_LENGTH);
    const normalizedTag = normalizeTagIdentity(tag);

    if (!tag || normalizedTags.has(normalizedTag)) {
      continue;
    }

    normalizedTags.add(normalizedTag);
    tags.push(tag);

    if (tags.length === MAX_TAG_FILTERS) {
      break;
    }
  }

  return tags;
}

function readSortParams(params: URLSearchParams): {
  sort: SortMode;
  sortDirection: SortDirection;
} {
  const rawSort = params.get("sort");

  if (rawSort === "newest") {
    return { sort: "date", sortDirection: "desc" };
  }

  if (rawSort === "oldest") {
    return { sort: "date", sortDirection: "asc" };
  }

  const sort = readOptionParam(
    params,
    "sort",
    sortValues,
    defaultLibraryState.sort
  );

  return {
    sort,
    sortDirection: readOptionParam(
      params,
      "order",
      sortDirectionValues,
      defaultSortDirectionForSort(sort)
    )
  };
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

type StoredLibraryUrlState = Omit<LibraryUrlState, "aspect"> & {
  aspect: AspectMode | "Fill screen";
};

function isLibraryUrlState(value: unknown): value is StoredLibraryUrlState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.folderId === null ||
      (typeof value.folderId === "string" && value.folderId.length <= 160)) &&
    isAllowedValue(value.view, viewOptions) &&
    isAllowedValue(value.gridSize, sizeOptions) &&
    (isAllowedValue(value.aspect, aspectOptions) ||
      (value.view === "feed" && value.aspect === "Fill screen")) &&
    isAllowedValue(value.sort, sortValues) &&
    isAllowedValue(value.sortDirection, sortDirectionValues) &&
    isAllowedValue(value.mediaType, mediaFilterValues) &&
    isAllowedValue(value.scoreFilter, scoreFilterValues) &&
    typeof value.search === "string" &&
    value.search.length <= 160 &&
    isValidStoredTags(value.tags) &&
    (value.highlightsOnly === undefined ||
      typeof value.highlightsOnly === "boolean")
  );
}

function isValidStoredTags(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_TAG_FILTERS) {
    return false;
  }

  const normalizedTags = new Set<string>();

  for (const tag of value) {
    if (typeof tag !== "string" || tag.length > MAX_TAG_FILTER_LENGTH) {
      return false;
    }

    const normalizedTag = normalizeStoredTag(tag);
    const identity = normalizeTagIdentity(normalizedTag);

    if (!normalizedTag || normalizedTags.has(identity)) {
      return false;
    }

    normalizedTags.add(identity);
  }

  return true;
}

function isAllowedValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[]
): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

function normalizeStoredText(value: string | null, maxLength: number): string {
  return (value ?? "").normalize("NFKC").trim().slice(0, maxLength);
}

function normalizeStoredTag(value: string): string {
  return normalizeTagDraft(value).slice(0, MAX_TAG_FILTER_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
