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
  logout,
  type AssetRecord,
  type LibraryDataResetOptions,
  type SettingsSummary
} from "../api/client";
import type { AppPage, ComparisonWorkspace } from "./app-navigation-state";
import {
  clearAppResumeState,
  readInitialAppLocation,
  resolveAppLocation,
  saveAppLocation,
  writeAppLocationToUrl,
  type SettingsTab
} from "./app-location-state";
import { clearRankingResumeState } from "./compare/ranking-resume-state";
import { clearRandomOrderState } from "./assets/random-order-state";
import { usePageLifecycle } from "../hooks/usePageLifecycle";
import { useLibraryTree } from "./app/useLibraryTree";
import { scanToastForState } from "./app/scan-status";
import { useAssetList } from "./assets/useAssetList";
import { BatchActionsBar } from "./batch/BatchActionsBar";
import type { ViewMode } from "./library-state";
import { useBatchSelection } from "./batch/useBatchSelection";
import { useFolderNavigation } from "./folders/useFolderNavigation";
import { isAssetListPending } from "./gallery-loading";
import { useGalleryMetadataFields } from "./gallery/useGalleryMetadataFields";
import { useMeasuredAspectRatios } from "./gallery/useMeasuredAspectRatios";
import { useMediaActions } from "./media/useMediaActions";
import type { AppearanceSettings } from "./settings/useAppearanceSettings";
import { LibraryPathBar } from "./sidebar/LibraryPathBar";
import { LibrarySidebar } from "./sidebar/LibrarySidebar";
import { readSidebarDefaultOpen } from "./sidebar/sidebar-state";
import { clearSessionScrollPositions } from "./scroll-restoration";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { Skeleton } from "./ui/skeleton";
import { LibraryControlStrip } from "./toolbar/LibraryControlStrip";
import { useLibraryControls } from "./toolbar/useLibraryControls";
import { PresentationContext } from "./media/presentation-context";
import { clearPresentationCapabilities } from "./media/usePresentationCapabilities";
import { clearMediaImageCache } from "./media/media-image-cache";
import { animationAtlasCache } from "./media/animation-atlas-cache";
import { PresentationEditorDialog } from "./media/PresentationEditorDialog";

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
  const [initialLocation] = useState(readInitialAppLocation);
  const initialLibraryState = initialLocation.library;
  const sidebarDefaultOpen = useMemo(() => readSidebarDefaultOpen(), []);
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
    scanState,
    selectedFolderId,
    setSelectedFolderId,
    tree,
    watchStatus
  } = useLibraryTree({ initialFolderId: initialLibraryState.folderId });

  useEffect(() => {
    const notification = scanToastForState(scanState);

    if (notification) {
      toast[notification.variant](notification.title, {
        description: notification.description,
        id: "library-scan-status"
      });
    }
  }, [scanState]);
  const { handleMediaDimensionsKnown, measuredAspectRatios } =
    useMeasuredAspectRatios();
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [isFeedChromeHidden, setIsFeedChromeHidden] = useState(false);
  const [comparisonAssetUpdate, setComparisonAssetUpdate] =
    useState<AssetRecord | null>(null);
  const rankingChangedRef = useRef(false);
  const activeMediaAnchorIdRef = useRef<string | null>(null);
  const [syncedMediaAnchorId, setSyncedMediaAnchorId] = useState<string | null>(
    null
  );
  const {
    applyLibraryState,
    addTagFilter,
    aspect,
    clearTagFilters,
    clearFilters,
    filterTagSuggestions,
    gridSize,
    highlightsOnly,
    setHighlightsOnly,
    viewerUsesSavedFraming,
    setViewerUsesSavedFraming,
    mediaType,
    isOptionsOpen,
    scoreFilter,
    removeTagFilter,
    search,
    searchDraft,
    setAspect,
    setGridSize,
    setMediaType,
    setOptionsOpen,
    setScoreFilter,
    setSearchDraft,
    setSort,
    setSortDirection,
    setTagFilterDraft,
    setView,
    sort,
    sortDirection,
    tagFilters,
    tagFilterDraft,
    view
  } = useLibraryControls({
    initialState: initialLibraryState,
    selectedFolderId,
    tree
  });
  const {
    clearFields: clearGalleryMetadataFields,
    fields: galleryMetadataFields,
    resetFields: resetGalleryMetadataFields,
    toggleField: toggleGalleryMetadataField
  } = useGalleryMetadataFields(view);
  const currentViewRef = useRef(view);
  currentViewRef.current = view;
  const shouldReloadAfterScoreChange =
    scoreFilter !== "all" || sort === "score";
  const {
    assetError,
    assets,
    handleLoadMore,
    hasMoreAssets,
    isLoadingAssets,
    isLoadingMore,
    listQueryKey,
    loadedQueryKey,
    loadMoreRef,
    mergeUpdatedAssets,
    reloadAssets,
    setAssetError,
    updateAssetTags
  } = useAssetList({
    folderId: selectedFolderId,
    mediaType,
    scoreFilter,
    search,
    sort,
    sortDirection,
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
    selectedAssetCount,
    selectedAssetIds,
    setBatchTagDraft,
    setIsSelectionMode,
    toggleAssetSelection
  } = useBatchSelection({
    assets,
    listQueryKey,
    onAssetsUpdated: mergeUpdatedAssets,
    onReloadAssets: reloadAssets,
    shouldReloadAfterScoreChange
  });

  useEffect(() => {
    if (batchError) {
      toast.error("Selection update failed", {
        description: batchError,
        id: "batch-action-status"
      });
    } else if (batchStatus) {
      toast.success(batchStatus, {
        id: "batch-action-status"
      });
    }
  }, [batchError, batchStatus]);

  const allSelectedAssetsFavorite = useMemo(
    () =>
      selectedAssetCount > 0 &&
      assets.every(
        (asset) => !selectedAssetIds.has(asset.id) || asset.favorite
      ),
    [assets, selectedAssetCount, selectedAssetIds]
  );

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

  const handleMediaActionError = useCallback(
    (message: string | null) => {
      setAssetError(message);
      if (message) {
        toast.error("Media update failed", {
          description: message,
          id: "media-action-status"
        });
      }
    },
    [setAssetError]
  );

  const {
    annotationAsset,
    handleAssetTagsUpdated,
    handleAssetUpdated,
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
    onAssetTagsUpdated: updateAssetTags,
    onReloadAssets: reloadAssets,
    shouldReloadAfterScoreChange
  });
  const location = useMemo(
    () => ({
      library: {
        folderId: selectedFolderId,
        view,
        gridSize,
        aspect,
        sort,
        sortDirection,
        mediaType,
        scoreFilter,
        search,
        tags: tagFilters,
        ...(highlightsOnly ? { highlightsOnly: true } : {})
      },
      navigation: {
        page: activePage,
        comparisonWorkspace,
        settingsTab,
        viewerAssetId: selectedAssetId
      }
    }),
    [
      selectedFolderId,
      view,
      gridSize,
      aspect,
      sort,
      sortDirection,
      mediaType,
      scoreFilter,
      search,
      tagFilters,
      highlightsOnly,
      activePage,
      comparisonWorkspace,
      settingsTab,
      selectedAssetId
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
      if (tree)
        saveAppLocation({
          ...location,
          library: {
            ...location.library,
            search: searchDraft.trim().slice(0, 160)
          }
        });
    },
    onResume: () => {
      void refreshTree().catch(() => undefined);
    }
  });
  useEffect(() => {
    const restore = () => {
      const next = resolveAppLocation(window.location.search, location);
      pushLocationRef.current = false;
      setActivePage(next.navigation.page);
      setComparisonWorkspace(next.navigation.comparisonWorkspace);
      setSettingsTab(next.navigation.settingsTab);
      setSelectedFolderId(next.library.folderId);
      applyLibraryState(next.library);
      setSelectedAssetId(next.navigation.viewerAssetId);
      setAnnotationAssetId(null);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [
    applyLibraryState,
    location,
    setAnnotationAssetId,
    setSelectedAssetId,
    setSelectedFolderId
  ]);
  const selectedAssetIndex = useMemo(
    () =>
      selectedAsset
        ? assets.findIndex((asset) => asset.id === selectedAsset.id)
        : -1,
    [assets, selectedAsset]
  );

  useEffect(() => {
    if (selectedAssetId) {
      activeMediaAnchorIdRef.current = selectedAssetId;
      setSyncedMediaAnchorId(selectedAssetId);
      void loadMediaAnnotationDrawer().catch(() => undefined);
    }
  }, [selectedAssetId]);

  useEffect(() => {
    activeMediaAnchorIdRef.current = null;
    setSyncedMediaAnchorId(null);
  }, [listQueryKey]);
  const selectFolder = useCallback(
    (folderId: string) => {
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

  function closeSelectionMode() {
    setIsSelectionMode(false);
    clearSelectedAssets();
  }

  function setSelectionMode(nextIsSelectionMode: boolean) {
    if (nextIsSelectionMode) {
      setIsSelectionMode(true);
      return;
    }

    closeSelectionMode();
  }

  function switchView(nextView: ViewMode) {
    pushLocationRef.current = true;
    setActivePage("library");
    setSyncedMediaAnchorId(activeMediaAnchorIdRef.current);
    setView(nextView);
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

  function openAnchoredAsset(assetId: string) {
    pushLocationRef.current = true;
    activeMediaAnchorIdRef.current = assetId;
    setSyncedMediaAnchorId(assetId);
    openAssetFullscreen(assetId);
  }

  function openComparisonAsset(asset: AssetRecord) {
    pushLocationRef.current = true;
    activeMediaAnchorIdRef.current = asset.id;
    setSyncedMediaAnchorId(asset.id);
    openAssetFullscreen(asset);
  }

  function closeAnchoredAsset() {
    if (selectedAssetId) {
      activeMediaAnchorIdRef.current = selectedAssetId;
      setSyncedMediaAnchorId(selectedAssetId);
    }

    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function trackActiveMedia(assetId: string) {
    activeMediaAnchorIdRef.current = assetId;
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
    setActivePage("settings");
    closeSelectionMode();
    setOptionsOpen(false);
    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function openGuide() {
    pushLocationRef.current = true;
    setActivePage("guide");
    closeSelectionMode();
    setOptionsOpen(false);
    setAnnotationAssetId(null);
    setSelectedAssetId(null);
  }

  function backToLibrary() {
    pushLocationRef.current = true;
    setActivePage("library");
  }

  async function handleLogout() {
    const clearResume = () => {
      clearSessionScrollPositions();
      clearRankingResumeState();
      clearRandomOrderState();
      clearAppResumeState();
      clearPresentationCapabilities();
      clearMediaImageCache();
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

  const libraryControls =
    activePage === "library" ? (
      <LibraryControlStrip
        aspect={aspect}
        filterTagSuggestions={filterTagSuggestions}
        galleryMetadataFields={galleryMetadataFields}
        gridSize={gridSize}
        highlightsOnly={highlightsOnly}
        onHighlightsOnlyChange={setHighlightsOnly}
        isSelectionMode={isSelectionMode}
        loadedAssetCount={assets.length}
        mediaType={mediaType}
        isOpen={isOptionsOpen}
        scoreFilter={scoreFilter}
        sort={sort}
        sortDirection={sortDirection}
        tagFilters={tagFilters}
        tagFilterDraft={tagFilterDraft}
        view={view}
        onAddTagFilter={addTagFilter}
        onClearGalleryMetadataFields={clearGalleryMetadataFields}
        onClearFilters={clearFilters}
        onRemoveTagFilter={removeTagFilter}
        onResetGalleryMetadataFields={resetGalleryMetadataFields}
        onSetSelectionMode={setSelectionMode}
        onSetAspect={setAspect}
        onSetGridSize={setGridSize}
        onSetMediaType={setMediaType}
        onOpenChange={setOptionsOpen}
        onSetScoreFilter={setScoreFilter}
        onSetSort={setSort}
        onSetSortDirection={setSortDirection}
        onSetTagFilterDraft={setTagFilterDraft}
        onToggleGalleryMetadataField={toggleGalleryMetadataField}
      />
    ) : null;

  const presentationPreferences = useMemo(
    () => ({ highlightsOnly, isPlaybackPaused: editingAsset !== null }),
    [highlightsOnly, editingAsset]
  );
  useEffect(() => {
    setEditingAsset(null);
  }, [activePage, view, selectedFolderId, selectedAssetId, listQueryKey]);

  return (
    <PresentationContext.Provider value={presentationPreferences}>
      <SidebarProvider className="app-shell" defaultOpen={sidebarDefaultOpen}>
        <LibrarySidebar
          error={error}
          expandableFolderIds={expandableFolderIds}
          expandedFolderCount={expandedFolderCount}
          expandedFolderIds={expandedFolderIds}
          folderSortMode={folderSortMode}
          isLoadingTree={isLoadingTree}
          isGuideOpen={activePage === "guide"}
          isSettingsOpen={activePage === "settings"}
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
          onScan={() => void handleScan()}
          onSelectFolder={selectFolder}
          onToggleFolderExpansion={toggleFolderExpansion}
        />
        <SidebarInset className="library-inset">
          <LibraryPathBar
            controls={libraryControls}
            isFeedChromeHidden={isFeedChromeHidden && assets.length > 0}
            isGuideOpen={activePage === "guide"}
            isSettingsOpen={activePage === "settings"}
            searchDraft={searchDraft}
            selectedFolderId={selectedFolderId}
            tree={tree}
            view={view}
            onBackToLibrary={backToLibrary}
            onSearchDraftChange={setSearchDraft}
            onSelectFolder={selectFolder}
            onPreloadView={preloadView}
            onSwitchView={switchView}
          />
          <main
            className={[
              "library-main",
              isSelectionMode ? "has-selection" : "",
              activePage === "settings"
                ? "view-settings"
                : activePage === "guide"
                  ? "view-guide"
                  : view === "feed"
                    ? "view-feed"
                    : view === "compare"
                      ? "view-compare"
                      : "view-gallery"
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <Suspense fallback={<WorkspaceLoadingFallback />}>
              {activePage === "settings" ? (
                <SettingsPage
                  tab={settingsTab}
                  onTabChange={setSettingsTab}
                  accent={accent}
                  accentOptions={accentOptions}
                  customAccent={customAccent}
                  isLoading={isLoadingSettings}
                  settings={settingsSummary}
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
                <UserGuidePage />
              ) : (
                <>
                  {isSelectionMode ? (
                    <BatchActionsBar
                      isOpen
                      loadedCount={assets.length}
                      selectedCount={selectedAssetCount}
                      allSelectedFavorite={allSelectedAssetsFavorite}
                      tagDraft={batchTagDraft}
                      tagSuggestions={batchTagSuggestions}
                      isSaving={isSavingBatch}
                      onClear={clearSelectedAssets}
                      onClose={closeSelectionMode}
                      onApplyCuration={(input) => void saveBatchScore(input)}
                      onTagDraftChange={setBatchTagDraft}
                      onAddTag={() =>
                        void saveBatchTags([batchTagDraft], "add")
                      }
                      onReplaceTags={() =>
                        void saveBatchTags([batchTagDraft], "replace")
                      }
                      onSelectLoaded={selectLoadedAssets}
                      onClearTags={() => void saveBatchTags([], "replace")}
                    />
                  ) : null}

                  {assetError ? (
                    <div className="inline-error">{assetError}</div>
                  ) : null}

                  {view === "gallery" ? (
                    <GalleryGrid
                      assets={assets}
                      aspect={aspect}
                      metadataFields={galleryMetadataFields}
                      gridSize={gridSize}
                      isLoading={isAssetContentPending}
                      isLoadingMore={isLoadingMore}
                      isContentReady={loadedQueryKey === listQueryKey}
                      isSelectionMode={isSelectionMode}
                      hasMore={hasMoreAssets}
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
                      onInfoAsset={(asset) => setAnnotationAssetId(asset.id)}
                      onEditAsset={setEditingAsset}
                      onToggleSelection={toggleAssetSelection}
                    />
                  ) : view === "feed" ? (
                    <FeedPreview
                      metadataFields={galleryMetadataFields}
                      onEditAsset={setEditingAsset}
                      assets={assets}
                      isLoading={isAssetContentPending}
                      isLoadingMore={isLoadingMore}
                      isContentReady={loadedQueryKey === listQueryKey}
                      hasMore={hasMoreAssets}
                      loadMoreRef={loadMoreRef}
                      isFeedChromeHidden={isFeedChromeHidden}
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
                      onOpenAnnotations={setAnnotationAssetId}
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

        {selectedAsset ? (
          <Suspense fallback={null}>
            <MediaViewer
              useSavedFraming={viewerUsesSavedFraming}
              onFramingChange={setViewerUsesSavedFraming}
              framingAspect={aspect}
              applyPlaybackPreferences={view !== "compare"}
              onHighlightsOnlyChange={setHighlightsOnly}
              onEditAsset={setEditingAsset}
              asset={selectedAsset}
              hasNext={
                selectedAssetIndex >= 0 &&
                selectedAssetIndex < assets.length - 1
              }
              hasPrevious={selectedAssetIndex > 0}
              isInfoOpen={annotationAsset !== null}
              onClose={closeAnchoredAsset}
              onScoreChange={(score) =>
                void saveAssetScore(selectedAsset, { score })
              }
              onToggleInfo={() =>
                setAnnotationAssetId((current) =>
                  current === selectedAsset.id ? null : selectedAsset.id
                )
              }
              onNext={() => selectAdjacentAsset(1)}
              onPrevious={() => selectAdjacentAsset(-1)}
            />
          </Suspense>
        ) : null}

        {annotationAsset ? (
          <Suspense fallback={null}>
            <MediaAnnotationDrawer
              aiStatus={aiStatus}
              asset={annotationAsset}
              isAboveViewer={selectedAssetId !== null}
              isScoreSaving={savingScoreAssetIds.has(annotationAsset.id)}
              onAssetTagsUpdated={handleAssetTagsUpdated}
              onAssetUpdated={handleAssetUpdated}
              onClose={() => setAnnotationAssetId(null)}
              onRankingChanged={() => {
                rankingChangedRef.current = true;
                reloadAssets();
              }}
              onScoreChange={saveAssetScore}
            />
          </Suspense>
        ) : null}
        {editingAsset ? (
          <PresentationEditorDialog
            key={editingAsset.id}
            asset={editingAsset}
            initialAspect={aspect}
            originalFit={view === "compare" ? "contain" : "cover"}
            onClose={() => setEditingAsset(null)}
            onSaved={(updated, useSavedPlayback) => {
              handleAssetUpdated(updated);
              setComparisonAssetUpdate(updated);
              if (useSavedPlayback) setHighlightsOnly(true);
            }}
          />
        ) : null}
      </SidebarProvider>
    </PresentationContext.Provider>
  );
}
