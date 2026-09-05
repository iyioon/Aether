import { useEffect, useMemo, useState } from "react";
import type {
  MediaTypeFilter,
  RatingFilter,
  SortDirection,
  SortMode,
  TreeResponse
} from "../../api/client";
import {
  defaultSortDirectionForSort,
  normalizeTagDraft,
  writeLibraryStateToUrl,
  type AspectMode,
  type GridSize,
  type LibraryUrlState,
  type ViewMode
} from "../library-state";
import { useTagSuggestions } from "../tags/useTagSuggestions";
import {
  mediaFilters,
  ratingFilters,
  sortDirectionOptions,
  sortOptions,
  type ControlMenuId
} from "./library-control-options";

interface UseLibraryControlsOptions {
  initialState: LibraryUrlState;
  selectedFolderId: string | null;
  tree: TreeResponse | null;
}

export function useLibraryControls({
  initialState,
  selectedFolderId,
  tree
}: UseLibraryControlsOptions) {
  const [view, setView] = useState<ViewMode>(initialState.view);
  const [openControlMenu, setOpenControlMenu] =
    useState<ControlMenuId | null>(null);
  const [gridSize, setGridSize] = useState<GridSize>(initialState.gridSize);
  const [aspect, setAspect] = useState<AspectMode>(initialState.aspect);
  const [sort, setSort] = useState<SortMode>(initialState.sort);
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    initialState.sortDirection
  );
  const [mediaType, setMediaType] = useState<MediaTypeFilter>(
    initialState.mediaType
  );
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(
    initialState.ratingFilter
  );
  const [searchDraft, setSearchDraft] = useState(initialState.search);
  const [search, setSearch] = useState(initialState.search);
  const [tagFilterDraft, setTagFilterDraft] = useState(initialState.tag);
  const [tagFilter, setTagFilter] = useState(initialState.tag);
  const filterTagSuggestions = useTagSuggestions({ query: tagFilterDraft });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchDraft]);

  useEffect(() => {
    if (!tree) {
      return;
    }

    writeLibraryStateToUrl({
      folderId: selectedFolderId,
      view,
      gridSize,
      aspect,
      sort,
      sortDirection,
      mediaType,
      ratingFilter,
      search,
      tag: tagFilter
    });
  }, [
    aspect,
    gridSize,
    mediaType,
    ratingFilter,
    search,
    selectedFolderId,
    sort,
    sortDirection,
    tagFilter,
    tree,
    view
  ]);

  const selectedLabel = useMemo(() => {
    const root = tree?.roots.find((entry) => entry.folderId === selectedFolderId);
    if (root) {
      return root.label;
    }

    return (
      tree?.folders.find((entry) => entry.id === selectedFolderId)?.label ??
      "Library"
    );
  }, [selectedFolderId, tree]);

  const sortLabel =
    sortOptions.find((option) => option.value === sort)?.label ?? "Date";
  const sortDirectionLabel =
    sortDirectionOptions.find((option) => option.value === sortDirection)
      ?.label ?? "Descending";
  const mediaTypeLabel =
    mediaFilters.find((option) => option.value === mediaType)?.label ?? "All";
  const ratingFilterLabel =
    ratingFilters.find((option) => option.value === ratingFilter)?.label ??
    "All ratings";
  const activeFilterLabels: string[] = [];

  if (mediaType !== "all") {
    activeFilterLabels.push(mediaTypeLabel);
  }

  if (ratingFilter !== "all") {
    activeFilterLabels.push(ratingFilterLabel);
  }

  if (tagFilter) {
    activeFilterLabels.push(`#${tagFilter}`);
  }

  function applyTagFilter(rawTagName: string) {
    const nextTagFilter = normalizeTagDraft(rawTagName);
    setTagFilter(nextTagFilter);
    setTagFilterDraft(nextTagFilter);
  }

  function clearTagFilter() {
    setTagFilter("");
    setTagFilterDraft("");
  }

  function clearLibraryFilters() {
    setMediaType("all");
    setRatingFilter("all");
    clearTagFilter();
  }

  function selectSort(nextSort: SortMode) {
    setSort(nextSort);
    setSortDirection(defaultSortDirectionForSort(nextSort));
  }

  return {
    activeFilterLabels,
    applyTagFilter,
    aspect,
    clearLibraryFilters,
    clearTagFilter,
    filterSummary: activeFilterLabels.length
      ? activeFilterLabels.join(" · ")
      : "All media",
    filterTagSuggestions,
    gridSize,
    layoutSummary: `${gridSize} · ${aspect}`,
    mediaType,
    mediaTypeLabel,
    openControlMenu,
    ratingFilter,
    ratingFilterLabel,
    search,
    searchDraft,
    selectedLabel,
    setAspect,
    setGridSize,
    setMediaType,
    setOpenControlMenu,
    setRatingFilter,
    setSearchDraft,
    setSort: selectSort,
    setSortDirection,
    setTagFilterDraft,
    setView,
    sort,
    sortDirection,
    sortDirectionLabel,
    sortLabel,
    sortSummary: sort === "random" ? sortLabel : `${sortLabel} · ${sortDirectionLabel}`,
    tagFilter,
    tagFilterDraft,
    view
  };
}
