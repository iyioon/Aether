import { useCallback, useEffect, useState } from "react";
import type {
  ScoreFilter,
  SortCriterion,
  SortDirection,
  SortMode
} from "../../api/client";
import {
  defaultSortDirectionForSort,
  normalizeLibrarySearch,
  type AspectMode,
  layoutOptionsForView,
  normalizeAspectForView,
  type GridSize,
  type LibraryUrlState,
  type ViewMode
} from "../library-state";
import { readViewAspects, writeViewAspects } from "./view-layout-state";
import type { LibrarySearchValues } from "./search-state";

interface UseLibraryControlsOptions {
  initialState: LibraryUrlState;
}

export function useLibraryControls({
  initialState
}: UseLibraryControlsOptions) {
  const [view, setView] = useState<ViewMode>(initialState.view);
  const [isOptionsOpen, setOptionsOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [highlightsOnly, setHighlightsOnly] = useState(
    initialState.highlightsOnly ?? false
  );
  const [gridSize, setGridSize] = useState<GridSize>(initialState.gridSize);
  const [viewAspects, setViewAspects] = useState(() => ({
    ...readViewAspects(),
    [initialState.view]: normalizeAspectForView(
      initialState.view,
      initialState.aspect
    )
  }));
  const aspect = normalizeAspectForView(view, viewAspects[view]);
  function setAspect(next: AspectMode) {
    if (!layoutOptionsForView(view).includes(next)) return;
    setViewAspects((current) => ({ ...current, [view]: next }));
  }
  useEffect(() => writeViewAspects(viewAspects), [viewAspects]);
  const [sort, setSort] = useState<SortMode>(initialState.sort);
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    initialState.sortDirection
  );
  const [sortCriteria, setSortCriteriaState] = useState<
    SortCriterion[] | undefined
  >(initialState.sortCriteria);
  const [searchFilters, setSearchFilters] = useState<
    Omit<LibrarySearchValues, "folderId">
  >(() => ({
    search: normalizeLibrarySearch(initialState.search),
    tags: initialState.tags,
    tagMatch: initialState.tagMatch ?? "all",
    tagStatus: initialState.tagStatus ?? "all",
    mediaType: initialState.mediaType,
    scoreFilter: initialState.scoreFilter
  }));
  const {
    search,
    tags: tagFilters,
    tagMatch,
    tagStatus,
    mediaType,
    scoreFilter
  } = searchFilters;

  const applySearch = useCallback((values: LibrarySearchValues) => {
    setSearchFilters({
      search: normalizeLibrarySearch(values.search),
      tags: values.tagStatus === "untagged" ? [] : values.tags,
      tagMatch: values.tagMatch,
      tagStatus: values.tagStatus,
      mediaType: values.mediaType,
      scoreFilter: values.scoreFilter
    });
    setSearchOpen(false);
  }, []);

  const applyLibraryState = useCallback((state: LibraryUrlState) => {
    setView(state.view);
    setHighlightsOnly(state.highlightsOnly ?? false);
    setGridSize(state.gridSize);
    setViewAspects((current) => ({
      ...current,
      [state.view]: normalizeAspectForView(state.view, state.aspect)
    }));
    setSort(state.sort);
    setSortDirection(state.sortDirection);
    setSortCriteriaState(state.sortCriteria);
    setSearchFilters({
      search: normalizeLibrarySearch(state.search),
      tags: state.tags,
      tagMatch: state.tagMatch ?? "all",
      tagStatus: state.tagStatus ?? "all",
      mediaType: state.mediaType,
      scoreFilter: state.scoreFilter
    });
    setOptionsOpen(false);
    setSearchOpen(false);
  }, []);

  function clearTagFilters() {
    setSearchFilters((current) => ({
      ...current,
      tags: [],
      tagMatch: "all",
      tagStatus: "all"
    }));
  }

  function setScoreFilter(next: ScoreFilter) {
    setSearchFilters((current) => ({ ...current, scoreFilter: next }));
  }

  function selectSort(nextSort: SortMode) {
    setSortCriteriaState((current) =>
      nextSort === "random"
        ? (current ??
          (sort === "random"
            ? undefined
            : [{ field: sort, direction: sortDirection }]))
        : undefined
    );
    setSort(nextSort);
    setSortDirection(defaultSortDirectionForSort(nextSort));
  }

  function setSortCriteria(criteria: SortCriterion[]) {
    const primary = criteria[0];
    if (!primary) return;
    setSortCriteriaState(criteria);
    setSort(primary.field);
    setSortDirection(primary.direction);
  }

  return {
    sortCriteria,
    setSortCriteria,
    tagMatch,
    tagStatus,
    highlightsOnly,
    setHighlightsOnly,
    applyLibraryState,
    aspect,
    clearTagFilters,
    gridSize,
    mediaType,
    isOptionsOpen,
    isSearchOpen,
    setSearchOpen,
    applySearch,
    scoreFilter,
    search,
    setAspect,
    setGridSize,
    setOptionsOpen,
    setScoreFilter,
    setSort: selectSort,
    setView,
    sort,
    sortDirection,
    tagFilters,
    view
  };
}
