import { useMemo, useState } from "react";
import { logout } from "../api/client";
import { shouldCollapseFeedControlsByDefault } from "./app/app-helpers";
import { useLibraryTree } from "./app/useLibraryTree";
import { useAssetList } from "./assets/useAssetList";
import { readLibraryStateFromUrl, type ViewMode } from "./library-state";
import { BatchActionsBar } from "./batch/BatchActionsBar";
import { useBatchSelection } from "./batch/useBatchSelection";
import { FeedPreview } from "./feed/FeedPreview";
import { useFolderNavigation } from "./folders/useFolderNavigation";
import { GalleryGrid } from "./gallery/GalleryGrid";
import { useGalleryMetadataFields } from "./gallery/useGalleryMetadataFields";
import { useMeasuredAspectRatios } from "./gallery/useMeasuredAspectRatios";
import { FullscreenViewer } from "./media/FullscreenViewer";
import { MediaAnnotationDrawer } from "./media/MediaAnnotationDrawer";
import { useMediaActions } from "./media/useMediaActions";
import { LibrarySidebar } from "./sidebar/LibrarySidebar";
import { useSidebarState } from "./sidebar/useSidebarState";
import { LibraryControlStrip } from "./toolbar/LibraryControlStrip";
import {
  FeedCollapsedTopbar,
  LibraryToolbar
} from "./toolbar/LibraryToolbar";
import { useLibraryControls } from "./toolbar/useLibraryControls";

interface AppShellProps {
  onLogout: () => void;
}

