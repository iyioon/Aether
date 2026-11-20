import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { toast } from "sonner";
import {
  ApiError,
  getSettings,
  getTrash,
  logout,
  type AssetRecord,
  type LibraryDataResetOptions,
  type FileOperation,
  type FileOperationInput,
  type SortField,
  type SettingsSummary
} from "../api/client";
import { hasOpenKeyboardLayer } from "../lib/keyboard";
import { createUuid } from "../lib/uuid";
import type { GuideTopic } from "./guide/guide-topics";
import type { AppPage, ComparisonWorkspace } from "./app-navigation-state";
import {
  clearAppResumeState,
  readInitialAppLocation,
  readStoredAppLocation,
  resolveAppLocation,
  saveAppLocation,
  writeAppLocationToUrl,
  type SettingsTab
} from "./app-location-state";
import { clearRankingResumeState } from "./compare/ranking-resume-state";
import { clearRandomOrderState } from "./assets/random-order-state";
import { usePageLifecycle } from "../hooks/usePageLifecycle";
import { useLibraryTree } from "./app/useLibraryTree";
import { useViewerFraming } from "./media/useViewerFraming";
import { resolvePlaybackHighlights } from "./settings/playback-settings";
import { useAssetList } from "./assets/useAssetList";
import {
  FileOperationDialog,
  type ManagementTarget
} from "./management/FileOperationDialog";
import type { IncomingMedia, UploadProgress } from "./management/AddMediaPage";
import { useFileOperations } from "./management/useFileOperations";
import { useManagedLibraryRefresh } from "./management/useManagedLibraryRefresh";
import {
  assetIsWritable,
  completedOperationItems,
  folderIsWritable
} from "./management/management-model";
import { BatchActionsBar } from "./batch/BatchActionsBar";
import type { ViewMode } from "./library-state";
import { useBatchSelection } from "./batch/useBatchSelection";
import { useFolderNavigation } from "./folders/useFolderNavigation";
import { isAssetListPending } from "./gallery-loading";
import { useGalleryMetadataFields } from "./gallery/useGalleryMetadataFields";
import { useMeasuredAspectRatios } from "./gallery/useMeasuredAspectRatios";
import { useMediaActions } from "./media/useMediaActions";
import type { AppearanceSettings } from "./settings/useAppearanceSettings";
import { usePlaybackSettings } from "./settings/usePlaybackSettings";
import { LibraryPathBar } from "./sidebar/LibraryPathBar";
import { LibrarySidebar } from "./sidebar/LibrarySidebar";
import { readSidebarDefaultOpen } from "./sidebar/sidebar-state";
import { clearSessionScrollPositions } from "./scroll-restoration";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { Skeleton } from "./ui/skeleton";
import { Button } from "./ui/button";
import { LibraryControlStrip } from "./toolbar/LibraryControlStrip";
import { LibraryResultStatus } from "./toolbar/LibraryResultStatus";
import { LibrarySearchDialog } from "./toolbar/LibrarySearchDialog";
import type { LibrarySearchValues } from "./toolbar/search-state";
import { useLibraryControls } from "./toolbar/useLibraryControls";
import { PresentationContext } from "./media/presentation-context";
import { clearPresentationCapabilities } from "./media/usePresentationCapabilities";
import { clearUploadCheckpoints } from "./management/upload-checkpoints";
import { clearMediaImageCache } from "./media/media-image-cache";
import { animationAtlasCache } from "./media/animation-atlas-cache";
import { PresentationEditorDialog } from "./media/PresentationEditorDialog";
import { resolveFeedFramingAspect } from "./feed/feed-framing";
import type { PresentationSize } from "./media/presentation-geometry";
import {
  buildLibraryMediaEntries,
  findLibraryMediaEntry,
  findLibraryMediaEntryIndex,
  libraryMediaEntryKey,
  libraryMediaSourceId
} from "./media/library-media-entries";
import { mediaFolderLabel } from "./media/media-file-details";
import {
  saveMainHighlight,
  saveHighlightsSeparately
} from "./media/save-highlight-settings";

interface AppShellProps {
  appearance: AppearanceSettings;
  onLogout: (clearResumeAfterUnmount: () => void) => void;
}

const loadComparisonView = () => import("./compare/ComparisonView");
const loadFeedPreview = () => import("./feed/FeedPreview");
const loadGalleryGrid = () => import("./gallery/GalleryGrid");
const loadMediaAnnotationDrawer = () => import("./media/MediaAnnotationDrawer");
const loadMediaViewer = () => import("./media/MediaViewer");
const loadSettingsPage = () => import("./settings/SettingsPage");
const loadAddMediaPage = () => import("./management/AddMediaPage");
const AddMediaPage = lazy(() =>
  loadAddMediaPage().then(({ AddMediaPage }) => ({ default: AddMediaPage }))
);
const loadTrashPage = () => import("./management/TrashPage");
const TrashPage = lazy(() =>
  loadTrashPage().then(({ TrashPage }) => ({ default: TrashPage }))
);
const loadUserGuidePage = () => import("./guide/UserGuidePage");

function preloadGuide() {
  void loadUserGuidePage().catch(() => undefined);
}

function preloadSettings() {
  void loadSettingsPage().catch(() => undefined);
}

function preloadView(view: ViewMode) {
  const request =
    view === "gallery"
      ? loadGalleryGrid()
      : view === "feed"
        ? loadFeedPreview()
        : loadComparisonView();

  void request.catch(() => undefined);
}

const ComparisonView = lazy(() =>
  loadComparisonView().then(({ ComparisonView }) => ({
    default: ComparisonView
  }))
);
const FeedPreview = lazy(() =>
  loadFeedPreview().then(({ FeedPreview }) => ({
    default: FeedPreview
  }))
);
const GalleryGrid = lazy(() =>
  loadGalleryGrid().then(({ GalleryGrid }) => ({
    default: GalleryGrid
  }))
);
const MediaAnnotationDrawer = lazy(() =>
  loadMediaAnnotationDrawer().then(({ MediaAnnotationDrawer }) => ({
    default: MediaAnnotationDrawer
  }))
);
const MediaViewer = lazy(() =>
  loadMediaViewer().then(({ MediaViewer }) => ({
    default: MediaViewer
  }))
);
const SettingsPage = lazy(() =>
  loadSettingsPage().then(({ SettingsPage }) => ({
    default: SettingsPage
  }))
);
const UserGuidePage = lazy(() =>
  loadUserGuidePage().then(({ UserGuidePage }) => ({
    default: UserGuidePage
  }))
);

function WorkspaceLoadingFallback() {
  return (
    <div className="grid gap-4 p-6" aria-label="Loading view" role="status">
      <Skeleton className="h-10 w-full max-w-sm" />
      <Skeleton className="h-48 w-full" />
      <span className="sr-only">Loading view</span>
    </div>
  );
}

