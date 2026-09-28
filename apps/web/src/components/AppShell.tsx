import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSettings, logout, type SettingsSummary } from "../api/client";
import { useLibraryTree } from "./app/useLibraryTree";
import { useAssetList } from "./assets/useAssetList";
import { readLibraryStateFromUrl, type ViewMode } from "./library-state";
import { BatchActionsBar } from "./batch/BatchActionsBar";
import { useBatchSelection } from "./batch/useBatchSelection";
import { FeedPreview } from "./feed/FeedPreview";
import { useFolderNavigation } from "./folders/useFolderNavigation";
import { GalleryGrid } from "./gallery/GalleryGrid";
import { isAssetListPending } from "./gallery-loading";
import { useGalleryMetadataFields } from "./gallery/useGalleryMetadataFields";
import { useMeasuredAspectRatios } from "./gallery/useMeasuredAspectRatios";
import { MediaViewer } from "./media/MediaViewer";
import { MediaAnnotationDrawer } from "./media/MediaAnnotationDrawer";
import { useMediaActions } from "./media/useMediaActions";
import { SettingsPage } from "./settings/SettingsPage";
import type { AppearanceSettings } from "./settings/useAppearanceSettings";
import { LibraryPathBar } from "./sidebar/LibraryPathBar";
import { LibrarySidebar } from "./sidebar/LibrarySidebar";
import { readSidebarDefaultOpen } from "./sidebar/sidebar-state";
import { clearSessionScrollPositions } from "./scroll-restoration";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { LibraryControlStrip } from "./toolbar/LibraryControlStrip";
import { useLibraryControls } from "./toolbar/useLibraryControls";

interface AppShellProps {
  appearance: AppearanceSettings;
  onLogout: () => void;
}