export function AppShell({ onLogout }: AppShellProps) {
  const initialLibraryState = useMemo(() => readLibraryStateFromUrl(), []);
  const {
    aiStatus,
    error,
    handleScan,
    isLoadingTree,
    scanState,
    selectedFolderId,
    setSelectedFolderId,
    tree,
    watchStatus
  } = useLibraryTree({ initialFolderId: initialLibraryState.folderId });
  const {
    clearFields: clearGalleryMetadataFields,
    fields: galleryMetadataFields,
    resetFields: resetGalleryMetadataFields,
    toggleField: toggleGalleryMetadataField
  } = useGalleryMetadataFields();
  const { handleMediaDimensionsKnown, measuredAspectRatios } =
    useMeasuredAspectRatios();
  const {
    closeSidebar,
    collapseSidebar,
    expandSidebar,
    isSidebarCollapsed,
    isSidebarOpen,
    openSidebar
  } = useSidebarState();
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(
    () =>
      initialLibraryState.view === "feed" &&
      shouldCollapseFeedControlsByDefault()
  );
  const [isFeedChromeHidden, setIsFeedChromeHidden] = useState(false);
  const {
    activeFilterLabels,
    applyTagFilter,
    aspect,
    clearLibraryFilters,
    clearTagFilter,
    filterSummary,
    filterTagSuggestions,
    gridSize,
    layoutSummary,
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
    setSort,
    setTagFilterDraft,
    setView,
    sort,
    sortLabel,
    tagFilter,
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
    tagFilter,
    tree
  });
  const {
    batchError,
    batchStatus,
    batchTagDraft,
    batchTagSuggestions,
    clearSelectedAssets,
    isSavingBatch,
    saveBatchRating,
    saveBatchTags,
    selectLoadedAssets,
    selectedAssetCount,
    selectedAssetIds,
    setBatchTagDraft,
    toggleAssetSelection
  } = useBatchSelection({
    assets,
    listQueryKey,
    onAssetsUpdated: mergeUpdatedAssets,
    onReloadAssets: reloadAssets,
    shouldReloadAfterRatingChange
  });
  const {
    annotationAsset,
    closeFullscreen,
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
  const {
    collapseAllFolders,
    expandableFolderIds,
    expandedFolderCount,
    expandedFolderIds,
    expandAllFolders,
    handleFolderTreeKeyDown,
    treeTabStopId,
    toggleFolderExpansion,
    visibleFolderItems
  } = useFolderNavigation({
    selectedFolderId,
    tree,
    onSelectFolder: selectFolder
  });

  const actionSummary = selectedAssetCount
    ? `${selectedAssetCount} selected`
    : `${assets.length} loaded`;

  function selectFolder(folderId: string) {
    setSelectedFolderId(folderId);
    closeSidebar();
    setOpenControlMenu(null);
    setAnnotationAssetId(null);
    setIsFeedChromeHidden(false);
    if (view === "feed") {
      setIsTopBarCollapsed(shouldCollapseFeedControlsByDefault());
    }
  }

  function switchView(nextView: ViewMode) {
    setView(nextView);
    setOpenControlMenu(null);
    setAnnotationAssetId(null);
    setIsFeedChromeHidden(false);
    setIsTopBarCollapsed(
      nextView === "feed" && shouldCollapseFeedControlsByDefault()
    );
  }

  function setFeedChromeVisibility(isHidden: boolean) {
    setIsFeedChromeHidden(isHidden);
    setIsTopBarCollapsed(isHidden || shouldCollapseFeedControlsByDefault());
  }

  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <div
      className={[
        "app-shell",
        isSidebarOpen ? "sidebar-open" : "",
        isSidebarCollapsed ? "sidebar-collapsed" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <LibrarySidebar
        error={error}
        expandableFolderIds={expandableFolderIds}
        expandedFolderCount={expandedFolderCount}
        expandedFolderIds={expandedFolderIds}
        isLoadingTree={isLoadingTree}
        isSidebarCollapsed={isSidebarCollapsed}
        isSidebarOpen={isSidebarOpen}
        items={tree?.roots.length ? visibleFolderItems : []}
        scanState={scanState}
        selectedFolderId={selectedFolderId}
        treeTabStopId={treeTabStopId}
        watchStatus={watchStatus}
        onCloseSidebar={closeSidebar}
        onCollapseAll={collapseAllFolders}
        onCollapseSidebar={collapseSidebar}
        onExpandAll={expandAllFolders}
        onFolderKeyDown={handleFolderTreeKeyDown}
        onLogout={() => void handleLogout()}
        onScan={() => void handleScan()}
        onSelectFolder={selectFolder}
        onToggleFolderExpansion={toggleFolderExpansion}
      />

      <button
        className="mobile-sidebar-backdrop"
        type="button"
        aria-label="Close folders"
        tabIndex={isSidebarOpen ? 0 : -1}
        onClick={closeSidebar}
      />

      <main
        className={[
          "library-main",
          selectedAssetCount > 0 ? "has-selection" : "",
          view === "feed" ? "view-feed" : "view-gallery",
          view === "feed" && isTopBarCollapsed ? "topbar-collapsed" : "",
          view === "feed" && isFeedChromeHidden ? "feed-chrome-hidden" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {view === "feed" && isTopBarCollapsed ? (
          <FeedCollapsedTopbar
            selectedLabel={selectedLabel}
            totalAssets={totalAssets}
            onOpenControls={() => setIsTopBarCollapsed(false)}
            onOpenSidebar={openSidebar}
            onSwitchView={switchView}
          />
        ) : null}

        <LibraryToolbar
          isSidebarCollapsed={isSidebarCollapsed}
          isSidebarOpen={isSidebarOpen}
          searchDraft={searchDraft}
          selectedLabel={selectedLabel}
          totalAssets={totalAssets}
          view={view}
          onExpandSidebar={expandSidebar}
          onOpenSidebar={openSidebar}
          onSearchDraftChange={setSearchDraft}
          onSwitchView={switchView}
        />

        <LibraryControlStrip
          actionSummary={actionSummary}
          activeFilterLabels={activeFilterLabels}
          aspect={aspect}
          assets={assets}
          filterSummary={filterSummary}
          filterTagSuggestions={filterTagSuggestions}
          galleryMetadataFields={galleryMetadataFields}
          gridSize={gridSize}
          isLoadingAssets={isLoadingAssets}
          isSavingBatch={isSavingBatch}
          layoutSummary={layoutSummary}
          mediaType={mediaType}
          mediaTypeLabel={mediaTypeLabel}
          openControlMenu={openControlMenu}
          ratingFilter={ratingFilter}
          ratingFilterLabel={ratingFilterLabel}
          selectedAssetCount={selectedAssetCount}
          sort={sort}
          sortLabel={sortLabel}
          tagFilter={tagFilter}
          tagFilterDraft={tagFilterDraft}
          view={view}
          onApplyTagFilter={applyTagFilter}
          onClearGalleryMetadataFields={clearGalleryMetadataFields}
          onClearLibraryFilters={clearLibraryFilters}
          onClearSelectedAssets={clearSelectedAssets}
          onClearTagFilter={clearTagFilter}
          onHideFeedControls={() => setIsTopBarCollapsed(true)}
          onResetGalleryMetadataFields={resetGalleryMetadataFields}
          onSelectLoadedAssets={selectLoadedAssets}
          onSetAspect={setAspect}
          onSetGridSize={setGridSize}
          onSetMediaType={setMediaType}
          onSetOpenControlMenu={setOpenControlMenu}
          onSetRatingFilter={setRatingFilter}
          onSetSort={setSort}
          onSetTagFilterDraft={setTagFilterDraft}
          onToggleGalleryMetadataField={toggleGalleryMetadataField}
        />

        {selectedAssetCount > 0 ? (
          <BatchActionsBar
            selectedCount={selectedAssetCount}
            tagDraft={batchTagDraft}
            tagSuggestions={batchTagSuggestions}
            isSaving={isSavingBatch}
            status={batchStatus}
            error={batchError}
            onClear={clearSelectedAssets}
            onRate={(rating) => void saveBatchRating({ rating })}
            onClearRating={() => void saveBatchRating({ rating: null })}
            onFavorite={() => void saveBatchRating({ favorite: true })}
            onUnfavorite={() => void saveBatchRating({ favorite: false })}
            onTagDraftChange={setBatchTagDraft}
            onAddTag={() => void saveBatchTags([batchTagDraft], "add")}
            onReplaceTags={() => void saveBatchTags([batchTagDraft], "replace")}
            onClearTags={() => void saveBatchTags([], "replace")}
            onUseSuggestion={(tagName) => void saveBatchTags([tagName], "add")}
          />
        ) : null}

        {assetError ? <div className="inline-error">{assetError}</div> : null}

        {view === "gallery" ? (
          <GalleryGrid
            assets={assets}
            aspect={aspect}
            metadataFields={galleryMetadataFields}
            gridSize={gridSize}
            isLoading={isLoadingAssets}
            isLoadingMore={isLoadingMore}
            hasMore={hasMoreAssets}
            loadMoreRef={loadMoreRef}
            measuredAspectRatios={measuredAspectRatios}
            resetKey={listQueryKey}
            savingRatingAssetIds={savingRatingAssetIds}
            selectedAssetIds={selectedAssetIds}
            onLoadMore={() => void handleLoadMore()}
            onMediaDimensionsKnown={handleMediaDimensionsKnown}
            onFavoriteAsset={(asset, favorite) =>
              void saveAssetRating(asset, { favorite })
            }
            onRateAsset={(asset, rating) =>
              void saveAssetRating(asset, { rating })
            }
            onSelectAsset={setSelectedAssetId}
            onToggleSelection={toggleAssetSelection}
          />
        ) : (
          <FeedPreview
            assets={assets}
            isLoading={isLoadingAssets}
            isLoadingMore={isLoadingMore}
            hasMore={hasMoreAssets}
            loadMoreRef={loadMoreRef}
            isFeedChromeHidden={isFeedChromeHidden}
            isPlaybackPaused={selectedAssetId !== null}
            syncedAssetId={selectedAssetId}
            onLoadMore={() => void handleLoadMore()}
            onFeedChromeHiddenChange={setFeedChromeVisibility}
            onOpenAnnotations={setAnnotationAssetId}
            onOpenAsset={openAssetFullscreen}
          />
        )}
      </main>

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

      {selectedAsset ? (
        <FullscreenViewer
          asset={selectedAsset}
          hasNext={assets.some(
            (asset, index) =>
              asset.id === selectedAsset.id && index < assets.length - 1
          )}
          hasPrevious={assets.some(
            (asset, index) => asset.id === selectedAsset.id && index > 0
          )}
          isInfoOpen={annotationAsset !== null}
          onClose={() => {
            setAnnotationAssetId(null);
            setSelectedAssetId(null);
          }}
          onOpenInfo={() => setAnnotationAssetId(selectedAsset.id)}
          onNext={() => selectAdjacentAsset(1)}
          onPrevious={() => selectAdjacentAsset(-1)}
        />
      ) : null}
    </div>
  );
}