export function AppShell({ appearance, onLogout }: AppShellProps) {
  const playbackSettings = usePlaybackSettings();
  const { rememberSound } = playbackSettings;
  const rememberFullViewSound = useCallback(
    (muted: boolean) => rememberSound("fullView", muted),
    [rememberSound]
  );
  const rememberFeedSound = useCallback(
    (muted: boolean) => rememberSound("feed", muted),
    [rememberSound]
  );
  const [initialLocation] = useState(() => {
    const initial = readInitialAppLocation();
    return {
      ...initial,
      library: {
        ...initial.library,
        highlightsOnly:
          initial.library.highlightsOnly ??
          resolvePlaybackHighlights(
            playbackSettings.highlightsMode,
            readStoredAppLocation().library.highlightsOnly ?? false
          )
      }
    };
  });
  const initialLibraryState = initialLocation.library;
  const sidebarDefaultOpen = useMemo(() => readSidebarDefaultOpen(), []);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>(
    initialLocation.navigation.page
  );
  const [comparisonWorkspace, setComparisonWorkspace] =
    useState<ComparisonWorkspace>(
      initialLocation.navigation.comparisonWorkspace
    );
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    initialLocation.navigation.settingsTab
  );
  const [guideTopic, setGuideTopic] = useState<GuideTopic>(
    initialLocation.navigation.guideTopic ?? "browse"
  );
  const pushLocationRef = useRef(false);
  const [settingsSummary, setSettingsSummary] =
    useState<SettingsSummary | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const settingsRequestAbortRef = useRef<AbortController | null>(null);

  const {
    accent,
    accentOptions,
    customAccent,
    setAccent,
    setCustomAccent,
    setTheme,
    theme,
    themeOptions
  } = appearance;
  const {
    aiStatus,
    error,
    handleScan,
    isLoadingTree,
    refreshTree,
    scanProgress,
    scanNotification,
    scanState,
    selectedFolderId,
    setSelectedFolderId,
    tree,
    watchStatus
  } = useLibraryTree({ initialFolderId: initialLibraryState.folderId });

  useEffect(() => {
    if (scanNotification) {
      toast[scanNotification.variant](scanNotification.title, {
        description: scanNotification.description,
        id: `library-scan-${scanNotification.id}`
      });
    }
  }, [scanNotification]);
  const { handleMediaDimensionsKnown, measuredAspectRatios } =
    useMeasuredAspectRatios();
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<{
    assetId: string;
    id: string;
  } | null>(null);
  const [annotationHighlight, setAnnotationHighlight] = useState<{
    assetId: string;
    id: string;
  } | null>(null);
  const [highlightSelection, setHighlightSelection] = useState<{
    assetId: string;
    id: string;
    sourceKey: string | undefined;
    entry?: boolean;
  } | null>(() => {
    const { viewerAssetId, viewerHighlightId } = initialLocation.navigation;
    return viewerAssetId && viewerHighlightId
      ? {
          assetId: viewerAssetId,
          id: viewerHighlightId,
          sourceKey: undefined,
          entry: true
        }
      : null;
  });
  const [isFeedChromeHidden, setIsFeedChromeHidden] = useState(false);
  const [feedViewport, setFeedViewport] = useState<PresentationSize>({
    width: 0,
    height: 0
  });
  const [comparisonAssetUpdate, setComparisonAssetUpdate] =
    useState<AssetRecord | null>(null);
  const rankingChangedRef = useRef(false);
  const activeMediaAnchorIdRef = useRef<string | null>(null);
  const [syncedMediaAnchorId, setSyncedMediaAnchorId] = useState<string | null>(
    null
  );
  const {
    applyLibraryState,
    aspect,
    layout,
    clearTagFilters,
    gridSize,
    highlightsOnly,
    setHighlightsOnly,
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
    setSort,
    setSortCriteria,
    setView,
    sort,
    sortDirection,
    sortCriteria,
    tagMatch,
    tagStatus,
    tagFilters,
    view
  } = useLibraryControls({
    initialState: initialLibraryState
  });
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchOpenRef = useRef(isSearchOpen);
  searchOpenRef.current = isSearchOpen;
  const searchValues: LibrarySearchValues = {
    folderId: selectedFolderId,
    search,
    tags: tagFilters,
    tagMatch,
    tagStatus,
    mediaType,
    scoreFilter
  };
  const hasSearchCriteria = Boolean(
    search ||
    tagFilters.length ||
    tagStatus !== "all" ||
    mediaType !== "all" ||
    scoreFilter !== "all"
  );
  useEffect(() => {
    if (activePage !== "library") setSearchOpen(false);
  }, [activePage, setSearchOpen]);
  const {
    clearFields: clearGalleryMetadataFields,
    fields: galleryMetadataFields,
    resetFields: resetGalleryMetadataFields,
    toggleField: toggleGalleryMetadataField
  } = useGalleryMetadataFields(view);
  const currentViewRef = useRef(view);
  currentViewRef.current = view;
  const hasSortField = (field: SortField) =>
    sort !== "random" &&
    (sortCriteria?.some((criterion) => criterion.field === field) ??
      sort === field);
  const tagsAffectResults =
    tagFilters.length > 0 || tagStatus !== "all" || hasSortField("tags");
  const shouldReloadAfterScoreChange = (input: {
    score?: number;
    favorite?: boolean;
  }) =>
    (input.score !== undefined && hasSortField("score")) ||
    (input.favorite !== undefined &&
      (hasSortField("favorite") || (!sortCriteria && sort === "score"))) ||
    (input.score !== undefined &&
      (scoreFilter === "ranked" || scoreFilter === "unranked")) ||
    (input.favorite !== undefined && scoreFilter === "favorites");
  const {
    assetError,
    assetLoadError,
    assets,
    changedAssetIds,
    unavailableAssetIds,
    outsideScopeAssetIds,
    handleLoadMore,
    hasMoreAssets,
    isLoadingAssets,
    isLoadingMore,
    isResultsPending,
    listQueryKey,
    loadedQueryKey,
    loadMoreRef,
    markResultsPending,
    markAssetsUnavailable,
    mergeUpdatedAssets,
    reconcileManagedAssets,
    reloadAssets,
    removeAssets,
    setAssetError,
    updateAssetTags
  } = useAssetList({
    folderId: selectedFolderId,
    mediaType,
    scoreFilter,
    search,
    sort,
    sortDirection,
    sortCriteria,
    tagMatch,
    tagStatus,
    tagFilters,
    tree
  });
  const isAssetContentPending = isAssetListPending({
    folderId: selectedFolderId,
    hasTree: tree !== null,
    isLoadingAssets,
    isLoadingTree,
    listQueryKey,
    loadedQueryKey
  });
  const libraryEntries = useMemo(
    () => buildLibraryMediaEntries(assets),
    [assets]
  );
  const hasLibraryError = Boolean(assetError || assetLoadError);
  const {
    batchError,
    batchStatus,
    batchTagDraft,
    batchTagSuggestions,
    clearSelectedAssets,
    isSelectionMode,
    isSavingBatch,
    saveBatchScore,
    saveBatchTags,
    selectLoadedAssets,
    selectedAssetIds,
    setBatchTagDraft,
    setIsSelectionMode,
    toggleAssetSelection
  } = useBatchSelection({
    assets,
    listQueryKey,
    onAssetsUpdated: mergeUpdatedAssets,
    onReloadAssets: markResultsPending,
    shouldReloadAfterTagChange: tagsAffectResults,
    shouldReloadAfterScoreChange
  });

  useEffect(() => {
    if (batchStatus) {
      toast.success(batchStatus, {
        id: "batch-action-status"
      });
    }
  }, [batchStatus]);

  function mergeMediaActionAssets(updatedAssets: AssetRecord[]) {
    mergeUpdatedAssets(updatedAssets);

    const latestUpdatedAsset = updatedAssets.at(-1);
    if (latestUpdatedAsset) {
      setComparisonAssetUpdate(latestUpdatedAsset);
    }
  }

  function handleComparisonRankingChanged() {
    rankingChangedRef.current = true;

    if (currentViewRef.current !== "compare") {
      rankingChangedRef.current = false;
      reloadAssets();
    }
  }

  const handleMediaActionError = useCallback((message: string | null) => {
    if (message) {
      toast.error("Media update failed", {
        description: message,
        id: "media-action-status"
      });
    }
  }, []);

  const {
    annotationAsset,
    handleAssetTagsUpdated,
    handleAssetUpdated,
    handleAssetsUnavailable,
    handleAssetsUpdated,
    hasNextViewerAsset,
    hasPreviousViewerAsset,
    openAssetFullscreen,
    saveAssetScore,
    savingScoreAssetIds,
    selectAdjacentAsset,
    selectedAsset,
    selectedAssetId,
    setAnnotationAssetId,
    setSelectedAssetId
  } = useMediaActions({
    initialSelectedAssetId: initialLocation.navigation.viewerAssetId,
    assets,
    onAssetError: handleMediaActionError,
    onAssetsUpdated: mergeMediaActionAssets,
    onAssetTagsUpdated: (id, tags) => {
      updateAssetTags(id, tags);
      if (tagsAffectResults) markResultsPending();
    },
    onReloadAssets: markResultsPending,
    shouldReloadAfterScoreChange
  });
  const selectedSourceKey = selectedAsset?.presentation?.renditionKeys.full;
  useEffect(() => {
    setHighlightSelection((current) =>
      current &&
      (current.assetId !== selectedAssetId ||
        (selectedSourceKey !== undefined &&
          current.sourceKey !== undefined &&
          current.sourceKey !== selectedSourceKey))
        ? null
        : current
    );
  }, [selectedAssetId, selectedSourceKey]);
  const selectedHighlightId =
    highlightSelection?.assetId === selectedAssetId &&
    (highlightSelection.sourceKey === undefined ||
      highlightSelection.sourceKey === selectedSourceKey)
      ? highlightSelection.id
      : null;
  const annotationHighlightId =
    annotationAsset?.id === selectedAssetId && selectedHighlightId
      ? selectedHighlightId
      : annotationHighlight?.assetId === annotationAsset?.id
        ? (annotationHighlight?.id ?? null)
        : null;
  const requestedViewerEntryKey = selectedAssetId
    ? libraryMediaEntryKey(selectedAssetId, selectedHighlightId)
    : null;
  const viewerEntryIndex = findLibraryMediaEntryIndex(
    libraryEntries,
    requestedViewerEntryKey
  );
  const usesEntryNavigation = view !== "compare" && viewerEntryIndex >= 0;
  const viewerAnchorKey = selectedAssetId
    ? selectedAsset?.presentation?.separateHighlights
      ? (findLibraryMediaEntry(libraryEntries, requestedViewerEntryKey)
          ?.entryKey ?? selectedAssetId)
      : selectedAssetId
    : null;
  useEffect(() => {
    setHighlightSelection((current) => {
      if (
        !current ||
        current.assetId !== selectedAsset?.id ||
        !selectedAsset.presentation
      )
        return current;
      const existing = selectedAsset.presentation.highlights?.some(
        ({ id }) => id === current.id
      );
      if (!existing) {
        const fallback = findLibraryMediaEntry(
          libraryEntries,
          libraryMediaEntryKey(current.assetId, current.id)
        );
        return current.entry && fallback?.highlightId
          ? {
              ...current,
              id: fallback.highlightId,
              sourceKey: selectedSourceKey
            }
          : null;
      }
      return current.sourceKey === undefined && selectedSourceKey !== undefined
        ? { ...current, sourceKey: selectedSourceKey }
        : current;
    });
  }, [selectedAsset, selectedSourceKey, libraryEntries]);
  const { viewerUsesSavedFraming, setViewerUsesSavedFraming } =
    useViewerFraming({
      mode: playbackSettings.framingMode,
      isOpen: selectedAssetId !== null
    });
  const previousHighlightsMode = useRef(playbackSettings.highlightsMode);
  useEffect(() => {
    const mode = playbackSettings.highlightsMode;
    if (previousHighlightsMode.current === mode) return;
    previousHighlightsMode.current = mode;
    if (mode !== "remember")
      setHighlightsOnly(resolvePlaybackHighlights(mode, false));
  }, [playbackSettings.highlightsMode, setHighlightsOnly]);

  const location = useMemo(
    () => ({
      library: {
        folderId: selectedFolderId,
        view,
        gridSize,
        aspect: layout,
        sort,
        sortDirection,
        ...(sortCriteria ? { sortCriteria } : {}),
        ...(tagMatch !== "all" ? { tagMatch } : {}),
        ...(tagStatus !== "all" ? { tagStatus } : {}),
        mediaType,
        scoreFilter,
        search,
        tags: tagFilters,
        highlightsOnly
      },
      navigation: {
        page: activePage,
        comparisonWorkspace,
        settingsTab,
        guideTopic,
        viewerAssetId: selectedAssetId,
        viewerHighlightId: highlightSelection?.entry
          ? selectedHighlightId
          : null
      }
    }),
    [
      selectedFolderId,
      view,
      gridSize,
      layout,
      sort,
      sortDirection,
      sortCriteria,
      tagMatch,
      tagStatus,
      mediaType,
      scoreFilter,
      search,
      tagFilters,
      highlightsOnly,
      activePage,
      comparisonWorkspace,
      settingsTab,
      guideTopic,
      selectedAssetId,
      highlightSelection?.entry,
      selectedHighlightId
    ]
  );
  useEffect(() => {
    if (!tree) return;
    saveAppLocation(location);
    writeAppLocationToUrl(location, pushLocationRef.current);
    pushLocationRef.current = false;
  }, [location, tree]);
  usePageLifecycle({
    onHidden: () => {
      if (tree) saveAppLocation(location);
    },
    onResume: () => {
      void refreshTree().catch(() => undefined);
    }
  });
  useEffect(() => {
    const restore = () => {
      const next = resolveAppLocation(window.location.search, location);
      pushLocationRef.current = false;
      setIsMobileSidebarOpen(false);
      setActivePage(next.navigation.page);
      setComparisonWorkspace(next.navigation.comparisonWorkspace);
      setSettingsTab(next.navigation.settingsTab);
      setGuideTopic(next.navigation.guideTopic ?? "browse");
      setSelectedFolderId(next.library.folderId);
      applyLibraryState({
        ...next.library,
        highlightsOnly:
          next.library.highlightsOnly ??
          resolvePlaybackHighlights(
            playbackSettings.highlightsMode,
            highlightsOnly
          )
      });
      setSelectedAssetId(next.navigation.viewerAssetId);
      setHighlightSelection(
        next.navigation.viewerAssetId && next.navigation.viewerHighlightId
          ? {
              assetId: next.navigation.viewerAssetId,
              id: next.navigation.viewerHighlightId,
              sourceKey: undefined,
              entry: true
            }
          : null
      );
      setAnnotationAssetId(null);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [
    applyLibraryState,
    highlightsOnly,
    playbackSettings.highlightsMode,
    location,
    setAnnotationAssetId,
    setSelectedAssetId,
    setSelectedFolderId
  ]);
  useEffect(() => {
    if (viewerAnchorKey) {
      activeMediaAnchorIdRef.current = viewerAnchorKey;
      setSyncedMediaAnchorId(viewerAnchorKey);
      void loadMediaAnnotationDrawer().catch(() => undefined);
    }
  }, [viewerAnchorKey]);

  useEffect(() => {
    activeMediaAnchorIdRef.current = null;
    setSyncedMediaAnchorId(null);
  }, [listQueryKey]);
  const selectFolder = useCallback(
    (folderId: string) => {
      setIsMobileSidebarOpen(false);
      setActivePage("library");
      setSelectedFolderId(folderId);
      setOptionsOpen(false);
      setAnnotationAssetId(null);
      if (view === "feed") {
        setIsFeedChromeHidden(false);
      }
    },
    [setAnnotationAssetId, setOptionsOpen, setSelectedFolderId, view]
  );
  const {
    collapseAllFolders,
    expandableFolderIds,
    expandedFolderCount,
    expandedFolderIds,
    expandAllFolders,
    folderSortMode,
    handleFolderTreeKeyDown,
    setFolderSortMode,
    treeTabStopId,
    toggleFolderExpansion,
    visibleFolderItems
  } = useFolderNavigation({
    selectedFolderId,
    tree,
    onSelectFolder: selectFolder
  });

  const [managementTarget, setManagementTarget] =
    useState<ManagementTarget | null>(null);
  const activityOpen = activePage === "activity";
  const [hasOpenedAddMedia, setHasOpenedAddMedia] = useState(
    ["add-media", "activity"].includes(initialLocation.navigation.page)
  );
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [incomingMedia, setIncomingMedia] = useState<IncomingMedia | null>(
    null
  );
  useEffect(() => {
    if (activityOpen || activePage === "add-media") setHasOpenedAddMedia(true);
  }, [activityOpen, activePage]);
  useEffect(() => {
    const dragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      const hasDirectory = Array.from(event.dataTransfer.items).some(
        (item) => item.webkitGetAsEntry?.()?.isDirectory
      );
      setIncomingMedia({
        id: Date.now(),
        files: hasDirectory ? [] : Array.from(event.dataTransfer.files),
        ...(hasDirectory
          ? {
              error:
                "Choose individual files. Folder uploads are not supported."
            }
          : {})
      });
      setIsSelectionMode(false);
      clearSelectedAssets();
      setHasOpenedAddMedia(true);
      pushLocationRef.current = true;
      setIsMobileSidebarOpen(false);
      setActivePage("add-media");
      setAnnotationAssetId(null);
      setSelectedAssetId(null);
    };
    window.addEventListener("dragover", dragOver);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop);
    };
  }, [
    clearSelectedAssets,
    setAnnotationAssetId,
    setSelectedAssetId,
    setIsSelectionMode
  ]);
  const writableAssetIds = useMemo(
    () =>
      new Set(
        assets
          .filter((asset) => assetIsWritable(tree, asset))
          .map((asset) => asset.id)
      ),
    [assets, tree]
  );
  const undoTrashRequestsRef = useRef(new Map<string, FileOperationInput>());
  const undoTrashInFlightRef = useRef(new Map<string, number>());
  const managedRemovalIdsRef = useRef(new Set<string>());
  const managementSessionRef = useRef(0);
  const managementRefreshFailedRef = useRef(false);
  const applyManagedResultsRef = useRef(false);
  const {
    scheduleRefresh: scheduleManagedRefresh,
    canRefresh: canApplyManagedRefresh
  } = useManagedLibraryRefresh({
    isBusy:
      isSelectionMode ||
      isSavingBatch ||
      Boolean(editingAsset || managementTarget || annotationAsset) ||
      savingScoreAssetIds.size > 0,
    refreshTree,
    onRefresh: () => {
      managementRefreshFailedRef.current = false;
      if (applyManagedResultsRef.current) {
        applyManagedResultsRef.current = false;
        reloadAssets();
      } else {
        reconcileManagedAssets(scheduleManagedRefresh, canApplyManagedRefresh);
      }
    },
    onError: () => {
      managementRefreshFailedRef.current = true;
      setAssetError(
        "The operation completed, but the library could not refresh. Try Update results."
      );
      markResultsPending(false);
    }
  });
  function updateResults() {
    if (managementRefreshFailedRef.current) {
      applyManagedResultsRef.current = true;
      scheduleManagedRefresh();
    } else reloadAssets();
  }
  useEffect(
    () => () => {
      managementSessionRef.current += 1;
    },
    []
  );
  async function undoTrash(operation: FileOperation) {
    const session = managementSessionRef.current;
    if (undoTrashInFlightRef.current.get(operation.id) === session) return;
    undoTrashInFlightRef.current.set(operation.id, session);
    try {
      let input = undoTrashRequestsRef.current.get(operation.id);
      if (!input) {
        const result = await getTrash();
        if (session !== managementSessionRef.current) return;
        const wanted = new Set(
          completedOperationItems(operation).map((item) => item.trashId)
        );
        const records = result.items.filter((item) => wanted.has(item.id));
        if (records.length !== wanted.size) {
          openActivity();
          return;
        }
        input = {
          requestId: createUuid(),
          type: "restore",
          items: records.map((item) => ({
            trashId: item.id,
            expectedVersion: item.sourceVersion
          }))
        };
        undoTrashRequestsRef.current.set(operation.id, input);
      }
      await fileOperations.submit(input);
      if (session === managementSessionRef.current)
        toast.dismiss(`undo-trash-${operation.id}`);
    } catch (error) {
      if (
        session !== managementSessionRef.current ||
        (error instanceof ApiError && error.status === 401)
      )
        return;
      toast.error("Restore could not be confirmed", {
        id: `undo-trash-${operation.id}`,
        action: {
          label: "Retry",
          onClick: (event) => {
            event.preventDefault();
            if (session === managementSessionRef.current)
              void undoTrash(operation);
          }
        }
      });
    } finally {
      if (undoTrashInFlightRef.current.get(operation.id) === session)
        undoTrashInFlightRef.current.delete(operation.id);
    }
  }
  const fileOperations = useFileOperations(
    (operation: FileOperation) => {
      const completed = completedOperationItems(operation);
      const updated = completed.flatMap((item) =>
        item.asset ? [item.asset] : []
      );
      if (updated.length) handleAssetsUpdated(updated);
      if (operation.type === "trash" || operation.type === "purge") {
        const ids = completed.flatMap((item) =>
          item.assetId ? [item.assetId] : []
        );
        for (const id of ids) managedRemovalIdsRef.current.add(id);
        handleAssetsUnavailable(ids);
        markAssetsUnavailable(ids);
      }
      scheduleManagedRefresh();
    },
    openActivity,
    (operation) => void undoTrash(operation)
  );
  function manageAsset(
    asset: AssetRecord,
    type: "rename-media" | "move-media" | "trash"
  ) {
    setManagementTarget({ type, assets: [asset] });
  }
  const selectedFolderWritable = folderIsWritable(tree, selectedFolderId);
  const selectedFolderIsRoot =
    tree?.roots.some((root) => root.folderId === selectedFolderId) ?? true;

  useEffect(() => {
    const loadedIds = new Set(assets.map((asset) => asset.id));
    const unavailableIds = new Set(
      assets.filter((asset) => asset.unavailable).map((asset) => asset.id)
    );
    for (const id of managedRemovalIdsRef.current)
      if (!unavailableIds.has(id)) managedRemovalIdsRef.current.delete(id);
    const unavailable = unavailableAssetIds.filter((id) => loadedIds.has(id));
    const ids = [...new Set([...unavailable, ...outsideScopeAssetIds])].filter(
      (id) => loadedIds.has(id) && !managedRemovalIdsRef.current.has(id)
    );
    if (
      editingAsset &&
      unavailable.includes(editingAsset.id) &&
      !editingAsset.unavailable
    )
      setEditingAsset({ ...editingAsset, unavailable: true });
    handleAssetsUnavailable(unavailable);
    if (!ids.length) return;
    let frame = 0;
    const removeWhenReady = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (
          isSelectionMode ||
          isSavingBatch ||
          editingAsset ||
          managementTarget ||
          savingScoreAssetIds.size ||
          hasOpenKeyboardLayer(document) ||
          document.querySelector(".score-control [data-pressing]") ||
          (document.activeElement instanceof Element &&
            document.activeElement.closest(".score-control"))
        )
          return;
        handleAssetsUnavailable(unavailable);
        removeAssets(ids);
      });
    };
    removeWhenReady();
    const observer = new MutationObserver(removeWhenReady);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pointerup", removeWhenReady);
    window.addEventListener("focusout", removeWhenReady);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointerup", removeWhenReady);
      window.removeEventListener("focusout", removeWhenReady);
    };
  }, [
    assets,
    unavailableAssetIds,
    outsideScopeAssetIds,
    isSelectionMode,
    isSavingBatch,
    editingAsset,
    managementTarget,
    savingScoreAssetIds,
    handleAssetsUnavailable,
    removeAssets
  ]);

  function closeSelectionMode() {
    setIsSelectionMode(false);
    clearSelectedAssets();
  }

  function setSelectionMode(nextIsSelectionMode: boolean) {
    if (nextIsSelectionMode && loadedQueryKey !== listQueryKey) return;
    if (nextIsSelectionMode) {
      setIsSelectionMode(true);
      return;
    }

    closeSelectionMode();
  }

  function switchView(nextView: ViewMode) {
    pushLocationRef.current = true;
    setIsMobileSidebarOpen(false);
    setActivePage("library");
    setSyncedMediaAnchorId(activeMediaAnchorIdRef.current);
    setView(nextView);
    if (isResultsPending) reloadAssets();
    closeSelectionMode();
    setOptionsOpen(false);
    setAnnotationAssetId(null);
    setIsFeedChromeHidden(false);
    if (
      view === "compare" &&
      nextView !== "compare" &&
      rankingChangedRef.current
    ) {
      rankingChangedRef.current = false;
      reloadAssets();
    }
  }

  function openAnchoredAsset(entryKey: string, pushHistory = true) {
    const entry = findLibraryMediaEntry(libraryEntries, entryKey);
    const assetId = entry?.id ?? libraryMediaSourceId(entryKey);
    setHighlightSelection(
      entry?.highlightId
        ? {
            assetId,
            id: entry.highlightId,
            sourceKey: entry.source.presentation?.renditionKeys.full,
            entry: true
          }
        : null
    );
    pushLocationRef.current = pushHistory;
    activeMediaAnchorIdRef.current = entry?.entryKey ?? assetId;
    setSyncedMediaAnchorId(entry?.entryKey ?? assetId);
    openAssetFullscreen(entry?.source ?? assetId);
  }

  function openComparisonAsset(asset: AssetRecord) {
    setHighlightSelection(null);
    pushLocationRef.current = true;
    activeMediaAnchorIdRef.current = asset.id;
    setSyncedMediaAnchorId(asset.id);
    openAssetFullscreen(asset);
  }

  function closeAnchoredAsset() {
    setHighlightSelection(null);
    if (viewerAnchorKey) {
      activeMediaAnchorIdRef.current = viewerAnchorKey;
      setSyncedMediaAnchorId(viewerAnchorKey);
    }

    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function trackActiveMedia(assetId: string) {
    activeMediaAnchorIdRef.current = assetId;
  }

  function openAnnotations(assetId: string, entryKey?: string) {
    const entry = findLibraryMediaEntry(libraryEntries, entryKey);
    setAnnotationHighlight(
      entry?.highlightId ? { assetId, id: entry.highlightId } : null
    );
    setAnnotationAssetId(assetId);
  }

  function editMedia(asset: AssetRecord, highlightId?: string | null) {
    const id =
      highlightId ??
      (asset.id === selectedAssetId ? selectedHighlightId : null);
    setEditingHighlight(id ? { assetId: asset.id, id } : null);
    setEditingAsset(asset);
  }

  function framingAspectForMedia(
    asset: AssetRecord,
    highlightId?: string | null
  ) {
    return view === "feed" && layout === "Fill screen"
      ? resolveFeedFramingAspect(asset, feedViewport, highlightId)
      : aspect;
  }

  function selectViewerEntry(direction: -1 | 1) {
    if (usesEntryNavigation) {
      const entry = libraryEntries[viewerEntryIndex + direction];
      if (entry) openAnchoredAsset(entry.entryKey, false);
    } else {
      setHighlightSelection(null);
      selectAdjacentAsset(direction);
    }
  }

  function setFeedChromeVisibility(isHidden: boolean) {
    setIsFeedChromeHidden(isHidden);
  }

  const refreshSettingsSummary = useCallback(async () => {
    settingsRequestAbortRef.current?.abort();
    const controller = new AbortController();
    settingsRequestAbortRef.current = controller;
    setIsLoadingSettings(true);
    setSettingsError(null);

    try {
      const nextSettings = await getSettings(controller.signal);

      if (!controller.signal.aborted) {
        setSettingsSummary(nextSettings);
      }
    } catch {
      if (!controller.signal.aborted) {
        setSettingsError("Settings could not be loaded.");
      }
    } finally {
      if (settingsRequestAbortRef.current === controller) {
        settingsRequestAbortRef.current = null;
        setIsLoadingSettings(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activePage === "settings") {
      void refreshSettingsSummary();
    }
  }, [activePage, refreshSettingsSummary]);

  useEffect(
    () => () => {
      settingsRequestAbortRef.current?.abort();
    },
    []
  );

  function openSettings() {
    pushLocationRef.current = true;
    setIsMobileSidebarOpen(false);
    setActivePage("settings");
    closeSelectionMode();
    setOptionsOpen(false);
    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function openGuide() {
    pushLocationRef.current = true;
    setIsMobileSidebarOpen(false);
    setActivePage("guide");
    closeSelectionMode();
    setOptionsOpen(false);
    setAnnotationAssetId(null);
  }

  function openActivity() {
    pushLocationRef.current = true;
    setIsMobileSidebarOpen(false);
    setHasOpenedAddMedia(true);
    setActivePage("activity");
    closeSelectionMode();
    setOptionsOpen(false);
    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function openAddMedia() {
    pushLocationRef.current = true;
    setIsMobileSidebarOpen(false);
    setHasOpenedAddMedia(true);
    setActivePage("add-media");
    closeSelectionMode();
    setOptionsOpen(false);
    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function focusLibraryControls() {
    window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        focused !== document.body &&
        focused.getClientRects().length > 0 &&
        !focused.closest('[inert], [aria-hidden="true"]') &&
        window.getComputedStyle(focused).visibility !== "hidden"
      )
        return;
      const control = [
        document.querySelector<HTMLElement>(
          '.control-strip button[aria-label="Add media"]'
        ),
        document.querySelector<HTMLElement>(
          '.library-path-navigation [data-slot="sidebar-trigger"]'
        ),
        document.querySelector<HTMLElement>(".feed-shell[tabindex]")
      ].find(
        (candidate) =>
          candidate &&
          !candidate.closest('[inert], [aria-hidden="true"]') &&
          !candidate.matches(":disabled") &&
          candidate.getClientRects().length > 0 &&
          window.getComputedStyle(candidate).visibility !== "hidden"
      );
      control?.focus({ preventScroll: true });
    });
  }

  function backToLibrary() {
    pushLocationRef.current = true;
    setIsMobileSidebarOpen(false);
    setActivePage("library");
  }

  function openSearch() {
    setIsMobileSidebarOpen(false);
    setIsFeedChromeHidden(false);
    setOptionsOpen(false);
    setSearchOpen(true);
  }

  function submitSearch(values: LibrarySearchValues) {
    if (
      values.folderId &&
      !tree?.roots.some((root) => root.folderId === values.folderId) &&
      !tree?.folders.some((folder) => folder.id === values.folderId)
    )
      return;
    pushLocationRef.current = true;
    closeSelectionMode();
    setSelectedFolderId(values.folderId);
    applySearch(values);
  }

  function restoreSearchFocus(event: Event) {
    event.preventDefault();
    if (searchOpenRef.current) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !active.closest(".library-search-dialog") &&
      !active.closest('[inert], [aria-hidden="true"]') &&
      active.getClientRects().length > 0
    )
      return;
    searchTriggerRef.current?.focus({ preventScroll: true });
  }

  async function handleLogout() {
    const clearResume = () => {
      clearSessionScrollPositions();
      clearRankingResumeState();
      clearRandomOrderState();
      clearAppResumeState();
      clearPresentationCapabilities();
      clearMediaImageCache();
      clearUploadCheckpoints();
      animationAtlasCache.clear();
    };
    try {
      await logout();
      onLogout(clearResume);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onLogout(clearResume);
        return;
      }

      toast.error("Could not sign out", {
        description: "The server could not be reached. Please try again.",
        id: "logout-status"
      });
    }
  }

  const selectedAssets = assets.filter((asset) =>
    selectedAssetIds.has(asset.id)
  );
  const availableAssetCount = assets.filter(
    (asset) => !asset.unavailable
  ).length;
  const canUpdateResults =
    !isSelectionMode &&
    savingScoreAssetIds.size === 0 &&
    !isSavingBatch &&
    !editingAsset &&
    !annotationAsset &&
    !managementTarget &&
    !isLoadingAssets;
  const libraryStatus =
    activePage === "library" && !assetLoadError ? (
      <LibraryResultStatus
        loadedAssetCount={assets.length}
        isResultsPending={isResultsPending}
        canUpdateResults={canUpdateResults}
        onUpdateResults={updateResults}
      />
    ) : null;
  const libraryControls =
    activePage === "library" ? (
      <LibraryControlStrip
        aspect={layout}
        galleryMetadataFields={galleryMetadataFields}
        gridSize={gridSize}
        highlightsOnly={highlightsOnly}
        onHighlightsOnlyChange={setHighlightsOnly}
        isSelectionMode={isSelectionMode}
        loadedAssetCount={
          loadedQueryKey === listQueryKey ? availableAssetCount : 0
        }
        onAddMedia={openAddMedia}
        isOpen={isOptionsOpen}
        sort={sort}
        sortDirection={sortDirection}
        sortCriteria={sortCriteria}
        onSetSortCriteria={setSortCriteria}
        view={view}
        onClearGalleryMetadataFields={clearGalleryMetadataFields}
        onResetGalleryMetadataFields={resetGalleryMetadataFields}
        onSetSelectionMode={setSelectionMode}
        onSetAspect={setAspect}
        onSetGridSize={setGridSize}
        onOpenChange={setOptionsOpen}
        onSetSort={setSort}
        onToggleGalleryMetadataField={toggleGalleryMetadataField}
      />
    ) : null;

  const presentationPreferences = useMemo(
    () => ({
      highlightsOnly,
      isPlaybackPaused: editingAsset !== null || managementTarget !== null
    }),
    [highlightsOnly, editingAsset, managementTarget]
  );
  useEffect(() => {
    setEditingAsset(null);
  }, [activePage, view, selectedFolderId, listQueryKey]);
  useEffect(() => {
    setEditingAsset((current) => (current?.unavailable ? current : null));
  }, [selectedAssetId]);

  return (
    <PresentationContext.Provider value={presentationPreferences}>
      <SidebarProvider
        className="app-shell"
        defaultOpen={sidebarDefaultOpen}
        openMobile={isMobileSidebarOpen}
        onOpenMobileChange={setIsMobileSidebarOpen}
      >
        <LibrarySidebar
          error={error}
          expandableFolderIds={expandableFolderIds}
          expandedFolderCount={expandedFolderCount}
          expandedFolderIds={expandedFolderIds}
          folderSortMode={folderSortMode}
          isLoadingTree={isLoadingTree}
          isGuideOpen={activePage === "guide"}
          isSettingsOpen={activePage === "settings"}
          isTrashOpen={activePage === "trash"}
          items={tree?.roots.length ? visibleFolderItems : []}
          scanProgress={scanProgress}
          scanState={scanState}
          selectedFolderId={selectedFolderId}
          treeTabStopId={treeTabStopId}
          watchStatus={watchStatus}
          onCollapseAll={collapseAllFolders}
          onExpandAll={expandAllFolders}
          onFolderKeyDown={handleFolderTreeKeyDown}
          onFolderSortChange={setFolderSortMode}
          onLogout={() => void handleLogout()}
          onOpenGuide={openGuide}
          onOpenSettings={openSettings}
          onPreloadGuide={preloadGuide}
          onPreloadSettings={preloadSettings}
          onScan={() =>
            void handleScan().then(() => {
              if (isSelectionMode) markResultsPending();
              else reloadAssets();
            })
          }
          canCreateFolder={selectedFolderWritable}
          canManageFolder={selectedFolderWritable && !selectedFolderIsRoot}
          onFolderAction={(type, folderId) => {
            const targetFolderId = folderId ?? selectedFolderId;
            if (targetFolderId)
              setManagementTarget({ type, folderId: targetFolderId });
          }}
          activityCount={
            fileOperations.operations.filter((operation) =>
              ["queued", "running", "needs_attention"].includes(
                operation.status
              )
            ).length +
            uploadProgress.filter((upload) =>
              ["queued", "uploading", "paused", "checking", "error"].includes(
                upload.state
              )
            ).length
          }
          isActivityOpen={activityOpen}
          onOpenActivity={openActivity}
          onOpenTrash={() => {
            pushLocationRef.current = true;
            setIsMobileSidebarOpen(false);
            setActivePage("trash");
            closeSelectionMode();
            setAnnotationAssetId(null);
            setSelectedAssetId(null);
          }}
          onSelectFolder={selectFolder}
          onToggleFolderExpansion={toggleFolderExpansion}
        />
        <SidebarInset
          className={`library-inset${hasLibraryError ? " has-library-error" : ""}`}
        >
          <LibraryPathBar
            controls={libraryControls}
            status={libraryStatus}
            isFeedChromeHidden={
              isFeedChromeHidden && assets.length > 0 && !hasLibraryError
            }
            isGuideOpen={activePage === "guide"}
            isSettingsOpen={activePage === "settings"}
            isTrashOpen={activePage === "trash"}
            isActivityOpen={activityOpen}
            isAddMediaOpen={activePage === "add-media"}
            hasSearchCriteria={hasSearchCriteria}
            isSearchOpen={isSearchOpen}
            searchTriggerRef={searchTriggerRef}
            selectedFolderId={selectedFolderId}
            tree={tree}
            view={view}
            onBackToLibrary={backToLibrary}
            onOpenSearch={openSearch}
            onSelectFolder={selectFolder}
            onPreloadView={preloadView}
            onSwitchView={switchView}
          />
          <main
            className={[
              "library-main",
              isSelectionMode ? "has-selection" : "",
              activePage === "add-media"
                ? "view-add-media"
                : activePage === "settings"
                  ? "view-settings"
                  : activePage === "guide"
                    ? "view-guide"
                    : activePage === "trash"
                      ? "view-trash"
                      : activityOpen
                        ? "view-activity"
                        : view === "feed"
                          ? "view-feed"
                          : view === "compare"
                            ? "view-compare"
                            : "view-gallery"
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {hasOpenedAddMedia || activePage === "add-media" || activityOpen ? (
              <Suspense
                fallback={
                  activePage === "add-media" || activityOpen ? (
                    <WorkspaceLoadingFallback />
                  ) : null
                }
              >
                <AddMediaPage
                  tree={tree}
                  isLoadingFolders={isLoadingTree}
                  onRefreshFolders={refreshTree}
                  open={activePage === "add-media"}
                  activityOpen={activityOpen}
                  incomingMedia={incomingMedia}
                  operations={fileOperations.operations}
                  onRefresh={fileOperations.refresh}
                  onSubmit={fileOperations.submit}
                  onTransfers={setUploadProgress}
                  onBatchStarted={fileOperations.trackUploadBatch}
                  onUploadCancelled={fileOperations.settleUpload}
                  selectedFolderId={selectedFolderId}
                  onClose={() => {
                    backToLibrary();
                    focusLibraryControls();
                  }}
                  onAdded={(skipped) => {
                    openActivity();
                    if (skipped)
                      toast.info(
                        `${skipped} ${skipped === 1 ? "file" : "files"} skipped.`
                      );
                  }}
                  onOperation={fileOperations.accept}
                />
              </Suspense>
            ) : null}
            <Suspense fallback={<WorkspaceLoadingFallback />}>
              {activePage === "add-media" ||
              activityOpen ? null : activePage === "settings" ? (
                <SettingsPage
                  playback={playbackSettings}
                  tab={settingsTab}
                  onTabChange={setSettingsTab}
                  accent={accent}
                  accentOptions={accentOptions}
                  customAccent={customAccent}
                  isLoading={isLoadingSettings}
                  settings={settingsSummary}
                  mediaRoots={tree?.roots ?? []}
                  settingsError={settingsError}
                  onSetAccent={setAccent}
                  onSetCustomAccent={setCustomAccent}
                  onSetTheme={setTheme}
                  onRefreshSettings={() => void refreshSettingsSummary()}
                  onDataReset={(_result, options: LibraryDataResetOptions) => {
                    void refreshSettingsSummary();
                    if (
                      options.scores ||
                      options.favorites ||
                      options.tags ||
                      options.comparisons
                    )
                      clearSessionScrollPositions();
                    if (
                      options.presentationPlayback ||
                      options.presentationFraming
                    ) {
                      clearPresentationCapabilities();
                      setEditingAsset(null);
                    }
                    if (options.comparisons || options.scores)
                      clearRankingResumeState();
                    if (options.tags) {
                      clearTagFilters();
                    }
                    if (
                      options.scores ||
                      options.favorites ||
                      options.comparisons
                    ) {
                      setScoreFilter("all");
                    }
                    if (options.scores || options.comparisons) {
                      rankingChangedRef.current = true;
                    }
                    reloadAssets();
                  }}
                  theme={theme}
                  themeOptions={themeOptions}
                />
              ) : activePage === "guide" ? (
                <UserGuidePage
                  topic={guideTopic}
                  onTopicChange={setGuideTopic}
                />
              ) : activePage === "trash" ? (
                <TrashPage
                  roots={tree?.roots ?? []}
                  operations={fileOperations.operations}
                  onRefreshOperations={fileOperations.refresh}
                  onOpenActivity={openActivity}
                  revision={fileOperations.operations[0]?.revision}
                  onManage={setManagementTarget}
                  onEmptyTrash={fileOperations.submitEmptyTrash}
                />
              ) : (
                <>
                  {isSelectionMode ? (
                    <BatchActionsBar
                      isOpen
                      loadedCount={availableAssetCount}
                      selectedAssets={selectedAssets}
                      fileActionsDisabledReason={
                        selectedAssets.some((asset) =>
                          assetIsWritable(tree, asset)
                        )
                          ? undefined
                          : "File changes are unavailable for this selection."
                      }
                      tagDraft={batchTagDraft}
                      tagSuggestions={batchTagSuggestions}
                      isSaving={isSavingBatch}
                      error={batchError}
                      onClear={clearSelectedAssets}
                      onClose={closeSelectionMode}
                      onApplyCuration={saveBatchScore}
                      onApplyTags={saveBatchTags}
                      onTagDraftChange={setBatchTagDraft}
                      onSelectLoaded={() => {
                        if (loadedQueryKey === listQueryKey)
                          selectLoadedAssets();
                      }}
                      onMove={() =>
                        setManagementTarget({
                          type: "move-media",
                          assets: selectedAssets
                        })
                      }
                      onTrash={() =>
                        setManagementTarget({
                          type: "trash",
                          assets: selectedAssets
                        })
                      }
                      onRename={(asset) => manageAsset(asset, "rename-media")}
                    />
                  ) : null}

                  {assetError ? (
                    <div className="inline-error" role="alert">
                      {assetError}
                    </div>
                  ) : null}

                  {assetLoadError && view !== "compare" ? (
                    <div
                      className={`inline-error library-load-error${loadedQueryKey !== listQueryKey ? " library-load-error-empty" : ""}`}
                      role="alert"
                    >
                      <span>{assetLoadError.message}</span>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          assetLoadError.retry === "reload" && !canUpdateResults
                        }
                        title={
                          assetLoadError.retry === "reload" && !canUpdateResults
                            ? "Finish editing or selecting before retrying"
                            : undefined
                        }
                        onClick={(event) => {
                          const retryButton = event.currentTarget;
                          const restoreFocus =
                            document.activeElement === retryButton;
                          if (assetLoadError.retry === "more")
                            void handleLoadMore(true);
                          else reloadAssets();
                          if (restoreFocus)
                            window.requestAnimationFrame(() => {
                              if (
                                document.activeElement === document.body ||
                                document.activeElement === retryButton
                              )
                                document
                                  .querySelector<HTMLButtonElement>(
                                    ".view-options-trigger"
                                  )
                                  ?.focus({ preventScroll: true });
                            });
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  {assetLoadError &&
                  loadedQueryKey !== listQueryKey &&
                  view !== "compare" ? null : view === "gallery" ? (
                    <GalleryGrid
                      assets={libraryEntries}
                      changedAssetIds={changedAssetIds}
                      hasQueryFilters={Boolean(
                        search ||
                        tagFilters.length ||
                        tagStatus !== "all" ||
                        scoreFilter !== "all" ||
                        mediaType !== "all"
                      )}
                      onAddMedia={openAddMedia}
                      aspect={aspect}
                      metadataFields={galleryMetadataFields}
                      gridSize={gridSize}
                      isLoading={isAssetContentPending}
                      isLoadingMore={isLoadingMore}
                      isContentReady={loadedQueryKey === listQueryKey}
                      isSelectionMode={isSelectionMode}
                      hasMore={hasMoreAssets}
                      isLoadMoreBlocked={Boolean(assetLoadError)}
                      resultsPending={isResultsPending}
                      loadMoreRef={loadMoreRef}
                      measuredAspectRatios={measuredAspectRatios}
                      scrollContextKey={listQueryKey}
                      syncedAssetId={syncedMediaAnchorId}
                      savingScoreAssetIds={savingScoreAssetIds}
                      selectedAssetIds={selectedAssetIds}
                      onLoadMore={() => void handleLoadMore()}
                      onActiveAssetChange={trackActiveMedia}
                      onMediaDimensionsKnown={handleMediaDimensionsKnown}
                      onFavoriteAsset={(asset, favorite) =>
                        void saveAssetScore(asset, { favorite })
                      }
                      onScoreAsset={(asset, score) =>
                        void saveAssetScore(asset, { score: score })
                      }
                      onSelectAsset={openAnchoredAsset}
                      onInfoAsset={(asset, entryKey) =>
                        openAnnotations(asset.id, entryKey)
                      }
                      onEditAsset={editMedia}
                      onManageAsset={manageAsset}
                      writableAssetIds={writableAssetIds}
                      onToggleSelection={(assetId) => {
                        if (loadedQueryKey === listQueryKey)
                          toggleAssetSelection(assetId);
                      }}
                    />
                  ) : view === "feed" ? (
                    <FeedPreview
                      viewport={feedViewport}
                      onViewportSizeChange={setFeedViewport}
                      useSavedFraming={layout !== "Original"}
                      soundPreference={playbackSettings.feed}
                      onRememberSound={rememberFeedSound}
                      hasQueryFilters={Boolean(
                        search ||
                        tagFilters.length ||
                        tagStatus !== "all" ||
                        scoreFilter !== "all" ||
                        mediaType !== "all"
                      )}
                      resultsPending={isResultsPending}
                      metadataFields={galleryMetadataFields}
                      onEditAsset={editMedia}
                      assets={libraryEntries}
                      isLoading={isAssetContentPending}
                      isLoadingMore={isLoadingMore}
                      isContentReady={loadedQueryKey === listQueryKey}
                      hasMore={hasMoreAssets}
                      isLoadMoreBlocked={Boolean(assetLoadError)}
                      loadMoreRef={loadMoreRef}
                      isFeedChromeHidden={
                        isFeedChromeHidden && !hasLibraryError
                      }
                      isPlaybackPaused={selectedAssetId !== null}
                      savingScoreAssetIds={savingScoreAssetIds}
                      scrollContextKey={listQueryKey}
                      syncedAssetId={syncedMediaAnchorId}
                      onLoadMore={() => void handleLoadMore()}
                      onActiveAssetChange={trackActiveMedia}
                      onFeedChromeHiddenChange={setFeedChromeVisibility}
                      onFavoriteAsset={(asset, favorite) =>
                        void saveAssetScore(asset, { favorite })
                      }
                      onOpenAnnotations={openAnnotations}
                      onOpenAsset={openAnchoredAsset}
                      onScoreAsset={(asset, score) =>
                        void saveAssetScore(asset, { score: score })
                      }
                    />
                  ) : (
                    <ComparisonView
                      aspect={aspect}
                      metadataFields={galleryMetadataFields}
                      measuredAspectRatios={measuredAspectRatios}
                      onMediaDimensionsKnown={handleMediaDimensionsKnown}
                      workspace={comparisonWorkspace}
                      onWorkspaceChange={(workspace) => {
                        pushLocationRef.current = true;
                        setComparisonWorkspace(workspace);
                      }}
                      assetUpdate={comparisonAssetUpdate}
                      folderId={selectedFolderId}
                      isPlaybackPaused={selectedAssetId !== null}
                      mediaType={mediaType}
                      scoreFilter={scoreFilter}
                      search={search}
                      tagFilters={tagFilters}
                      tagMatch={tagMatch}
                      tagStatus={tagStatus}
                      onAssetsUpdated={mergeUpdatedAssets}
                      onOpenFullscreen={openComparisonAsset}
                      onRankingChanged={handleComparisonRankingChanged}
                    />
                  )}
                </>
              )}
            </Suspense>
          </main>
        </SidebarInset>

        {activePage === "library" && selectedAsset ? (
          <Suspense fallback={null}>
            <MediaViewer
              selectedHighlightId={selectedHighlightId}
              soundPreference={playbackSettings.fullView}
              onRememberSound={rememberFullViewSound}
              useSavedFraming={viewerUsesSavedFraming}
              onFramingChange={setViewerUsesSavedFraming}
              framingAspect={framingAspectForMedia(
                selectedAsset,
                selectedHighlightId
              )}
              onHighlightsOnlyChange={(enabled) => {
                if (!enabled) setHighlightSelection(null);
                setHighlightsOnly(enabled);
              }}
              onEditAsset={editMedia}
              onManageAsset={
                assetIsWritable(tree, selectedAsset) ? manageAsset : undefined
              }
              asset={selectedAsset}
              hasNext={
                usesEntryNavigation
                  ? viewerEntryIndex < libraryEntries.length - 1
                  : hasNextViewerAsset
              }
              hasPrevious={
                usesEntryNavigation
                  ? viewerEntryIndex > 0
                  : hasPreviousViewerAsset
              }
              isInfoOpen={annotationAsset !== null}
              onClose={closeAnchoredAsset}
              onRestoreFocus={() => {
                if (!viewerAnchorKey || view === "compare") return false;
                const entry = CSS.escape(viewerAnchorKey);
                const selector =
                  view === "gallery"
                    ? `.media-tile[data-entry-key="${entry}"] .media-preview-button`
                    : `.feed-item[data-entry-key="${entry}"] .video-controls__button--expand, .feed-item[data-entry-key="${entry}"] .feed-actions button`;
                const target =
                  document.querySelector<HTMLButtonElement>(selector);
                target?.focus({ preventScroll: true });
                return target !== null && document.activeElement === target;
              }}
              onScoreChange={(score) =>
                void saveAssetScore(selectedAsset, { score })
              }
              onToggleInfo={() =>
                annotationAsset?.id === selectedAsset.id
                  ? setAnnotationAssetId(null)
                  : openAnnotations(
                      selectedAsset.id,
                      viewerAnchorKey ?? undefined
                    )
              }
              onNext={() => selectViewerEntry(1)}
              onPrevious={() => selectViewerEntry(-1)}
            />
          </Suspense>
        ) : null}

        {annotationAsset ? (
          <Suspense fallback={null}>
            <MediaAnnotationDrawer
              aiStatus={aiStatus}
              asset={annotationAsset}
              locationLabel={mediaFolderLabel(tree, annotationAsset.folderId)}
              isAboveViewer={selectedAssetId !== null}
              isScoreSaving={savingScoreAssetIds.has(annotationAsset.id)}
              onAssetTagsUpdated={handleAssetTagsUpdated}
              onAssetUpdated={handleAssetUpdated}
              selectedHighlightId={annotationHighlightId}
              onViewHighlight={(asset, id) => {
                setHighlightSelection({
                  assetId: asset.id,
                  id,
                  sourceKey: asset.presentation?.renditionKeys.full,
                  entry:
                    view !== "compare" &&
                    asset.presentation?.separateHighlights === true
                });
                setAnnotationAssetId(null);
                pushLocationRef.current = true;
                const anchor = libraryMediaEntryKey(
                  asset.id,
                  asset.presentation?.separateHighlights ? id : null
                );
                activeMediaAnchorIdRef.current = anchor;
                setSyncedMediaAnchorId(anchor);
                openAssetFullscreen(asset);
              }}
              onEditHighlights={(asset) => {
                setAnnotationAssetId(null);
                editMedia(asset, annotationHighlightId);
              }}
              onMakeMainHighlight={saveMainHighlight}
              onSeparateHighlightsChange={saveHighlightsSeparately}
              onClose={() => setAnnotationAssetId(null)}
              onRankingChanged={() => {
                rankingChangedRef.current = true;
                reloadAssets();
              }}
              onScoreChange={saveAssetScore}
            />
          </Suspense>
        ) : null}
        <LibrarySearchDialog
          isOpen={isSearchOpen}
          onOpenChange={setSearchOpen}
          value={searchValues}
          tree={tree}
          isLoadingTree={isLoadingTree}
          onRefreshFolders={refreshTree}
          onSearch={submitSearch}
          onCloseAutoFocus={restoreSearchFocus}
        />
        {editingAsset ? (
          <PresentationEditorDialog
            key={editingAsset.id}
            asset={editingAsset}
            initialAspect={framingAspectForMedia(
              editingAsset,
              editingHighlight?.assetId === editingAsset.id
                ? editingHighlight.id
                : null
            )}
            initialHighlightId={
              editingHighlight?.assetId === editingAsset.id
                ? editingHighlight.id
                : null
            }
            originalFit={view === "compare" ? "contain" : "cover"}
            onClose={() => setEditingAsset(null)}
            onSaved={(updated, useSavedPlayback) => {
              handleAssetUpdated(updated);
              setComparisonAssetUpdate(updated);
              if (useSavedPlayback) setHighlightsOnly(true);
              toast.success("Media edits saved", {
                id: `presentation-save-${updated.id}:${updated.presentation?.revision}`
              });
            }}
          />
        ) : null}
        {managementTarget ? (
          <FileOperationDialog
            key={`${managementTarget.type}:${managementTarget.folderId ?? managementTarget.assets?.map((asset) => asset.id).join("|")}`}
            target={managementTarget}
            tree={tree}
            selectedFolderId={selectedFolderId}
            onClose={() => setManagementTarget(null)}
            onCreateFolder={fileOperations.submit}
            onSubmit={async (input) => {
              await fileOperations.submit(input);
            }}
          />
        ) : null}
      </SidebarProvider>
    </PresentationContext.Provider>
  );
}
