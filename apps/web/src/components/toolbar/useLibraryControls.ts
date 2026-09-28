import { useEffect, useMemo, useState } from "react";
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
  writeLibraryStateToUrl,
  type AspectMode,
  type GridSize,
  type LibraryUrlState,
  type ViewMode
} from "../library-state";
import { useTagSuggestions } from "../tags/useTagSuggestions";
import {
  mediaFilters,
  scoreFilters,
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
  const [openControlMenu, setOpenControlMenu] = useState<ControlMenuId | null>(
    null
  );
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
      scoreFilter,
      search,
      tags: tagFilters
    });
  }, [
    aspect,
    gridSize,
    mediaType,
    scoreFilter,
    search,
    selectedFolderId,
    sort,
    sortDirection,
    tagFilters,
    tree,
    view
  ]);

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

  const sortLabel =
    sortOptions.find((option) => option.value === sort)?.label ?? "Date";
  const sortDirectionLabel =
    sortDirectionOptions.find((option) => option.value === sortDirection)
      ?.label ?? "Descending";
  const mediaTypeLabel =
    mediaFilters.find((option) => option.value === mediaType)?.label ?? "All";
  const scoreFilterLabel =
    scoreFilters.find((option) => option.value === scoreFilter)?.label ??
    "All scores";
  const activeFilterLabels: string[] = [];

  if (mediaType !== "all") {
    activeFilterLabels.push(mediaTypeLabel);
  }

  if (scoreFilter !== "all") {
    activeFilterLabels.push(scoreFilterLabel);
  }

  for (const tag of tagFilters) {
    activeFilterLabels.push(`#${tag}`);
  }

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

  function selectSort(nextSort: SortMode) {
    setSort(nextSort);
    setSortDirection(defaultSortDirectionForSort(nextSort));
  }

  return {
    addTagFilter,
    aspect,
    clearTagFilters,
    filterSummary: activeFilterLabels.length
      ? activeFilterLabels.join(" · ")
      : "All media",
    filterTagSuggestions,
    gridSize,
    layoutSummary: `${gridSize} · ${aspect}`,
    mediaType,
    mediaTypeLabel,
    openControlMenu,
    scoreFilter,
    scoreFilterLabel,
    removeTagFilter,
    search,
    searchDraft,
    selectedLabel,
    setAspect,
    setGridSize,
    setMediaType,
    setOpenControlMenu,
    setScoreFilter,
    setSearchDraft,
    setSort: selectSort,
    setSortDirection,
    setTagFilterDraft,
    setView,
    sort,
    sortDirection,
    sortDirectionLabel,
    sortLabel,
    sortSummary:
      sort === "random" ? sortLabel : `${sortLabel} · ${sortDirectionLabel}`,
    tagFilters,
    tagFilterDraft,
    view
  };
}