export function AppShell({ appearance, onLogout }: AppShellProps) {
  const initialLibraryState = useMemo(() => readLibraryStateFromUrl(), []);
  const sidebarDefaultOpen = useMemo(() => readSidebarDefaultOpen(), []);
  const [activePage, setActivePage] = useState<"library" | "settings">(
    "library"
  );
  const [settingsSummary, setSettingsSummary] =
    useState<SettingsSummary | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
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
    scanProgress,
    scanState,
    selectedFolderId,
    setSelectedFolderId,
    tree,
    watchStatus
  } = useLibraryTree({ initialFolderId: initialLibraryState.folderId });

  useEffect(() => {
    if (scanState === "completed") {
      toast.success("Scan complete", {
        description: "Your library scan finished successfully.",
        id: "library-scan-status"
      });
    } else if (scanState === "failed") {
      toast.error("Scan failed", {
        description: "The library could not be refreshed. Please try again.",
        id: "library-scan-status"
      });
    }
  }, [scanState]);
  const {
    clearFields: clearGalleryMetadataFields,
    fields: galleryMetadataFields,
    resetFields: resetGalleryMetadataFields,
    toggleField: toggleGalleryMetadataField
  } = useGalleryMetadataFields();
  const { handleMediaDimensionsKnown, measuredAspectRatios } =
    useMeasuredAspectRatios();
  const [isFeedChromeHidden, setIsFeedChromeHidden] = useState(false);
  const activeMediaAnchorIdRef = useRef<string | null>(null);
  const [syncedMediaAnchorId, setSyncedMediaAnchorId] = useState<string | null>(
    null
  );
  const {
    addTagFilter,
    aspect,
    clearTagFilters,
    filterSummary,
    filterTagSuggestions,
    gridSize,
    layoutSummary,
    mediaType,
    mediaTypeLabel,
    openControlMenu,
    ratingFilter,
    ratingFilterLabel,
    removeTagFilter,
    search,
    searchDraft,
    selectedLabel,
    setAspect,
    setGridSize,
    setMediaType,
    setOpenControlMenu,
    setRatingFilter,
    setSearchDraft,
    setSort,
    setSortDirection,
    setTagFilterDraft,
    setView,
    sort,
    sortDirection,
    sortLabel,
    sortSummary,
    tagFilters,
    tagFilterDraft,
    view
  } = useLibraryControls({
    initialState: initialLibraryState,
    selectedFolderId,
    tree
  });
  const shouldReloadAfterRatingChange =
    ratingFilter !== "all" || sort === "rating";
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
    totalAssets,
    updateAssetTags
  } = useAssetList({
    folderId: selectedFolderId,
    mediaType,
    ratingFilter,
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
    saveBatchRating,
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
    shouldReloadAfterRatingChange
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

  const allSelectedAssetsFavorite =
    selectedAssetCount > 0 &&
    assets.every(
      (asset) => !selectedAssetIds.has(asset.id) || asset.favorite
    );
  const {
    annotationAsset,
    handleAssetTagsUpdated,
    handleAssetUpdated,
    openAssetFullscreen,
    saveAssetRating,
    savingRatingAssetIds,
    selectAdjacentAsset,
    selectedAsset,
    selectedAssetId,
    setAnnotationAssetId,
    setSelectedAssetId
  } = useMediaActions({
    assets,
    onAssetError: setAssetError,
    onAssetsUpdated: mergeUpdatedAssets,
    onAssetTagsUpdated: updateAssetTags,
    onReloadAssets: reloadAssets,
    shouldReloadAfterRatingChange
  });

  useEffect(() => {
    if (selectedAssetId) {
      activeMediaAnchorIdRef.current = selectedAssetId;
      setSyncedMediaAnchorId(selectedAssetId);
    }
  }, [selectedAssetId]);

  useEffect(() => {
    activeMediaAnchorIdRef.current = null;
    setSyncedMediaAnchorId(null);
  }, [listQueryKey]);
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

  function selectFolder(folderId: string) {
    setActivePage("library");
    setSelectedFolderId(folderId);
    setOpenControlMenu(null);
    setAnnotationAssetId(null);
    if (view === "feed") {
      setIsFeedChromeHidden(false);
    }
  }

  function switchView(nextView: ViewMode) {
    setActivePage("library");
    setSyncedMediaAnchorId(activeMediaAnchorIdRef.current);
    setView(nextView);
    closeSelectionMode();
    setOpenControlMenu(null);
    setAnnotationAssetId(null);
    setIsFeedChromeHidden(false);
  }

  function openAnchoredAsset(assetId: string) {
    activeMediaAnchorIdRef.current = assetId;
    setSyncedMediaAnchorId(assetId);
    openAssetFullscreen(assetId);
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

  async function refreshSettingsSummary() {
    setIsLoadingSettings(true);
    setSettingsError(null);

    try {
      setSettingsSummary(await getSettings());
    } catch {
      setSettingsError("Settings could not be loaded.");
    } finally {
      setIsLoadingSettings(false);
    }
  }

  function openSettings() {
    setActivePage("settings");
    closeSelectionMode();
    setOpenControlMenu(null);
    setAnnotationAssetId(null);
    setSelectedAssetId(null);
    void refreshSettingsSummary();
  }

  function backToLibrary() {
    setActivePage("library");
  }

  async function handleLogout() {
    await logout();
    onLogout();
    window.setTimeout(clearSessionScrollPositions, 0);
  }

  const libraryControls = activePage === "library" ? (
    <LibraryControlStrip
      aspect={aspect}
      filterSummary={filterSummary}
      filterTagSuggestions={filterTagSuggestions}
      galleryMetadataFields={galleryMetadataFields}
      gridSize={gridSize}
      isSelectionMode={isSelectionMode}
      loadedAssetCount={assets.length}
      layoutSummary={layoutSummary}
      mediaType={mediaType}
      mediaTypeLabel={mediaTypeLabel}
      openControlMenu={openControlMenu}
      ratingFilter={ratingFilter}
      ratingFilterLabel={ratingFilterLabel}
      sort={sort}
      sortDirection={sortDirection}
      sortLabel={sortLabel}
      sortSummary={sortSummary}
      tagFilters={tagFilters}
      tagFilterDraft={tagFilterDraft}
      onAddTagFilter={addTagFilter}
      onClearGalleryMetadataFields={clearGalleryMetadataFields}
      onClearTagFilters={clearTagFilters}
      onRemoveTagFilter={removeTagFilter}
      onResetGalleryMetadataFields={resetGalleryMetadataFields}
      onSetSelectionMode={setSelectionMode}
      onSetAspect={setAspect}
      onSetGridSize={setGridSize}
      onSetMediaType={setMediaType}
      onSetOpenControlMenu={setOpenControlMenu}
      onSetRatingFilter={setRatingFilter}
      onSetSort={setSort}
      onSetSortDirection={setSortDirection}
      onSetTagFilterDraft={setTagFilterDraft}
      onToggleGalleryMetadataField={toggleGalleryMetadataField}
    />
  ) : null;

  return (
    <SidebarProvider className="app-shell" defaultOpen={sidebarDefaultOpen}>
      <LibrarySidebar
        error={error}
        expandableFolderIds={expandableFolderIds}
        expandedFolderCount={expandedFolderCount}
        expandedFolderIds={expandedFolderIds}
        folderSortMode={folderSortMode}
        isLoadingTree={isLoadingTree}
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
        onOpenSettings={openSettings}
        onScan={() => void handleScan()}
        onSelectFolder={selectFolder}
        onToggleFolderExpansion={toggleFolderExpansion}
      />
      <SidebarInset
        className={[
          "library-inset",
          activePage === "library" && view === "feed" && isFeedChromeHidden
            ? "feed-chrome-hidden"
            : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <LibraryPathBar
          controls={libraryControls}
          isSettingsOpen={activePage === "settings"}
          searchDraft={searchDraft}
          selectedFolderId={selectedFolderId}
          tree={tree}
          view={view}
          onBackToLibrary={backToLibrary}
          onSearchDraftChange={setSearchDraft}
          onSelectFolder={selectFolder}
          onSwitchView={switchView}
        />
      <main
        className={[
          "library-main",
          isSelectionMode ? "has-selection" : "",
          activePage === "settings"
            ? "view-settings"
            : view === "feed"
              ? "view-feed"
              : "view-gallery",
          activePage === "library" && view === "feed" && isFeedChromeHidden
            ? "feed-chrome-hidden"
            : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {activePage === "settings" ? (
          <SettingsPage
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
            theme={theme}
            themeOptions={themeOptions}
          />
        ) : (
          <>
            <BatchActionsBar
              isOpen={isSelectionMode}
              loadedCount={assets.length}
              selectedCount={selectedAssetCount}
              allSelectedFavorite={allSelectedAssetsFavorite}
              tagDraft={batchTagDraft}
              tagSuggestions={batchTagSuggestions}
              isSaving={isSavingBatch}
              onClear={clearSelectedAssets}
              onClose={closeSelectionMode}
              onApplyCuration={(input) => void saveBatchRating(input)}
              onTagDraftChange={setBatchTagDraft}
              onAddTag={() => void saveBatchTags([batchTagDraft], "add")}
              onReplaceTags={() =>
                void saveBatchTags([batchTagDraft], "replace")
              }
              onSelectLoaded={selectLoadedAssets}
              onClearTags={() => void saveBatchTags([], "replace")}
            />

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
                savingRatingAssetIds={savingRatingAssetIds}
                selectedAssetIds={selectedAssetIds}
                onLoadMore={() => void handleLoadMore()}
                onActiveAssetChange={trackActiveMedia}
                onMediaDimensionsKnown={handleMediaDimensionsKnown}
                onFavoriteAsset={(asset, favorite) =>
                  void saveAssetRating(asset, { favorite })
                }
                onScoreAsset={(asset, score) =>
                  void saveAssetRating(asset, { rating: score })
                }
                onSelectAsset={openAnchoredAsset}
                onToggleSelection={toggleAssetSelection}
              />
            ) : (
              <FeedPreview
                assets={assets}
                isLoading={isAssetContentPending}
                isLoadingMore={isLoadingMore}
                isContentReady={loadedQueryKey === listQueryKey}
                hasMore={hasMoreAssets}
                loadMoreRef={loadMoreRef}
                isFeedChromeHidden={isFeedChromeHidden}
                isPlaybackPaused={selectedAssetId !== null}
                savingRatingAssetIds={savingRatingAssetIds}
                scrollContextKey={listQueryKey}
                syncedAssetId={syncedMediaAnchorId}
                onLoadMore={() => void handleLoadMore()}
                onActiveAssetChange={trackActiveMedia}
                onFeedChromeHiddenChange={setFeedChromeVisibility}
                onFavoriteAsset={(asset, favorite) =>
                  void saveAssetRating(asset, { favorite })
                }
                onOpenAnnotations={setAnnotationAssetId}
                onOpenAsset={openAnchoredAsset}
                onScoreAsset={(asset, score) =>
                  void saveAssetRating(asset, { rating: score })
                }
              />
            )}
          </>
        )}
      </main>
      </SidebarInset>

      {selectedAsset ? (
        <MediaViewer
          asset={selectedAsset}
          hasNext={assets.some(
            (asset, index) =>
              asset.id === selectedAsset.id && index < assets.length - 1
          )}
          hasPrevious={assets.some(
            (asset, index) => asset.id === selectedAsset.id && index > 0
          )}
          isInfoOpen={annotationAsset !== null}
          onClose={closeAnchoredAsset}
          onRatingChange={(rating) =>
            void saveAssetRating(selectedAsset, { rating })
          }
          onToggleInfo={() =>
            setAnnotationAssetId((current) =>
              current === selectedAsset.id ? null : selectedAsset.id
            )
          }
          onNext={() => selectAdjacentAsset(1)}
          onPrevious={() => selectAdjacentAsset(-1)}
        />
      ) : null}

      {annotationAsset ? (
        <MediaAnnotationDrawer
          aiStatus={aiStatus}
          asset={annotationAsset}
          isAboveViewer={selectedAssetId !== null}
          onAssetTagsUpdated={handleAssetTagsUpdated}
          onAssetUpdated={handleAssetUpdated}
          onClose={() => setAnnotationAssetId(null)}
        />
      ) : null}
    </SidebarProvider>
  );
}
