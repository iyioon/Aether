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
  type SettingsSummary
} from "../api/client";
import { hasOpenKeyboardLayer } from "../lib/keyboard";
import type { GuideTopic } from "./guide/guide-topics";
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
import { useAssetList } from "./assets/useAssetList";
import {
  FileOperationDialog,
  type ManagementTarget
} from "./management/FileOperationDialog";
import type {
  IncomingMedia,
  UploadProgress
} from "./management/AddMediaDialog";
import { useFileOperations } from "./management/useFileOperations";
import {
  assetIsWritable,
  completedOperationItems,
  folderIsWritable,
  folderWithin
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
import { clearUploadCheckpoints } from "./management/upload-checkpoints";
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
const loadAddMediaDialog = () => import("./management/AddMediaDialog");
const AddMediaDialog = lazy(() =>
  loadAddMediaDialog().then(({ AddMediaDialog }) => ({
    default: AddMediaDialog
  }))
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
  const shouldReloadAfterScoreChange = (input: {
    score?: number;
    favorite?: boolean;
  }) =>
    sort === "score" ||
    (input.score !== undefined &&
      (scoreFilter === "ranked" || scoreFilter === "unranked")) ||
    (input.favorite !== undefined && scoreFilter === "favorites");
  const {
    assetError,
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
    selectedAssetIds,
    setBatchTagDraft,
    setIsSelectionMode,
    toggleAssetSelection
  } = useBatchSelection({
    assets,
    listQueryKey,
    onAssetsUpdated: mergeUpdatedAssets,
    onReloadAssets: markResultsPending,
    shouldReloadAfterTagChange: tagFilters.length > 0,
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
      if (tagFilters.length > 0) markResultsPending();
    },
    onReloadAssets: markResultsPending,
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
        guideTopic,
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
      guideTopic,
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
      setGuideTopic(next.navigation.guideTopic ?? "browse");
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

  const [pendingMovedIds, setPendingMovedIds] = useState<string[]>([]);
  const [managementTarget, setManagementTarget] =
    useState<ManagementTarget | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [addMediaOpen, setAddMediaOpen] = useState(false);
  const [hasOpenedAddMedia, setHasOpenedAddMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [incomingMedia, setIncomingMedia] = useState<IncomingMedia | null>(
    null
  );
  useEffect(() => {
    if (activityOpen) setHasOpenedAddMedia(true);
  }, [activityOpen]);
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
      setHasOpenedAddMedia(true);
      setAddMediaOpen(true);
    };
    window.addEventListener("dragover", dragOver);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop);
    };
  }, []);
  const managementQueryRef = useRef(listQueryKey);
  managementQueryRef.current = listQueryKey;
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
  const managementSessionRef = useRef(0);
  useEffect(
    () => () => {
      managementSessionRef.current += 1;
    },
    []
  );
  async function undoTrash(operation: FileOperation) {
    const session = managementSessionRef.current;
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
          setActivityOpen(true);
          return;
        }
        input = {
          requestId: crypto.randomUUID(),
          type: "restore",
          items: records.map((item) => ({
            trashId: item.id,
            expectedVersion: item.sourceVersion
          }))
        };
        undoTrashRequestsRef.current.set(operation.id, input);
      }
      await fileOperations.submit(input);
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
          onClick: () => {
            if (session === managementSessionRef.current)
              void undoTrash(operation);
          }
        }
      });
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
        handleAssetsUnavailable(ids);
        markAssetsUnavailable(ids);
      } else if (
        ((operation.type === "add-media" || operation.type === "restore") &&
          updated.some((asset) =>
            folderWithin(tree, asset.folderId, selectedFolderId)
          )) ||
        (operation.type === "rename-media" &&
          updated.some((asset) =>
            assets.some((entry) => entry.id === asset.id)
          ) &&
          (sort === "filename" || sort === "date" || Boolean(search))) ||
        (["move-media", "move-folder", "rename-folder"].includes(
          operation.type
        ) &&
          Boolean(search))
      ) {
        markResultsPending();
      }
      const query = listQueryKey;
      void refreshTree()
        .then((nextTree) => {
          if (managementQueryRef.current !== query) return;
          if (operation.type === "move-media") {
            setPendingMovedIds((current) => [
              ...new Set([
                ...current,
                ...updated
                  .filter(
                    (asset) =>
                      !folderWithin(nextTree, asset.folderId, selectedFolderId)
                  )
                  .map((asset) => asset.id)
              ])
            ]);
          }
        })
        .catch(() =>
          setAssetError(
            "The operation completed. Update results to refresh the library."
          )
        );
    },
    () => setActivityOpen(true),
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
    const unavailable = unavailableAssetIds.filter((id) =>
      assets.some((asset) => asset.id === id)
    );
    const ids = [
      ...new Set([...unavailable, ...pendingMovedIds, ...outsideScopeAssetIds])
    ].filter((id) => assets.some((asset) => asset.id === id));
    if (!ids.length) return;
    if (
      editingAsset &&
      unavailable.includes(editingAsset.id) &&
      !editingAsset.unavailable
    )
      setEditingAsset({ ...editingAsset, unavailable: true });
    handleAssetsUnavailable(unavailable);
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
          hasOpenKeyboardLayer(
            document,
            document.querySelector(
              ".activity-sheet[data-modal='false'][data-state='open']"
            )
          ) ||
          document.querySelector(".score-control [data-pressing]") ||
          (document.activeElement instanceof Element &&
            document.activeElement.closest(".score-control"))
        )
          return;
        handleAssetsUnavailable(unavailable);
        removeAssets(ids);
        setPendingMovedIds((current) =>
          current.filter((id) => !ids.includes(id))
        );
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
    pendingMovedIds,
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
        isResultsPending={isResultsPending}
        canUpdateResults={
          !isSelectionMode &&
          savingScoreAssetIds.size === 0 &&
          !isSavingBatch &&
          !editingAsset &&
          !annotationAsset
        }
        onUpdateResults={reloadAssets}
        onAddMedia={() => {
          setHasOpenedAddMedia(true);
          setAddMediaOpen(true);
        }}
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
          onFolderAction={(type) => {
            if (selectedFolderId)
              setManagementTarget({ type, folderId: selectedFolderId });
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
          onOpenActivity={() => setActivityOpen(true)}
          onOpenTrash={() => {
            pushLocationRef.current = true;
            setActivePage("trash");
            closeSelectionMode();
            setAnnotationAssetId(null);
            setSelectedAssetId(null);
          }}
          onSelectFolder={selectFolder}
          onToggleFolderExpansion={toggleFolderExpansion}
        />
        <SidebarInset className="library-inset">
          <LibraryPathBar
            controls={libraryControls}
            isFeedChromeHidden={isFeedChromeHidden && assets.length > 0}
            isGuideOpen={activePage === "guide"}
            isSettingsOpen={activePage === "settings"}
            isTrashOpen={activePage === "trash"}
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
                  : activePage === "trash"
                    ? "view-trash"
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
                  revision={fileOperations.operations[0]?.revision}
                  onManage={setManagementTarget}
                  onEmptyTrash={fileOperations.submitEmptyTrash}
                />
              ) : (
                <>
                  {isSelectionMode ? (
                    <BatchActionsBar
                      isOpen
                      loadedCount={assets.length}
                      selectedAssets={assets.filter((asset) =>
                        selectedAssetIds.has(asset.id)
                      )}
                      tagDraft={batchTagDraft}
                      tagSuggestions={batchTagSuggestions}
                      isSaving={isSavingBatch}
                      error={batchError}
                      onClear={clearSelectedAssets}
                      onClose={closeSelectionMode}
                      onApplyCuration={saveBatchScore}
                      onApplyTags={saveBatchTags}
                      onTagDraftChange={setBatchTagDraft}
                      onSelectLoaded={selectLoadedAssets}
                      onMove={() =>
                        setManagementTarget({
                          type: "move-media",
                          assets: assets.filter((asset) =>
                            selectedAssetIds.has(asset.id)
                          )
                        })
                      }
                      onTrash={() =>
                        setManagementTarget({
                          type: "trash",
                          assets: assets.filter((asset) =>
                            selectedAssetIds.has(asset.id)
                          )
                        })
                      }
                      onRename={(asset) => manageAsset(asset, "rename-media")}
                    />
                  ) : null}

                  {assetError ? (
                    <div className="inline-error">{assetError}</div>
                  ) : null}

                  {view === "gallery" ? (
                    <GalleryGrid
                      assets={assets}
                      changedAssetIds={changedAssetIds}
                      hasQueryFilters={Boolean(
                        search ||
                        tagFilters.length ||
                        scoreFilter !== "all" ||
                        mediaType !== "all"
                      )}
                      onAddMedia={() => {
                        setHasOpenedAddMedia(true);
                        setAddMediaOpen(true);
                      }}
                      aspect={aspect}
                      metadataFields={galleryMetadataFields}
                      gridSize={gridSize}
                      isLoading={isAssetContentPending}
                      isLoadingMore={isLoadingMore}
                      isContentReady={loadedQueryKey === listQueryKey}
                      isSelectionMode={isSelectionMode}
                      hasMore={hasMoreAssets}
                      resultsPending={isResultsPending}
                      canUpdateResults={
                        !isSelectionMode &&
                        savingScoreAssetIds.size === 0 &&
                        !isSavingBatch &&
                        !editingAsset &&
                        !annotationAsset
                      }
                      onUpdateResults={reloadAssets}
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
                      onManageAsset={manageAsset}
                      writableAssetIds={writableAssetIds}
                      onToggleSelection={toggleAssetSelection}
                    />
                  ) : view === "feed" ? (
                    <FeedPreview
                      hasQueryFilters={Boolean(
                        search ||
                        tagFilters.length ||
                        scoreFilter !== "all" ||
                        mediaType !== "all"
                      )}
                      resultsPending={isResultsPending}
                      onAddMedia={() => {
                        setHasOpenedAddMedia(true);
                        setAddMediaOpen(true);
                      }}
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

        {activePage === "library" && selectedAsset ? (
          <Suspense fallback={null}>
            <MediaViewer
              useSavedFraming={viewerUsesSavedFraming}
              onFramingChange={setViewerUsesSavedFraming}
              framingAspect={aspect}
              applyPlaybackPreferences={view !== "compare"}
              onHighlightsOnlyChange={setHighlightsOnly}
              onEditAsset={setEditingAsset}
              onManageAsset={
                assetIsWritable(tree, selectedAsset) ? manageAsset : undefined
              }
              asset={selectedAsset}
              hasNext={hasNextViewerAsset}
              hasPrevious={hasPreviousViewerAsset}
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
              setActivityOpen(true);
            }}
          />
        ) : null}
        {hasOpenedAddMedia ? (
          <Suspense fallback={null}>
            <AddMediaDialog
              tree={tree}
              open={addMediaOpen || activityOpen}
              incomingMedia={incomingMedia}
              operations={fileOperations.operations}
              onRefresh={fileOperations.refresh}
              onSubmit={fileOperations.submit}
              onTransfers={setUploadProgress}
              onBatchStarted={fileOperations.trackUploadBatch}
              onUploadCancelled={fileOperations.settleUpload}
              selectedFolderId={selectedFolderId}
              onClose={() => {
                setAddMediaOpen(false);
                setActivityOpen(false);
              }}
              onOperation={fileOperations.accept}
            />
          </Suspense>
        ) : null}
      </SidebarProvider>
    </PresentationContext.Provider>
  );
}
