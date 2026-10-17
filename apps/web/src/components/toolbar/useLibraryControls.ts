import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MediaTypeFilter,
  ScoreFilter,
  SortDirection,
  SortMode,
  TreeResponse
} from "../../api/client";
import {
  defaultSortDirectionForSort,
  MAX_TAG_FILTER_LENGTH,
  MAX_TAG_FILTERS,
  normalizeTagDraft,
  normalizeTagIdentity,
  type AspectMode,
  type GridSize,
  type LibraryUrlState,
  type ViewMode
} from "../library-state";
import { useTagSuggestions } from "../tags/useTagSuggestions";

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
  const [isOptionsOpen, setOptionsOpen] = useState(false);
  const [gridSize, setGridSize] = useState<GridSize>(initialState.gridSize);
  const [aspect, setAspect] = useState<AspectMode>(initialState.aspect);
  const [sort, setSort] = useState<SortMode>(initialState.sort);
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    initialState.sortDirection
  );
  const [mediaType, setMediaType] = useState<MediaTypeFilter>(
    initialState.mediaType
  );
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>(
    initialState.scoreFilter
  );
  const [searchDraft, setSearchDraft] = useState(initialState.search);
  const [search, setSearch] = useState(initialState.search);
  const [tagFilterDraft, setTagFilterDraft] = useState("");
  const [tagFilters, setTagFilters] = useState(initialState.tags);
  const filterTagSuggestions = useTagSuggestions({ query: tagFilterDraft });

  const applyLibraryState = useCallback((state: LibraryUrlState) => {
    setView(state.view);
    setGridSize(state.gridSize);
    setAspect(state.aspect);
    setSort(state.sort);
    setSortDirection(state.sortDirection);
    setMediaType(state.mediaType);
    setScoreFilter(state.scoreFilter);
    setSearchDraft(state.search);
    setSearch(state.search);
    setTagFilters(state.tags);
    setOptionsOpen(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchDraft]);

  const selectedLabel = useMemo(() => {
    const root = tree?.roots.find(
      (entry) => entry.folderId === selectedFolderId
    );
    if (root) {
      return root.label;
    }

    return (
      tree?.folders.find((entry) => entry.id === selectedFolderId)?.label ??
      "Library"
    );
  }, [selectedFolderId, tree]);

  function addTagFilter(rawTagName: string) {
    const nextTagFilter = normalizeTagDraft(rawTagName).slice(
      0,
      MAX_TAG_FILTER_LENGTH
    );
    const normalizedTag = normalizeTagIdentity(nextTagFilter);

    if (
      !nextTagFilter ||
      tagFilters.length >= MAX_TAG_FILTERS ||
      tagFilters.some((tag) => normalizeTagIdentity(tag) === normalizedTag)
    ) {
      return;
    }

    setTagFilters((current) => [...current, nextTagFilter]);
    setTagFilterDraft("");
  }

  function removeTagFilter(tagToRemove: string) {
    setTagFilters((current) => current.filter((tag) => tag !== tagToRemove));
  }

  function clearTagFilters() {
    setTagFilters([]);
    setTagFilterDraft("");
  }

  function clearFilters() {
    setMediaType("all");
    setScoreFilter("all");
    clearTagFilters();
  }

  function selectSort(nextSort: SortMode) {
    setSort(nextSort);
    setSortDirection(defaultSortDirectionForSort(nextSort));
  }

  return {
    applyLibraryState,
    addTagFilter,
    aspect,
    clearTagFilters,
    clearFilters,
    filterTagSuggestions,
    gridSize,
    mediaType,
    isOptionsOpen,
    scoreFilter,
    removeTagFilter,
    search,
    searchDraft,
    selectedLabel,
    setAspect,
    setGridSize,
    setMediaType,
    setOptionsOpen,
    setScoreFilter,
    setSearchDraft,
    setSort: selectSort,
    setSortDirection,
    setTagFilterDraft,
    setView,
    sort,
    sortDirection,
    tagFilters,
    tagFilterDraft,
    view
  };
}
