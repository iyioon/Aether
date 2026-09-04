import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CheckCircle2,
  Download,
  GalleryHorizontalEnd,
  Grid3X3,
  Heart,
  Image,
  LogOut,
  Maximize2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rows3,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tags,
  Video,
  Volume2,
  VolumeX,
  X,
  type LucideIcon
} from "lucide-react";
import {
  ApiError,
  getAiAssetTagSuggestions,
  getAiStatus,
  getAssetTags,
  getAssetTagSuggestions,
  getAssets,
  getScanJobs,
  getTree,
  getWatchStatus,
  logout,
  setAssetTags,
  startScan,
  suggestTags,
  type AssetRecord,
  type AiStatus,
  type MediaTypeFilter,
  type RatingFilter,
  type SortMode,
  type TagRecord,
  type TagSuggestion,
  type LibraryWatchStatus,
  updateAssetRating,
  updateAssetRatingsBatch,
  updateAssetTagsBatch,
  type TreeResponse
} from "../api/client";
import {
  buildAssetListQueryKey,
  canRequestMoreAssets
} from "./gallery-loading";
import {
  aspectOptions,
  normalizeTagDraft,
  readLibraryStateFromUrl,
  sizeOptions,
  writeLibraryStateToUrl,
  type AspectMode,
  type GridSize,
  type ViewMode
} from "./library-state";
import {
  FolderTreePanel,
  folderTreeItemDomId,
  type FolderScanState,
  type FolderTreeItem
} from "./FolderTreePanel";
import { BrandMark } from "./BrandMark";
import { GalleryCardCuration } from "./GalleryCardCuration";
import { RatingSlider } from "./RatingSlider";
import { IconButton } from "./ui/IconButton";

interface AppShellProps {
  onLogout: () => void;
}

const sortOptions: Array<{ label: string; value: SortMode }> = [
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
  { label: "Filename", value: "filename" },
  { label: "Rating", value: "rating" },
  { label: "Random", value: "random" }
];

const mediaFilters: Array<{
  label: string;
  value: MediaTypeFilter;
  icon: LucideIcon;
}> = [
  { label: "All", value: "all", icon: Rows3 },
  { label: "Images", value: "image", icon: Image },
  { label: "Videos", value: "video", icon: Video }
];

const ratingFilters: Array<{
  label: string;
  value: RatingFilter;
  icon: LucideIcon;
}> = [
  { label: "All ratings", value: "all", icon: Rows3 },
  { label: "Favorites", value: "favorites", icon: Heart },
  { label: "Rated", value: "rated", icon: Star },
  { label: "Unrated", value: "unrated", icon: SlidersHorizontal }
];

const ASSET_PAGE_LIMIT = 80;
const GALLERY_GRID_GAP = 12;
const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".avif", ".apng"]);
const FEED_WHEEL_LOCK_MS = 620;
const FEED_WHEEL_THRESHOLD = 28;
const FEED_TOUCH_DISTANCE = 54;
const FEED_TOUCH_VELOCITY = 0.34;
const FEED_PRELOAD_DISTANCE = 1;
const GALLERY_METADATA_STORAGE_KEY = "aether.gallery.metadata-fields";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "aether.sidebar.collapsed";

const galleryMetadataOptions: Array<{
  label: string;
  value: GalleryMetadataField;
}> = [
  { label: "Title", value: "title" },
  { label: "Type", value: "mediaType" },
  { label: "Size", value: "size" },
  { label: "Rating", value: "rating" },
  { label: "Tags", value: "tags" },
  { label: "Heart", value: "favorite" }
];

const defaultGalleryMetadataFields = new Set<GalleryMetadataField>([
  "title",
  "mediaType",
  "size"
]);

type GalleryMetadataField =
  | "title"
  | "mediaType"
  | "size"
  | "rating"
  | "tags"
  | "favorite";
type ControlMenuId = "sort" | "layout" | "filters" | "actions";

type RootTreeNode = TreeResponse["roots"][number];
type FolderTreeNode = TreeResponse["folders"][number];

interface FeedTouchStart {
  x: number;
  y: number;
  index: number;
  time: number;
}

export function AppShell({ onLogout }: AppShellProps) {
  const initialLibraryState = useMemo(() => readLibraryStateFromUrl(), []);
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    initialLibraryState.folderId
  );
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [annotationAssetId, setAnnotationAssetId] = useState<string | null>(
    null
  );
  const [scanState, setScanState] = useState<FolderScanState>("idle");
  const [view, setView] = useState<ViewMode>(initialLibraryState.view);
  const [openControlMenu, setOpenControlMenu] =
    useState<ControlMenuId | null>(null);
  const [gridSize, setGridSize] = useState<GridSize>(
    initialLibraryState.gridSize
  );
  const [galleryMetadataFields, setGalleryMetadataFields] = useState<
    Set<GalleryMetadataField>
  >(() => readGalleryMetadataFields());
  const [aspect, setAspect] = useState<AspectMode>(initialLibraryState.aspect);
  const [sort, setSort] = useState<SortMode>(initialLibraryState.sort);
  const [mediaType, setMediaType] = useState<MediaTypeFilter>(
    initialLibraryState.mediaType
  );
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(
    initialLibraryState.ratingFilter
  );
  const [searchDraft, setSearchDraft] = useState(initialLibraryState.search);
  const [search, setSearch] = useState(initialLibraryState.search);
  const [tagFilterDraft, setTagFilterDraft] = useState(initialLibraryState.tag);
  const [tagFilter, setTagFilter] = useState(initialLibraryState.tag);
  const [filterTagSuggestions, setFilterTagSuggestions] = useState<TagRecord[]>(
    []
  );
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    () => new Set()
  );
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set()
  );
  const [measuredAspectRatios, setMeasuredAspectRatios] = useState<
    Record<string, string>
  >({});
  const [batchTagDraft, setBatchTagDraft] = useState("");
  const [batchTagSuggestions, setBatchTagSuggestions] = useState<TagRecord[]>(
    []
  );
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [savingRatingAssetIds, setSavingRatingAssetIds] = useState<Set<string>>(
    () => new Set()
  );
  const [assetReloadToken, setAssetReloadToken] = useState(0);
  const [watchStatus, setWatchStatus] = useState<LibraryWatchStatus | null>(
    null
  );
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    readSidebarCollapsedPreference
  );
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(
    () =>
      initialLibraryState.view === "feed" &&
      shouldCollapseFeedControlsByDefault()
  );
  const [isFeedChromeHidden, setIsFeedChromeHidden] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const observedScanJobIdRef = useRef<string | null>(null);
  const listQueryKey = useMemo(
    () =>
      buildAssetListQueryKey({
        folderId: selectedFolderId,
        sort,
        mediaType,
        search,
        tagFilter,
        ratingFilter
      }),
    [selectedFolderId, sort, mediaType, search, tagFilter, ratingFilter]
  );
  const listQueryKeyRef = useRef(listQueryKey);
  const hasMoreAssets = assets.length < totalAssets;
  const selectedAssetIdList = useMemo(
    () => [...selectedAssetIds],
    [selectedAssetIds]
  );
  const selectedAssetCount = selectedAssetIdList.length;
  const folderChildrenByParentId = useMemo(
    () => buildFolderChildrenByParentId(tree),
    [tree]
  );
  const folderById = useMemo(() => buildFolderById(tree), [tree]);
  const visibleFolderItems = useMemo(
    () =>
      tree
        ? buildVisibleFolderItems({
            tree,
            folderChildrenByParentId,
            expandedFolderIds
          })
        : [],
    [expandedFolderIds, folderChildrenByParentId, tree]
  );
  const expandableFolderIds = useMemo(
    () => getExpandableFolderIds(tree, folderChildrenByParentId),
    [folderChildrenByParentId, tree]
  );
  const expandedFolderCount = useMemo(
    () =>
      [...expandedFolderIds].filter((folderId) =>
        expandableFolderIds.has(folderId)
      ).length,
    [expandableFolderIds, expandedFolderIds]
  );
  const treeTabStopId =
    visibleFolderItems.find((item) => item.id === selectedFolderId)?.id ??
    visibleFolderItems[0]?.id ??
    null;

  useEffect(() => {
    listQueryKeyRef.current = listQueryKey;
  }, [listQueryKey]);

  useEffect(() => {
    let active = true;

    Promise.all([
      loadTree(),
      getWatchStatus().catch(() => null),
      getScanJobs().catch(() => ({ jobs: [] })),
      getAiStatus().catch(() => null)
    ])
      .then(([, nextWatchStatus, scanJobs, nextAiStatus]) => {
        if (active) {
          setWatchStatus(nextWatchStatus);
          observedScanJobIdRef.current = scanJobs.jobs[0]?.id ?? null;
          setAiStatus(nextAiStatus);
        }
      })
      .catch((caught) => {
        if (active) {
          const message =
            caught instanceof ApiError ? caught.code : "Unable to load library.";
          setError(message);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingTree(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!watchStatus?.enabled) {
      return;
    }

    let active = true;
    const pollInterval = window.setInterval(() => {
      Promise.all([getWatchStatus(), getScanJobs()])
        .then(async ([nextWatchStatus, scanJobs]) => {
          if (!active) {
            return;
          }

          setWatchStatus(nextWatchStatus);
          const latestJob = scanJobs.jobs[0];

          if (!latestJob) {
            return;
          }

          if (latestJob.status === "running") {
            setScanState((current) =>
              current === "starting" ? current : "running"
            );
            return;
          }

          if (latestJob.id !== observedScanJobIdRef.current) {
            observedScanJobIdRef.current = latestJob.id;
            setScanState(latestJob.status);
            await loadTree();

            if (active) {
              setAssetReloadToken((current) => current + 1);
            }
          }
        })
        .catch(() => undefined);
    }, 10_000);

    return () => {
      active = false;
      window.clearInterval(pollInterval);
    };
  }, [watchStatus?.enabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchDraft]);

  useEffect(() => {
    const query = tagFilterDraft.trim();

    if (!query) {
      setFilterTagSuggestions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      suggestTags({ query, limit: 8 })
        .then((response) => {
          if (active) {
            setFilterTagSuggestions(response.tags);
          }
        })
        .catch(() => {
          if (active) {
            setFilterTagSuggestions([]);
          }
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tagFilterDraft]);

  useEffect(() => {
    if (!tree || !selectedFolderId) {
      setAssets([]);
      setTotalAssets(0);
      return;
    }

    let active = true;
    setIsLoadingAssets(true);
    setIsLoadingMore(false);
    setAssetError(null);

    getAssets({
      folderId: selectedFolderId,
      offset: 0,
      limit: ASSET_PAGE_LIMIT,
      sort,
      type: mediaType,
      recursive: true,
      search,
      tag: tagFilter,
      rating: ratingFilter
    })
      .then((response) => {
        if (active) {
          setAssets(response.items);
          setTotalAssets(response.page.total);
        }
      })
      .catch((caught) => {
        if (active) {
          const message =
            caught instanceof ApiError ? caught.code : "Unable to load assets.";
          setAssetError(message);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingAssets(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    tree,
    selectedFolderId,
    sort,
    mediaType,
    search,
    tagFilter,
    ratingFilter,
    assetReloadToken
  ]);

  useEffect(() => {
    setSelectedAssetIds(new Set());
    setBatchError(null);
    setBatchStatus(null);
    setBatchTagDraft("");
    setBatchTagSuggestions([]);
  }, [listQueryKey]);

  useEffect(() => {
    const loadedAssetIds = new Set(assets.map((asset) => asset.id));

    setSelectedAssetIds((current) => {
      let changed = false;
      const next = new Set<string>();

      for (const assetId of current) {
        if (loadedAssetIds.has(assetId)) {
          next.add(assetId);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [assets]);

  useEffect(() => {
    const query = batchTagDraft.trim();

    if (!query || selectedAssetCount === 0) {
      setBatchTagSuggestions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      suggestTags({ query, limit: 8 })
        .then((response) => {
          if (active) {
            setBatchTagSuggestions(response.tags);
          }
        })
        .catch(() => {
          if (active) {
            setBatchTagSuggestions([]);
          }
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [batchTagDraft, selectedAssetCount]);

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
      mediaType,
      ratingFilter,
      search,
      tag: tagFilter
    });
  }, [
    tree,
    selectedFolderId,
    view,
    gridSize,
    aspect,
    sort,
    mediaType,
    ratingFilter,
    search,
    tagFilter
  ]);

  useEffect(() => {
    writeGalleryMetadataFields(galleryMetadataFields);
  }, [galleryMetadataFields]);

  useEffect(() => {
    if (!tree || !selectedFolderId) {
      return;
    }

    setExpandedFolderIds((current) => {
      const next = new Set(current);

      if (current.size === 0) {
        for (const root of tree.roots) {
          next.add(root.folderId);
        }
      }

      for (const ancestorId of folderAncestorIds(selectedFolderId, folderById)) {
        next.add(ancestorId);
      }

      return setsEqual(current, next) ? current : next;
    });
  }, [folderById, selectedFolderId, tree]);

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

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );
  const annotationAsset = useMemo(
    () => assets.find((asset) => asset.id === annotationAssetId) ?? null,
    [annotationAssetId, assets]
  );
  const sortLabel =
    sortOptions.find((option) => option.value === sort)?.label ?? "Newest";
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

  const filterSummary = activeFilterLabels.length
    ? activeFilterLabels.join(" · ")
    : "All media";
  const layoutSummary = `${gridSize} · ${aspect}`;
  const actionSummary = selectedAssetCount
    ? `${selectedAssetCount} selected`
    : `${assets.length} loaded`;

  useEffect(() => {
    if (selectedAssetId && !selectedAsset) {
      setSelectedAssetId(null);
    }

    if (annotationAssetId && !annotationAsset) {
      setAnnotationAssetId(null);
    }
  }, [annotationAsset, annotationAssetId, selectedAsset, selectedAssetId]);

  async function loadTree() {
    const response = await getTree();
    const knownFolderIds = new Set([
      ...response.roots.map((entry) => entry.folderId),
      ...response.folders.map((entry) => entry.id)
    ]);

    setTree(response);
    setSelectedFolderId((current) =>
      current && knownFolderIds.has(current)
        ? current
        : response.roots[0]?.folderId ?? null
    );
  }

  function selectFolder(folderId: string) {
    setSelectedFolderId(folderId);
    setIsSidebarOpen(false);
    setOpenControlMenu(null);
    setAnnotationAssetId(null);
    setIsFeedChromeHidden(false);
    if (view === "feed") {
      setIsTopBarCollapsed(shouldCollapseFeedControlsByDefault());
    }
  }

  function collapseSidebar() {
    setIsSidebarCollapsed(true);
    setIsSidebarOpen(false);
  }

  function expandSidebar() {
    setIsSidebarCollapsed(false);
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

  function toggleFolderExpansion(folderId: string) {
    if (!expandableFolderIds.has(folderId)) {
      return;
    }

    setExpandedFolderIds((current) => {
      const next = new Set(current);

      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }

      return next;
    });
  }

  function expandAllFolders() {
    setExpandedFolderIds(new Set(expandableFolderIds));
  }

  function collapseAllFolders() {
    setExpandedFolderIds(new Set());
  }

  function focusFolderItem(folderId: string) {
    window.requestAnimationFrame(() => {
      document.getElementById(folderTreeItemDomId(folderId))?.focus();
    });
  }

  function handleFolderTreeKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    item: FolderTreeItem
  ) {
    const currentIndex = visibleFolderItems.findIndex(
      (visibleItem) => visibleItem.id === item.id
    );

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const nextItem =
          visibleFolderItems[Math.min(currentIndex + 1, visibleFolderItems.length - 1)];
        if (nextItem) {
          focusFolderItem(nextItem.id);
        }
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const nextItem = visibleFolderItems[Math.max(currentIndex - 1, 0)];
        if (nextItem) {
          focusFolderItem(nextItem.id);
        }
        break;
      }
      case "Home": {
        event.preventDefault();
        const nextItem = visibleFolderItems[0];
        if (nextItem) {
          focusFolderItem(nextItem.id);
        }
        break;
      }
      case "End": {
        event.preventDefault();
        const nextItem = visibleFolderItems[visibleFolderItems.length - 1];
        if (nextItem) {
          focusFolderItem(nextItem.id);
        }
        break;
      }
      case "ArrowRight": {
        if (!item.hasChildren) {
          return;
        }

        event.preventDefault();

        if (!expandedFolderIds.has(item.id)) {
          toggleFolderExpansion(item.id);
          break;
        }

        const child = folderChildrenByParentId.get(item.id)?.[0];
        if (child) {
          focusFolderItem(child.id);
        }
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();

        if (item.hasChildren && expandedFolderIds.has(item.id)) {
          toggleFolderExpansion(item.id);
          break;
        }

        const parentId = item.parentId;
        if (parentId) {
          focusFolderItem(parentId);
        }
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        selectFolder(item.id);
        break;
      }
      default:
        break;
    }
  }

  async function handleLogout() {
    await logout();
    onLogout();
  }

  async function handleScan() {
    setScanState("starting");

    try {
      const scan = await startScan();
      setScanState(scan.status === "running" ? "running" : "idle");
      await waitForScan(scan.jobId);
      await loadTree();
    } catch {
      setScanState("failed");
    }
  }

  async function waitForScan(jobId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(500);
      const { jobs } = await getScanJobs();
      const job = jobs.find((entry) => entry.id === jobId);

      if (!job || job.status === "running") {
        continue;
      }

      setScanState(job.status);
      return;
    }

    setScanState("running");
  }

  function selectAdjacentAsset(direction: -1 | 1) {
    if (!selectedAsset) {
      return;
    }

    const currentIndex = assets.findIndex((asset) => asset.id === selectedAsset.id);
    const nextAsset = assets[currentIndex + direction];

    if (nextAsset) {
      setSelectedAssetId(nextAsset.id);
    }
  }

  function handleAssetUpdated(updatedAsset: AssetRecord) {
    mergeUpdatedAssets([updatedAsset]);
  }

  async function saveAssetRating(
    asset: AssetRecord,
    input: { rating?: number | null; favorite?: boolean }
  ) {
    setAssetError(null);
    setSavingRatingAssetIds((current) => {
      const next = new Set(current);
      next.add(asset.id);
      return next;
    });

    mergeUpdatedAssets([optimisticRatingAsset(asset, input)]);

    try {
      const { asset: updatedAsset } = await updateAssetRating(asset.id, input);
      mergeUpdatedAssets([updatedAsset]);

      if (ratingFilter !== "all" || sort === "rating") {
        setAssetReloadToken((current) => current + 1);
      }
    } catch (caught) {
      mergeUpdatedAssets([asset]);
      setAssetError(ratingActionErrorMessage(caught));
    } finally {
      setSavingRatingAssetIds((current) => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
    }
  }

  function handleAssetTagsUpdated(assetId: string, tags: TagRecord[]) {
    setAssets((currentAssets) =>
      currentAssets.map((asset) =>
        asset.id === assetId ? { ...asset, tags } : asset
      )
    );
  }

  function openAssetFullscreen(assetId: string) {
    setAnnotationAssetId(null);
    setSelectedAssetId(assetId);
  }

  function mergeUpdatedAssets(updatedAssets: AssetRecord[]) {
    const updatedAssetById = new Map(
      updatedAssets.map((asset) => [asset.id, asset])
    );

    setAssets((currentAssets) =>
      currentAssets.map((asset) => updatedAssetById.get(asset.id) ?? asset)
    );
  }

  function toggleAssetSelection(assetId: string) {
    setBatchError(null);
    setBatchStatus(null);
    setSelectedAssetIds((current) => {
      const next = new Set(current);

      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }

      return next;
    });
  }

  function selectLoadedAssets() {
    setBatchError(null);
    setBatchStatus(null);
    setSelectedAssetIds(new Set(assets.map((asset) => asset.id)));
  }

  function clearSelectedAssets() {
    setSelectedAssetIds(new Set());
    setBatchError(null);
    setBatchStatus(null);
    setBatchTagDraft("");
    setBatchTagSuggestions([]);
  }

  const handleMediaDimensionsKnown = useCallback(
    (assetId: string, width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        return;
      }

      const ratio = `${Math.round(width)} / ${Math.round(height)}`;
      setMeasuredAspectRatios((current) =>
        current[assetId] === ratio
          ? current
          : {
              ...current,
              [assetId]: ratio
            }
      );
    },
    []
  );

  async function saveBatchRating(input: {
    rating?: number | null;
    favorite?: boolean;
  }) {
    if (selectedAssetIdList.length === 0) {
      return;
    }

    setIsSavingBatch(true);
    setBatchError(null);
    setBatchStatus(null);

    try {
      const response = await updateAssetRatingsBatch(selectedAssetIdList, input);
      mergeUpdatedAssets(response.assets);
      setBatchStatus(
        `${response.updated} ${selectedMediaLabel(response.updated)} updated.`
      );

      if (ratingFilter !== "all" || sort === "rating") {
        setAssetReloadToken((current) => current + 1);
      }
    } catch (caught) {
      setBatchError(batchActionErrorMessage(caught, "Unable to update selection."));
    } finally {
      setIsSavingBatch(false);
    }
  }

  async function saveBatchTags(tagNames: string[], mode: "add" | "replace") {
    const tags = uniqueTagNames(tagNames);

    if (
      selectedAssetIdList.length === 0 ||
      (mode === "add" && tags.length === 0)
    ) {
      return;
    }

    setIsSavingBatch(true);
    setBatchError(null);
    setBatchStatus(null);

    try {
      const response = await updateAssetTagsBatch(selectedAssetIdList, {
        tags,
        mode
      });
      setBatchTagDraft("");
      setBatchTagSuggestions([]);
      setBatchStatus(batchTagStatus(tags, mode, response.updated));
      setAssetReloadToken((current) => current + 1);
    } catch (caught) {
      setBatchError(batchActionErrorMessage(caught, "Unable to update tags."));
    } finally {
      setIsSavingBatch(false);
    }
  }

  const handleLoadMore = useCallback(async () => {
    const folderId = selectedFolderId;

    if (!folderId || !canRequestMoreAssets({
      folderId,
      isLoadingMore,
      isRequestInFlight: loadMoreInFlightRef.current,
      loadedCount: assets.length,
      totalCount: totalAssets
    })) {
      return;
    }

    const requestQueryKey = listQueryKey;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    setAssetError(null);

    try {
      const response = await getAssets({
        folderId,
        offset: assets.length,
        limit: ASSET_PAGE_LIMIT,
        sort,
        type: mediaType,
        recursive: true,
        search,
        tag: tagFilter,
        rating: ratingFilter
      });

      if (listQueryKeyRef.current !== requestQueryKey) {
        return;
      }

      setAssets((currentAssets) => {
        const existingIds = new Set(currentAssets.map((asset) => asset.id));
        const nextAssets = response.items.filter(
          (asset) => !existingIds.has(asset.id)
        );

        return [...currentAssets, ...nextAssets];
      });
      setTotalAssets(response.page.total);
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.code : "Unable to load more assets.";
      setAssetError(message);
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [
    assets.length,
    isLoadingMore,
    listQueryKey,
    mediaType,
    ratingFilter,
    search,
    selectedFolderId,
    sort,
    tagFilter,
    totalAssets
  ]);

  function applyTagFilter(rawTagName: string) {
    const nextTagFilter = normalizeTagDraft(rawTagName);
    setTagFilter(nextTagFilter);
    setTagFilterDraft(nextTagFilter);
    setFilterTagSuggestions([]);
  }

  function clearTagFilter() {
    setTagFilter("");
    setTagFilterDraft("");
    setFilterTagSuggestions([]);
  }

  function clearLibraryFilters() {
    setMediaType("all");
    setRatingFilter("all");
    clearTagFilter();
  }

  function toggleGalleryMetadataField(field: GalleryMetadataField) {
    setGalleryMetadataFields((current) => {
      const next = new Set(current);

      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }

      return next;
    });
  }

  function clearGalleryMetadataFields() {
    setGalleryMetadataFields(new Set());
  }

  function resetGalleryMetadataFields() {
    setGalleryMetadataFields(new Set(defaultGalleryMetadataFields));
  }

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    function closeSidebarOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    }

    window.addEventListener("keydown", closeSidebarOnEscape);

    return () => {
      window.removeEventListener("keydown", closeSidebarOnEscape);
    };
  }, [isSidebarOpen]);

  useEffect(() => {
    writeSidebarCollapsedPreference(isSidebarCollapsed);
  }, [isSidebarCollapsed]);

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
      <aside
        className="library-sidebar"
        id="library-sidebar"
        aria-label="Library folders"
      >
        <div className="brand-block">
          <BrandMark />
          <div>
            <strong>Aether</strong>
            <span>Private library</span>
          </div>
          <IconButton
            aria-controls="library-sidebar"
            aria-expanded={!isSidebarCollapsed}
            className="desktop-sidebar-collapse"
            icon={PanelLeftClose}
            label="Collapse sidebar"
            title="Hide folders"
            onClick={collapseSidebar}
          />
          <IconButton
            aria-controls="library-sidebar"
            aria-expanded={isSidebarOpen}
            className="mobile-sidebar-close"
            icon={X}
            label="Close folders"
            onClick={() => setIsSidebarOpen(false)}
          />
        </div>

        <FolderTreePanel
          error={error}
          expandableFolderIds={expandableFolderIds}
          expandedFolderCount={expandedFolderCount}
          expandedFolderIds={expandedFolderIds}
          isLoadingTree={isLoadingTree}
          items={tree?.roots.length ? visibleFolderItems : []}
          scanState={scanState}
          selectedFolderId={selectedFolderId}
          treeTabStopId={treeTabStopId}
          watchStatus={watchStatus}
          onCollapseAll={collapseAllFolders}
          onExpandAll={expandAllFolders}
          onFolderKeyDown={handleFolderTreeKeyDown}
          onScan={handleScan}
          onSelectFolder={selectFolder}
          onToggleFolderExpansion={toggleFolderExpansion}
        />

        <div className="sidebar-actions">
          <button className="ghost-action" type="button" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <button
        className="mobile-sidebar-backdrop"
        type="button"
        aria-label="Close folders"
        tabIndex={isSidebarOpen ? 0 : -1}
        onClick={() => setIsSidebarOpen(false)}
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
          <div className="feed-collapsed-topbar" aria-label="Feed controls">
            <IconButton
              className="feed-floating-action"
              icon={Menu}
              label="Open folders"
              title="Folders"
              onClick={() => setIsSidebarOpen(true)}
            />
            <button
              className="feed-collapsed-title"
              type="button"
              aria-label="Show feed controls"
              aria-expanded="false"
              onClick={() => setIsTopBarCollapsed(false)}
            >
              <span>{selectedLabel}</span>
              <small>
                {totalAssets} {totalAssets === 1 ? "item" : "items"}
              </small>
            </button>
            <IconButton
              aria-expanded="false"
              className="feed-floating-action"
              icon={SlidersHorizontal}
              label="Show controls"
              title="Controls"
              onClick={() => setIsTopBarCollapsed(false)}
            />
            <IconButton
              className="feed-floating-action"
              icon={Grid3X3}
              label="Gallery view"
              onClick={() => switchView("gallery")}
            />
          </div>
        ) : null}

        <header className="library-toolbar">
          <IconButton
            aria-controls="library-sidebar"
            aria-expanded={isSidebarOpen}
            className="mobile-sidebar-toggle"
            icon={Menu}
            label="Open folders"
            title="Folders"
            onClick={() => setIsSidebarOpen(true)}
          />
          <IconButton
            aria-controls="library-sidebar"
            aria-expanded={!isSidebarCollapsed}
            className="desktop-sidebar-expand"
            icon={PanelLeftOpen}
            label="Expand sidebar"
            title="Show folders"
            onClick={expandSidebar}
          />

          <div className="view-heading">
            <h1>{selectedLabel}</h1>
            <p>
              {totalAssets} {totalAssets === 1 ? "item" : "items"} indexed
            </p>
          </div>

          <div className="search-box">
            <Search size={17} />
            <input
              value={searchDraft}
              placeholder="Search memories"
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>

          <div className="toolbar-group" aria-label="View mode">
            <IconButton
              className="segmented view-mode-toggle"
              icon={view === "gallery" ? GalleryHorizontalEnd : Grid3X3}
              iconSize={17}
              label={
                view === "gallery" ? "Switch to feed view" : "Switch to gallery view"
              }
              title={view === "gallery" ? "Feed view" : "Gallery view"}
              onClick={() => switchView(view === "gallery" ? "feed" : "gallery")}
            />
          </div>
        </header>

        <section className="control-strip" aria-label="Library controls">
          {view === "feed" ? (
            <button
              className="ghost-action mobile-feed-collapse-control"
              type="button"
              aria-label="Hide feed controls"
              title="Hide controls"
              aria-expanded="true"
              onClick={() => setIsTopBarCollapsed(true)}
            >
              <ChevronUp size={16} />
              <span>Hide</span>
            </button>
          ) : null}

          <ToolbarMenu
            icon={Rows3}
            isOpen={openControlMenu === "sort"}
            label="Sort"
            menuId="sort"
            valueLabel={sortLabel}
            onOpenChange={(nextIsOpen) =>
              setOpenControlMenu(nextIsOpen ? "sort" : null)
            }
          >
            <div className="menu-section">
              <div className="menu-section-title">Sort by</div>
              <div
                className="menu-option-list"
                role="radiogroup"
                aria-label="Sort by"
              >
                {sortOptions.map((option) => (
                  <button
                    className={
                      sort === option.value ? "menu-option active" : "menu-option"
                    }
                    type="button"
                    key={option.value}
                    role="radio"
                    aria-checked={sort === option.value}
                    onClick={() => setSort(option.value)}
                  >
                    <span>{option.label}</span>
                    <span className="menu-check" aria-hidden="true">
                      {sort === option.value ? <CheckCircle2 size={15} /> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </ToolbarMenu>

          <ToolbarMenu
            className="layout-control"
            icon={Grid3X3}
            isOpen={openControlMenu === "layout"}
            label="Layout"
            menuId="layout"
            valueLabel={layoutSummary}
            onOpenChange={(nextIsOpen) =>
              setOpenControlMenu(nextIsOpen ? "layout" : null)
            }
          >
            <div className="menu-section">
              <div className="menu-section-heading">
                <div className="menu-section-title">Grid size</div>
                <small>{gridSize}</small>
              </div>
              <div
                className="menu-choice-grid grid-size-choice-grid"
                role="radiogroup"
                aria-label="Grid size"
              >
                {sizeOptions.map((option) => (
                  <button
                    className={
                      gridSize === option ? "menu-choice active" : "menu-choice"
                    }
                    type="button"
                    key={option}
                    role="radio"
                    aria-checked={gridSize === option}
                    onClick={() => setGridSize(option)}
                  >
                    <span>{option}</span>
                    <span className="menu-check" aria-hidden="true">
                      {gridSize === option ? <CheckCircle2 size={14} /> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="menu-section">
              <div className="menu-section-heading">
                <div className="menu-section-title">Aspect ratio</div>
                <small>{aspect}</small>
              </div>
              <div
                className="menu-choice-grid aspect-choice-grid"
                role="radiogroup"
                aria-label="Aspect ratio"
              >
                {aspectOptions.map((option) => (
                  <button
                    className={
                      aspect === option ? "menu-choice active" : "menu-choice"
                    }
                    type="button"
                    key={option}
                    role="radio"
                    aria-checked={aspect === option}
                    onClick={() => setAspect(option)}
                  >
                    <span>{option}</span>
                    <span className="menu-check" aria-hidden="true">
                      {aspect === option ? <CheckCircle2 size={14} /> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <GalleryMetadataControls
              fields={galleryMetadataFields}
              onClear={clearGalleryMetadataFields}
              onReset={resetGalleryMetadataFields}
              onToggle={toggleGalleryMetadataField}
            />
          </ToolbarMenu>

          <ToolbarMenu
            align="end"
            className="filters-control"
            icon={SlidersHorizontal}
            isOpen={openControlMenu === "filters"}
            label="Filters"
            menuId="filters"
            valueLabel={filterSummary}
            onOpenChange={(nextIsOpen) =>
              setOpenControlMenu(nextIsOpen ? "filters" : null)
            }
          >
            {activeFilterLabels.length ? (
              <div className="menu-section active-filter-section">
                <div className="menu-section-heading">
                  <div className="menu-section-title">Active</div>
                  <small>{activeFilterLabels.length}</small>
                </div>
                <div className="active-filter-summary" aria-label="Active filters">
                  {mediaType !== "all" ? (
                    <button
                      type="button"
                      className="active-filter-token"
                      aria-label={`Clear ${mediaTypeLabel} filter`}
                      onClick={() => setMediaType("all")}
                    >
                      <span>{mediaTypeLabel}</span>
                      <X size={13} />
                    </button>
                  ) : null}
                  {ratingFilter !== "all" ? (
                    <button
                      type="button"
                      className="active-filter-token"
                      aria-label={`Clear ${ratingFilterLabel} filter`}
                      onClick={() => setRatingFilter("all")}
                    >
                      <span>{ratingFilterLabel}</span>
                      <X size={13} />
                    </button>
                  ) : null}
                  {tagFilter ? (
                    <button
                      type="button"
                      className="active-filter-token"
                      aria-label={`Clear tag filter ${tagFilter}`}
                      onClick={clearTagFilter}
                    >
                      <span>#{tagFilter}</span>
                      <X size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="menu-section">
              <div className="menu-section-heading">
                <div className="menu-section-title">Media</div>
                <small>{mediaTypeLabel}</small>
              </div>
              <div
                className="filter-option-list"
                role="radiogroup"
                aria-label="Media filters"
              >
                {mediaFilters.map((filter) => {
                  const Icon = filter.icon;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mediaType === filter.value}
                      className={
                        mediaType === filter.value
                          ? "filter-option active"
                          : "filter-option"
                      }
                      key={filter.value}
                      onClick={() => setMediaType(filter.value)}
                    >
                      <span className="filter-option-leading">
                        <span className="filter-option-icon" aria-hidden="true">
                          <Icon size={14} />
                        </span>
                        <span className="filter-option-label">{filter.label}</span>
                      </span>
                      <span className="filter-option-state" aria-hidden="true">
                        {mediaType === filter.value ? <Check size={13} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="menu-section">
              <div className="menu-section-heading">
                <div className="menu-section-title">Rating</div>
                <small>{ratingFilterLabel}</small>
              </div>
              <div
                className="filter-option-list"
                role="radiogroup"
                aria-label="Rating filters"
              >
                {ratingFilters.map((filter) => {
                  const Icon = filter.icon;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={ratingFilter === filter.value}
                      className={
                        ratingFilter === filter.value
                          ? "filter-option active"
                          : "filter-option"
                      }
                      key={filter.value}
                      onClick={() => setRatingFilter(filter.value)}
                    >
                      <span className="filter-option-leading">
                        <span className="filter-option-icon" aria-hidden="true">
                          <Icon size={14} />
                        </span>
                        <span className="filter-option-label">{filter.label}</span>
                      </span>
                      <span className="filter-option-state" aria-hidden="true">
                        {ratingFilter === filter.value ? <Check size={13} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="menu-section tag-filter-section">
              <div className="menu-section-heading">
                <div className="menu-section-title">Tag</div>
                <small>{tagFilter ? `#${tagFilter}` : "Any tag"}</small>
              </div>
              {tagFilter ? (
                <button
                  type="button"
                  className="active-filter-token selected-tag-token"
                  aria-label={`Clear tag filter ${tagFilter}`}
                  onClick={clearTagFilter}
                >
                  <span>#{tagFilter}</span>
                  <X size={13} />
                </button>
              ) : null}
              <div className="tag-filter-control menu-field">
                <label htmlFor="library-tag-filter-input">Find tag</label>
                <div className="filter-input-wrap">
                  <Tags size={15} />
                  <input
                    id="library-tag-filter-input"
                    value={tagFilterDraft}
                    placeholder="Any tag"
                    maxLength={48}
                    onChange={(event) => setTagFilterDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyTagFilter(tagFilterDraft);
                      }
                    }}
                  />
                  {tagFilter ? (
                    <button
                      type="button"
                      aria-label="Clear tag filter"
                      title="Clear tag filter"
                      onClick={clearTagFilter}
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </div>
                {filterTagSuggestions.length ? (
                  <div className="filter-suggestions">
                    {filterTagSuggestions.map((tag) => (
                      <button
                        type="button"
                        key={tag.id}
                        onClick={() => applyTagFilter(tag.displayName)}
                      >
                        {tag.displayName}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="control-menu-footer">
              <button
                className="menu-secondary-action"
                type="button"
                disabled={!activeFilterLabels.length}
                onClick={clearLibraryFilters}
              >
                Clear all
              </button>
              <button
                className="menu-primary-action"
                type="button"
                onClick={() => setOpenControlMenu(null)}
              >
                Done
              </button>
            </div>
          </ToolbarMenu>

          <ToolbarMenu
            align="end"
            className="actions-control"
            icon={CheckCircle2}
            isOpen={openControlMenu === "actions"}
            label="Actions"
            menuId="actions"
            valueLabel={actionSummary}
            onOpenChange={(nextIsOpen) =>
              setOpenControlMenu(nextIsOpen ? "actions" : null)
            }
          >
            <div className="menu-section">
              <div className="menu-section-heading">
                <div className="menu-section-title">Selection</div>
                <small>{actionSummary}</small>
              </div>
              <div className="menu-option-list action-menu-list">
                <button
                  className="menu-option action-menu-option"
                  type="button"
                  disabled={assets.length === 0 || isLoadingAssets}
                  onClick={() => {
                    selectLoadedAssets();
                    setOpenControlMenu(null);
                  }}
                >
                  <span className="action-menu-label">
                    <CheckCircle2 size={14} />
                    <span>Select loaded</span>
                  </span>
                  <span className="action-menu-value">{assets.length}</span>
                </button>
                <button
                  className="menu-option action-menu-option"
                  type="button"
                  disabled={selectedAssetCount === 0 || isSavingBatch}
                  onClick={() => {
                    clearSelectedAssets();
                    setOpenControlMenu(null);
                  }}
                >
                  <span className="action-menu-label">
                    <X size={14} />
                    <span>Clear selection</span>
                  </span>
                  <span className="action-menu-value">
                    {selectedAssetCount || "None"}
                  </span>
                </button>
              </div>
            </div>
          </ToolbarMenu>
        </section>

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

      {view === "feed" && annotationAsset ? (
        <FeedAnnotationDrawer
          aiStatus={aiStatus}
          asset={annotationAsset}
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
          onClose={() => setSelectedAssetId(null)}
          onNext={() => selectAdjacentAsset(1)}
          onPrevious={() => selectAdjacentAsset(-1)}
        />
      ) : null}
    </div>
  );
}

function BatchActionsBar({
  selectedCount,
  tagDraft,
  tagSuggestions,
  isSaving,
  status,
  error,
  onClear,
  onRate,
  onClearRating,
  onFavorite,
  onUnfavorite,
  onTagDraftChange,
  onAddTag,
  onReplaceTags,
  onClearTags,
  onUseSuggestion
}: {
  selectedCount: number;
  tagDraft: string;
  tagSuggestions: TagRecord[];
  isSaving: boolean;
  status: string | null;
  error: string | null;
  onClear: () => void;
  onRate: (rating: number) => void;
  onClearRating: () => void;
  onFavorite: () => void;
  onUnfavorite: () => void;
  onTagDraftChange: (value: string) => void;
  onAddTag: () => void;
  onReplaceTags: () => void;
  onClearTags: () => void;
  onUseSuggestion: (tagName: string) => void;
}) {
  const [batchRatingValue, setBatchRatingValue] = useState(5);

  return (
    <section className="batch-actions-bar" aria-label="Selected media actions">
      <div className="batch-summary">
        <strong>{selectedCount}</strong>
        <span>{selectedMediaLabel(selectedCount)} selected</span>
      </div>

      <div className="batch-action-group batch-rating-group">
        <span className="batch-group-label">Rating</span>
        <div className="batch-rating-actions" aria-label="Batch rating">
          <RatingSlider
            className="batch-rating-slider"
            density="batch"
            disabled={isSaving}
            label="Set rating for selected media"
            value={batchRatingValue}
            onCommit={(rating) => {
              setBatchRatingValue(rating);
              onRate(rating);
            }}
          />
          <button
            className="ghost-action compact-action"
            type="button"
            disabled={isSaving}
            onClick={onClearRating}
          >
            Clear rating
          </button>
          <button
            className="favorite-button"
            type="button"
            aria-label="Favorite selected media"
            title="Favorite selected"
            disabled={isSaving}
            onClick={onFavorite}
          >
            <Heart size={17} />
          </button>
          <button
            className="favorite-button"
            type="button"
            aria-label="Remove favorite from selected media"
            title="Unfavorite selected"
            disabled={isSaving}
            onClick={onUnfavorite}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="batch-action-group batch-tag-group">
        <span className="batch-group-label">Tags</span>
        <div className="batch-tag-row">
          <div className="batch-tag-control">
            <form
              className="batch-tag-entry"
              aria-label="Tag selected media"
              onSubmit={(event) => {
                event.preventDefault();
                onAddTag();
              }}
            >
              <Tags size={15} />
              <input
                value={tagDraft}
                maxLength={48}
                placeholder="Tag selection"
                disabled={isSaving}
                onChange={(event) => onTagDraftChange(event.target.value)}
              />
              <button
                type="submit"
                aria-label="Add tag to selected media"
                title="Add tag"
                disabled={isSaving || !tagDraft.trim()}
              >
                <Plus size={15} />
              </button>
            </form>
            {tagSuggestions.length ? (
              <div className="batch-tag-suggestions">
                {tagSuggestions.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    disabled={isSaving}
                    onClick={() => onUseSuggestion(tag.displayName)}
                  >
                    {tag.displayName}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="batch-tag-actions" aria-label="Batch tag actions">
            <button
              className="ghost-action compact-action"
              type="button"
              disabled={isSaving || !tagDraft.trim()}
              onClick={onReplaceTags}
            >
              Replace tags
            </button>
            <button
              className="ghost-action compact-action"
              type="button"
              disabled={isSaving}
              onClick={onClearTags}
            >
              Clear tags
            </button>
          </div>
        </div>
      </div>

      {status || error ? (
        <span
          className={error ? "batch-message error" : "batch-message"}
          role={error ? "alert" : "status"}
        >
          {error ?? status}
        </span>
      ) : null}

      <button
        className="icon-button batch-clear"
        type="button"
        aria-label="Clear selection"
        title="Clear selection"
        disabled={isSaving}
        onClick={onClear}
      >
        <X size={17} />
      </button>
    </section>
  );
}

function ToolbarMenu({
  align = "start",
  children,
  className,
  icon: Icon,
  isOpen,
  label,
  menuId,
  valueLabel,
  onOpenChange
}: {
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
  icon: LucideIcon;
  isOpen: boolean;
  label: string;
  menuId: ControlMenuId;
  valueLabel: string;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const panelId = `control-menu-${menuId}`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      onOpenChange(false);
    }

    function closeOnFocusOutside(event: FocusEvent) {
      const target = event.target;

      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      onOpenChange(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("focusin", closeOnFocusOutside);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("focusin", closeOnFocusOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onOpenChange]);

  return (
    <details
      className={[
        "control-menu",
        align === "end" ? "align-end" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      open={isOpen}
      ref={menuRef}
    >
      <summary
        className="control-menu-trigger"
        aria-label={`${label}: ${valueLabel}`}
        aria-controls={panelId}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.preventDefault();
          onOpenChange(!isOpen);
        }}
      >
        <Icon size={15} />
        <span className="control-menu-text">
          <span className="control-menu-label">{label}</span>
          <small className="control-menu-value">{valueLabel}</small>
        </span>
        <ChevronDown size={14} className="control-menu-chevron" />
      </summary>
      <div
        className="control-menu-panel"
        id={panelId}
        role="group"
        aria-label={label}
      >
        <div className="control-menu-panel-header">
          <span className="control-menu-panel-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span className="control-menu-panel-title">
            <strong>{label}</strong>
            <small>{valueLabel}</small>
          </span>
        </div>
        {children}
      </div>
    </details>
  );
}

function GalleryMetadataControls({
  fields,
  onClear,
  onReset,
  onToggle
}: {
  fields: ReadonlySet<GalleryMetadataField>;
  onClear: () => void;
  onReset: () => void;
  onToggle: (field: GalleryMetadataField) => void;
}) {
  const selectedCount = fields.size;

  return (
    <div className="menu-section metadata-field-section">
      <div className="menu-section-heading">
        <div className="menu-section-title">Card info</div>
        <small>{selectedCount ? `${selectedCount} shown` : "None"}</small>
      </div>
      <div className="metadata-field-list">
        {galleryMetadataOptions.map((option) => (
          <label
            className={
              fields.has(option.value)
                ? "metadata-field-option active"
                : "metadata-field-option"
            }
            key={option.value}
          >
            <input
              type="checkbox"
              checked={fields.has(option.value)}
              onChange={() => onToggle(option.value)}
            />
            <span className="metadata-checkbox" aria-hidden="true">
              {fields.has(option.value) ? <Check size={13} /> : null}
            </span>
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className="metadata-settings-actions">
        <button type="button" onClick={onClear}>
          None
        </button>
        <button type="button" onClick={onReset}>
          Default
        </button>
      </div>
    </div>
  );
}

function GalleryGrid({
  assets,
  aspect,
  metadataFields,
  gridSize,
  hasMore,
  isLoading,
  isLoadingMore,
  loadMoreRef,
  measuredAspectRatios,
  resetKey,
  savingRatingAssetIds,
  selectedAssetIds,
  onLoadMore,
  onFavoriteAsset,
  onMediaDimensionsKnown,
  onRateAsset,
  onSelectAsset,
  onToggleSelection
}: {
  assets: AssetRecord[];
  aspect: AspectMode;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  measuredAspectRatios: Record<string, string>;
  resetKey: string;
  savingRatingAssetIds: ReadonlySet<string>;
  selectedAssetIds: ReadonlySet<string>;
  onLoadMore: () => void;
  onFavoriteAsset: (asset: AssetRecord, favorite: boolean) => void;
  onMediaDimensionsKnown: (assetId: string, width: number, height: number) => void;
  onRateAsset: (asset: AssetRecord, rating: number | null) => void;
  onSelectAsset: (assetId: string) => void;
  onToggleSelection: (assetId: string) => void;
}) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const minTileWidth = galleryMinTileWidth(gridSize);
  const columnCount = galleryColumnCount(containerWidth, minTileWidth);
  const rows = useMemo(
    () => chunkAssetsIntoRows(assets, columnCount),
    [assets, columnCount]
  );
  const estimateRowSize = useCallback(
    () =>
      estimateGalleryRowHeight({
        aspect,
        columnCount,
        containerWidth,
        metadataFields,
        minTileWidth
      }),
    [aspect, columnCount, containerWidth, metadataFields, minTileWidth]
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: estimateRowSize,
    getItemKey: (index) => rows[index]?.[0]?.id ?? index,
    gap: GALLERY_GRID_GAP,
    overscan: 7
  });

  useEffect(() => {
    const observedElement = scrollParentRef.current;

    if (!observedElement) {
      return;
    }

    const element: HTMLDivElement = observedElement;

    function updateWidth() {
      setContainerWidth(element.clientWidth);
    }

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);

      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    scrollParentRef.current?.scrollTo({ top: 0 });
    rowVirtualizer.scrollToOffset(0);
  }, [aspect, gridSize, metadataFields, resetKey]);

  useAutoLoadSentinel({
    enabled: hasMore && !isLoading && !isLoadingMore,
    onLoadMore,
    rootMargin: "380px 0px",
    rootRef: scrollParentRef,
    targetRef: loadMoreRef
  });

  if (isLoading) {
    return (
      <section
        className="gallery-viewport"
        ref={scrollParentRef}
        aria-label="Gallery view"
      >
        <div className="gallery-grid" data-size={gridSize} data-aspect={aspect}>
          {Array.from({ length: 18 }).map((_, index) => (
            <article className="media-tile" key={index}>
              <div className="media-skeleton" />
              <div className="tile-info">
                <div className="tile-meta">
                  <span>Loading</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (assets.length === 0) {
    return (
      <section
        className="gallery-viewport"
        ref={scrollParentRef}
        aria-label="Gallery view"
      >
        <div className="empty-library">
          <SlidersHorizontal size={22} />
          <strong>No indexed media in this folder</strong>
          <span>Run a scan after adding images or videos to the local media root.</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="gallery-viewport"
      ref={scrollParentRef}
      aria-label="Gallery view"
    >
      <div
        className="virtual-gallery"
        data-aspect={aspect}
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowAssets = rows[virtualRow.index] ?? [];

          return (
            <div
              className="virtual-gallery-row"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              {rowAssets.map((asset) => {
                const isSelected = selectedAssetIds.has(asset.id);
                const secondaryMetadata = gallerySecondaryMetadata(
                  asset,
                  metadataFields
                );
                const tagBadges = metadataFields.has("tags")
                  ? asset.tags.slice(0, 2)
                  : [];
                const hiddenTagCount = metadataFields.has("tags")
                  ? Math.max(0, asset.tags.length - tagBadges.length)
                  : 0;
                const hasTitle = metadataFields.has("title");
                const hasSecondaryMetadata = secondaryMetadata.length > 0;
                const showRatingControl = metadataFields.has("rating");
                const showFavoriteControl = metadataFields.has("favorite");
                const hasCuration =
                  showRatingControl ||
                  showFavoriteControl ||
                  tagBadges.length > 0 ||
                  hiddenTagCount > 0;
                const hasCardInfo =
                  hasTitle || hasSecondaryMetadata || hasCuration;
                const isSavingRating = savingRatingAssetIds.has(asset.id);

                return (
                  <article
                    className={isSelected ? "media-tile selected" : "media-tile"}
                    key={asset.id}
                    style={mediaTileStyle(asset, aspect, measuredAspectRatios)}
                  >
                    <label className="tile-select" title="Select media">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        aria-label={`Select ${asset.name}`}
                        onChange={() => onToggleSelection(asset.id)}
                      />
                      <span className="tile-select-box" aria-hidden="true">
                        {isSelected ? <Check size={13} /> : null}
                      </span>
                    </label>
                    <button
                      className="media-preview-button"
                      type="button"
                      onClick={() => onSelectAsset(asset.id)}
                    >
                      <MediaPreview
                        asset={asset}
                        onDimensionsKnown={onMediaDimensionsKnown}
                      />
                    </button>
                    <a
                      className="icon-link tile-download"
                      href={downloadUrl(asset.id)}
                      aria-label="Download media"
                      title="Download"
                    >
                      <Download size={15} />
                    </a>
                    {hasCardInfo ? (
                      <div className="tile-info">
                        {hasTitle ? (
                          <div className="tile-meta">
                            <span title={asset.name}>{asset.name}</span>
                          </div>
                        ) : null}
                        {hasSecondaryMetadata ? (
                          <div className="tile-submeta">
                            {secondaryMetadata.map((entry) => (
                              <span key={entry}>{entry}</span>
                            ))}
                          </div>
                        ) : null}
                        {hasCuration ? (
                          <GalleryCardCuration
                            asset={asset}
                            disabled={isSavingRating}
                            hiddenTagCount={hiddenTagCount}
                            showFavorite={showFavoriteControl}
                            showRating={showRatingControl}
                            tags={tagBadges}
                            onFavoriteChange={onFavoriteAsset}
                            onRatingChange={onRateAsset}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
      {hasMore ? (
        <div className="load-more-row" ref={loadMoreRef}>
          <button
            className="ghost-action"
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Loading" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function FeedPreview({
  assets,
  isLoading,
  isLoadingMore,
  hasMore,
  loadMoreRef,
  isFeedChromeHidden,
  isPlaybackPaused,
  syncedAssetId,
  onLoadMore,
  onFeedChromeHiddenChange,
  onOpenAnnotations,
  onOpenAsset
}: {
  assets: AssetRecord[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  isFeedChromeHidden: boolean;
  isPlaybackPaused: boolean;
  syncedAssetId: string | null;
  onLoadMore: () => void;
  onFeedChromeHiddenChange: (isHidden: boolean) => void;
  onOpenAnnotations: (assetId: string) => void;
  onOpenAsset: (assetId: string) => void;
}) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const feedScrollFrameRef = useRef<number | null>(null);
  const wheelLockUntilRef = useRef(0);
  const touchStartRef = useRef<FeedTouchStart | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFeedMuted, setIsFeedMuted] = useState(false);
  const firstAssetId = assets[0]?.id ?? "";

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, assets.length);
  }, [assets.length]);

  useEffect(() => {
    setActiveIndex(0);
    feedRef.current?.scrollTo({ top: 0 });
  }, [firstAssetId]);

  useEffect(() => {
    if (!syncedAssetId) {
      return;
    }

    const syncedIndex = assets.findIndex((asset) => asset.id === syncedAssetId);

    if (syncedIndex < 0) {
      return;
    }

    const feedElement = feedRef.current;
    const syncedItem = itemRefs.current[syncedIndex];
    setActiveIndex(syncedIndex);

    if (!feedElement || !syncedItem) {
      return;
    }

    const targetTop = feedItemTop(feedElement, syncedItem);

    if (Math.abs(feedElement.scrollTop - targetTop) <= 1) {
      return;
    }

    feedElement.scrollTo({ top: targetTop, behavior: "auto" });
  }, [assets, syncedAssetId]);

  useEffect(
    () => () => {
      if (feedScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(feedScrollFrameRef.current);
      }
    },
    []
  );

  const syncActiveFeedIndex = useCallback(() => {
    setActiveIndex(nearestFeedIndexFromScroll(feedRef.current, itemRefs.current));
  }, []);

  const handleFeedScroll = useCallback(() => {
    if (feedScrollFrameRef.current !== null) {
      return;
    }

    feedScrollFrameRef.current = window.requestAnimationFrame(() => {
      feedScrollFrameRef.current = null;
      syncActiveFeedIndex();
    });
  }, [syncActiveFeedIndex]);

  const scrollToFeedItem = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, assets.length - 1));
      const nextItem = itemRefs.current[nextIndex];
      const feedElement = feedRef.current;

      if (!nextItem || !feedElement) {
        return;
      }

      feedElement.scrollTo({
        top: feedItemTop(feedElement, nextItem),
        behavior: "smooth"
      });
      setActiveIndex(nextIndex);

      if (hasMore && nextIndex >= assets.length - 2) {
        onLoadMore();
      }
    },
    [assets.length, hasMore, onLoadMore]
  );

  const toggleFeedChrome = useCallback(() => {
    onFeedChromeHiddenChange(!isFeedChromeHidden);
  }, [isFeedChromeHidden, onFeedChromeHiddenChange]);

  const handleAudibleAutoplayBlocked = useCallback(() => {
    setIsFeedMuted(true);
  }, []);

  const pageFeedBy = useCallback(
    (delta: number) => {
      const currentIndex = nearestFeedIndexFromScroll(
        feedRef.current,
        itemRefs.current
      );
      scrollToFeedItem(currentIndex + delta);
    },
    [scrollToFeedItem]
  );

  const handleFeedKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }

      const currentIndex = nearestFeedIndexFromScroll(
        feedRef.current,
        itemRefs.current
      );

      switch (event.key) {
        case "ArrowDown":
        case "PageDown":
        case " ":
          event.preventDefault();
          scrollToFeedItem(currentIndex + 1);
          break;
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          scrollToFeedItem(currentIndex - 1);
          break;
        case "Home":
          event.preventDefault();
          scrollToFeedItem(0);
          break;
        case "End":
          event.preventDefault();
          scrollToFeedItem(assets.length - 1);
          break;
        default:
          break;
      }
    },
    [assets.length, scrollToFeedItem]
  );

  const handleFeedWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (
        isInteractiveTarget(event.target) ||
        assets.length === 0 ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
        Math.abs(event.deltaY) < FEED_WHEEL_THRESHOLD
      ) {
        return;
      }

      event.preventDefault();
      const now = window.performance.now();

      if (now < wheelLockUntilRef.current) {
        return;
      }

      wheelLockUntilRef.current = now + FEED_WHEEL_LOCK_MS;
      pageFeedBy(event.deltaY > 0 ? 1 : -1);
    },
    [assets.length, pageFeedBy]
  );

  const handleFeedTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const touch = event.changedTouches[0];

      if (!touch || isInteractiveTarget(event.target)) {
        touchStartRef.current = null;
        return;
      }

      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        index: nearestFeedIndexFromScroll(feedRef.current, itemRefs.current),
        time: window.performance.now()
      };
    },
    []
  );

  const handleFeedTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      touchStartRef.current = null;

      if (!start || !touch || assets.length === 0) {
        return;
      }

      const deltaX = touch.clientX - start.x;
      const deltaY = start.y - touch.clientY;
      const elapsedMs = Math.max(1, window.performance.now() - start.time);
      const velocity = Math.abs(deltaY) / elapsedMs;
      const isVerticalGesture = Math.abs(deltaY) > Math.abs(deltaX) * 1.2;
      const hasIntent =
        Math.abs(deltaY) >= FEED_TOUCH_DISTANCE ||
        (Math.abs(deltaY) >= 32 && velocity >= FEED_TOUCH_VELOCITY);

      if (!isVerticalGesture || !hasIntent) {
        return;
      }

      scrollToFeedItem(start.index + (deltaY > 0 ? 1 : -1));
    },
    [assets.length, scrollToFeedItem]
  );

  useAutoLoadSentinel({
    enabled: hasMore && !isLoading && !isLoadingMore,
    onLoadMore,
    rootMargin: "620px 0px",
    rootRef: feedRef,
    targetRef: loadMoreRef
  });

  if (isLoading) {
    return (
      <section className="feed-shell" aria-label="Feed view">
        <div className="feed-view">
          <article className="feed-item">
            <div className="feed-frame">
              <div className="media-skeleton" />
            </div>
          </article>
        </div>
      </section>
    );
  }

  if (assets.length === 0) {
    return (
      <section className="empty-library">
        <GalleryHorizontalEnd size={22} />
        <strong>No media in this feed</strong>
        <span>Adjust filters or run a scan after adding local media.</span>
      </section>
    );
  }

  return (
    <section
      className="feed-shell"
      aria-label="Feed view"
      tabIndex={0}
      onKeyDown={handleFeedKeyDown}
      onTouchEnd={handleFeedTouchEnd}
      onTouchStart={handleFeedTouchStart}
      onWheel={handleFeedWheel}
    >
      <div className="feed-view" ref={feedRef} onScroll={handleFeedScroll}>
        {assets.map((asset, index) => {
          return (
            <article
              className={
                isFeedChromeHidden ? "feed-item details-hidden" : "feed-item"
              }
              data-feed-index={index}
              key={asset.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
            >
              <div className="feed-frame">
                <button
                  className="media-preview-button"
                  type="button"
                  aria-label={`${
                    isFeedChromeHidden ? "Show" : "Hide"
                  } feed controls and details`}
                  title={isFeedChromeHidden ? "Show details" : "Hide details"}
                  onClick={toggleFeedChrome}
                >
                  <MediaPreview
                    asset={asset}
                    muted={isFeedMuted}
                    onAudibleAutoplayBlocked={handleAudibleAutoplayBlocked}
                    playbackPaused={isPlaybackPaused}
                    preloadPreview={
                      asset.mediaType === "video" &&
                      Math.abs(index - activeIndex) <= FEED_PRELOAD_DISTANCE
                    }
                    tall
                  />
                </button>
                <div className="feed-meta">
                  <button
                    className="feed-meta-button"
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`Open details for ${asset.name}`}
                    title="Open details"
                    onClick={() => onOpenAnnotations(asset.id)}
                  >
                    <span>{asset.mediaType}</span>
                    <strong title={asset.name}>
                      {asset.name}
                    </strong>
                  </button>
                </div>
                <div className="feed-actions">
                  {asset.mediaType === "video" ? (
                    <IconButton
                      aria-pressed={!isFeedMuted}
                      className="feed-sound-action"
                      icon={isFeedMuted ? VolumeX : Volume2}
                      iconSize={17}
                      label={isFeedMuted ? "Unmute feed sound" : "Mute feed sound"}
                      title={isFeedMuted ? "Sound off" : "Sound on"}
                      onClick={() => setIsFeedMuted((current) => !current)}
                    />
                  ) : null}
                  <IconButton
                    className="feed-expand-action"
                    icon={Maximize2}
                    iconSize={17}
                    label={`Open ${asset.name} fullscreen`}
                    title="Fullscreen"
                    onClick={() => onOpenAsset(asset.id)}
                  />
                </div>
              </div>
              {hasMore && index === assets.length - 1 ? (
                <div className="feed-load-sentinel" ref={loadMoreRef} />
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="feed-nav-rail" aria-label="Feed navigation">
        <button
          className="feed-nav-button"
          type="button"
          aria-label="Previous feed item"
          title="Previous"
          disabled={activeIndex <= 0}
          onClick={() =>
            scrollToFeedItem(
              nearestFeedIndexFromScroll(feedRef.current, itemRefs.current) - 1
            )
          }
        >
          <ChevronUp size={20} />
        </button>
        <button
          className="feed-nav-button"
          type="button"
          aria-label="Next feed item"
          title="Next"
          disabled={activeIndex >= assets.length - 1 && !hasMore}
          onClick={() =>
            scrollToFeedItem(
              nearestFeedIndexFromScroll(feedRef.current, itemRefs.current) + 1
            )
          }
        >
          <ChevronDown size={20} />
        </button>
      </div>
    </section>
  );
}

function nearestFeedIndexFromScroll(
  feedElement: HTMLElement | null,
  itemRefs: Array<HTMLElement | null>
): number {
  if (!feedElement) {
    return 0;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < itemRefs.length; index += 1) {
    const item = itemRefs[index];

    if (!item) {
      continue;
    }

    const distance = Math.abs(feedItemTop(feedElement, item) - feedElement.scrollTop);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function feedItemTop(feedElement: HTMLElement, item: HTMLElement): number {
  return (
    item.getBoundingClientRect().top -
    feedElement.getBoundingClientRect().top +
    feedElement.scrollTop
  );
}

function useAutoLoadSentinel({
  enabled,
  onLoadMore,
  rootMargin,
  rootRef,
  targetRef
}: {
  enabled: boolean;
  onLoadMore: () => void;
  rootMargin: string;
  rootRef: MutableRefObject<HTMLElement | null>;
  targetRef: MutableRefObject<HTMLElement | null>;
}) {
  const onLoadMoreRef = useRef(onLoadMore);
  const requestedWhileVisibleRef = useRef(false);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    requestedWhileVisibleRef.current = false;
  }, [enabled]);

  useEffect(() => {
    const root = rootRef.current;
    const target = targetRef.current;

    if (!enabled || !root || !target || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting);

        if (!isIntersecting) {
          requestedWhileVisibleRef.current = false;
          return;
        }

        if (requestedWhileVisibleRef.current) {
          return;
        }

        requestedWhileVisibleRef.current = true;
        onLoadMoreRef.current();
      },
      {
        root,
        rootMargin
      }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [enabled, rootMargin, rootRef, targetRef]);
}

function galleryMinTileWidth(gridSize: GridSize): number {
  switch (gridSize) {
    case "Tiny":
      return 96;
    case "Compact":
      return 132;
    case "Huge":
      return 340;
    case "Large":
      return 260;
    case "Medium":
    default:
      return 180;
  }
}

function galleryColumnCount(containerWidth: number, minTileWidth: number): number {
  const usableWidth = Math.max(containerWidth, minTileWidth);

  return Math.max(
    1,
    Math.floor((usableWidth + GALLERY_GRID_GAP) / (minTileWidth + GALLERY_GRID_GAP))
  );
}

function chunkAssetsIntoRows(
  assets: AssetRecord[],
  columnCount: number
): AssetRecord[][] {
  const rows: AssetRecord[][] = [];

  for (let index = 0; index < assets.length; index += columnCount) {
    rows.push(assets.slice(index, index + columnCount));
  }

  return rows;
}

function estimateGalleryRowHeight({
  aspect,
  columnCount,
  containerWidth,
  metadataFields,
  minTileWidth
}: {
  aspect: AspectMode;
  columnCount: number;
  containerWidth: number;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  minTileWidth: number;
}): number {
  const width = Math.max(containerWidth, minTileWidth);
  const tileWidth =
    (width - GALLERY_GRID_GAP * Math.max(0, columnCount - 1)) / columnCount;
  const mediaHeight = tileWidth / galleryAspectRatio(aspect);

  return mediaHeight + galleryTileChromeHeight(metadataFields);
}

function galleryTileChromeHeight(
  fields: ReadonlySet<GalleryMetadataField>
): number {
  const hasTitle = fields.has("title");
  const hasSecondaryMetadata = fields.has("mediaType") || fields.has("size");
  const hasCuration =
    fields.has("rating") || fields.has("favorite") || fields.has("tags");
  const visibleSectionCount = [hasTitle, hasSecondaryMetadata, hasCuration]
    .filter(Boolean).length;

  if (visibleSectionCount === 0) {
    return 0;
  }

  return (
    19 +
    (hasTitle ? 16 : 0) +
    (hasSecondaryMetadata ? 15 : 0) +
    (hasCuration ? 30 : 0) +
    Math.max(0, visibleSectionCount - 1) * 6
  );
}

function gallerySecondaryMetadata(
  asset: AssetRecord,
  fields: ReadonlySet<GalleryMetadataField>
): string[] {
  const entries: string[] = [];

  if (fields.has("mediaType")) {
    entries.push(asset.mediaType);
  }

  if (fields.has("size")) {
    entries.push(
      asset.durationMs ? formatDuration(asset.durationMs) : formatBytes(asset.sizeBytes)
    );
  }

  return entries;
}

function galleryAspectRatio(aspect: AspectMode): number {
  switch (aspect) {
    case "Portrait":
      return 9 / 16;
    case "Landscape":
      return 16 / 10;
    case "Original":
      return 3 / 2;
    case "Square":
    default:
      return 1;
  }
}

function mediaTileStyle(
  asset: AssetRecord,
  aspect: AspectMode,
  measuredAspectRatios: Record<string, string>
): CSSProperties | undefined {
  if (aspect !== "Original") {
    return undefined;
  }

  const ratio =
    measuredAspectRatios[asset.id] ??
    knownMediaAspectRatio(asset) ??
    "3 / 2";

  return {
    "--media-aspect-ratio": ratio
  } as CSSProperties;
}

function knownMediaAspectRatio(asset: AssetRecord): string | null {
  if (!asset.width || !asset.height || asset.width <= 0 || asset.height <= 0) {
    return null;
  }

  return `${asset.width} / ${asset.height}`;
}

function readGalleryMetadataFields(): Set<GalleryMetadataField> {
  if (typeof window === "undefined") {
    return new Set(defaultGalleryMetadataFields);
  }

  try {
    const rawValue = window.localStorage.getItem(GALLERY_METADATA_STORAGE_KEY);

    if (!rawValue) {
      return new Set(defaultGalleryMetadataFields);
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsedValue)) {
      return new Set(defaultGalleryMetadataFields);
    }

    const allowedFields = new Set(
      galleryMetadataOptions.map((option) => option.value)
    );
    const fields = parsedValue.filter(
      (field): field is GalleryMetadataField =>
        typeof field === "string" &&
        allowedFields.has(field as GalleryMetadataField)
    );

    return new Set(fields);
  } catch {
    return new Set(defaultGalleryMetadataFields);
  }
}

function writeGalleryMetadataFields(
  fields: ReadonlySet<GalleryMetadataField>
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    GALLERY_METADATA_STORAGE_KEY,
    JSON.stringify([...fields])
  );
}

function readSidebarCollapsedPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsedPreference(isCollapsed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(isCollapsed)
    );
  } catch {
    // A storage failure should not block the sidebar interaction.
  }
}

function shouldCollapseFeedControlsByDefault(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(
    "(max-width: 760px), (max-width: 920px) and (hover: none) and (pointer: coarse)"
  ).matches;
}

function MediaPreview({
  asset,
  muted = true,
  onAudibleAutoplayBlocked,
  onDimensionsKnown,
  playbackPaused = false,
  preloadPreview = false,
  tall = false
}: {
  asset: AssetRecord;
  muted?: boolean;
  onAudibleAutoplayBlocked?: () => void;
  onDimensionsKnown?: (assetId: string, width: number, height: number) => void;
  playbackPaused?: boolean;
  preloadPreview?: boolean;
  tall?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isAnimatedImage = isAnimatedImagePreview(asset);
  const [hasError, setHasError] = useState(false);
  const [animatedImageFailed, setAnimatedImageFailed] = useState(false);
  const [videoPreviewFailed, setVideoPreviewFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const videoSource =
    asset.mediaType === "video"
      ? videoPreviewFailed
        ? mediaUrl(asset.id)
        : videoPreviewUrl(asset.id, tall ? 720 : 480)
      : "";
  const shouldLoadVideo =
    asset.mediaType === "video" && (isVisible || preloadPreview);

  const playVisibleVideo = useCallback(() => {
    if (asset.mediaType !== "video" || !isVisible || playbackPaused) {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.muted = muted;
    video.play().catch(() => {
      if (muted) {
        return;
      }

      video.muted = true;
      onAudibleAutoplayBlocked?.();
      video.play().catch(() => undefined);
    });
  }, [
    asset.mediaType,
    isVisible,
    muted,
    onAudibleAutoplayBlocked,
    playbackPaused
  ]);

  useEffect(() => {
    setHasError(false);
    setAnimatedImageFailed(false);
    setVideoPreviewFailed(false);
    setIsVisible(false);
    setIsVideoReady(false);
  }, [asset.id, isAnimatedImage, tall]);

  useEffect(() => {
    if (asset.mediaType !== "video" && !isAnimatedImage) {
      return;
    }

    const previewElement =
      asset.mediaType === "video" ? videoRef.current : imageRef.current;

    if (!previewElement) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];

        if (!firstEntry) {
          return;
        }

        setIsVisible(firstEntry.isIntersecting);
      },
      asset.mediaType === "video"
        ? { threshold: 0.45 }
        : { rootMargin: "180px 0px", threshold: 0.01 }
    );

    observer.observe(previewElement);

    return () => {
      observer.disconnect();

      if (asset.mediaType === "video") {
        videoRef.current?.pause();
      }
    };
  }, [asset.id, asset.mediaType, isAnimatedImage]);

  useEffect(() => {
    if (asset.mediaType !== "video") {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (isVisible && !playbackPaused) {
      playVisibleVideo();
    } else {
      video.pause();
    }
  }, [asset.id, asset.mediaType, isVisible, playbackPaused, playVisibleVideo]);

  useEffect(() => {
    if (asset.mediaType !== "video" || !preloadPreview || isVisible) {
      return;
    }

    videoRef.current?.load();
  }, [asset.id, asset.mediaType, isVisible, preloadPreview, videoSource]);

  useEffect(() => {
    if (asset.mediaType === "video" && !shouldLoadVideo) {
      setIsVideoReady(false);
    }
  }, [asset.mediaType, shouldLoadVideo]);

  if (hasError) {
    return (
      <div className={tall ? "media-placeholder tall" : "media-placeholder"}>
        {asset.mediaType === "video" ? <Video size={30} /> : <Image size={30} />}
      </div>
    );
  }

  if (asset.mediaType === "image") {
    const previewSource =
      isAnimatedImage && isVisible && !animatedImageFailed
        ? mediaUrl(asset.id)
        : thumbnailUrl(asset.id);

    return (
      <img
        ref={imageRef}
        className={tall ? "media-image tall" : "media-image"}
        src={previewSource}
        alt={asset.name}
        data-preview-source={
          isAnimatedImage && isVisible && !animatedImageFailed
            ? "original"
            : "thumbnail"
        }
        loading={isAnimatedImage && isVisible ? "eager" : "lazy"}
        decoding="async"
        onLoad={(event) => {
          onDimensionsKnown?.(
            asset.id,
            event.currentTarget.naturalWidth,
            event.currentTarget.naturalHeight
          );
        }}
        onError={() => {
          if (isAnimatedImage && isVisible && !animatedImageFailed) {
            setAnimatedImageFailed(true);
            return;
          }

          setHasError(true);
        }}
      />
    );
  }

  return (
    <span
      className={[
        "media-video-shell",
        tall ? "tall" : "",
        isVideoReady ? "ready" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        className="media-video-poster"
        src={thumbnailUrl(asset.id)}
        alt=""
        aria-hidden="true"
        loading={preloadPreview ? "eager" : "lazy"}
        decoding="async"
      />
      <video
        ref={videoRef}
        className={tall ? "media-video tall" : "media-video"}
        src={shouldLoadVideo ? videoSource : undefined}
        poster={thumbnailUrl(asset.id)}
        data-preview-source={
          shouldLoadVideo
            ? videoPreviewFailed
              ? "original"
              : "preview"
            : "poster"
        }
        muted={muted}
        loop
        playsInline
        preload={
          shouldLoadVideo ? (preloadPreview ? "auto" : "metadata") : "none"
        }
        onLoadedMetadata={(event) => {
          onDimensionsKnown?.(
            asset.id,
            event.currentTarget.videoWidth,
            event.currentTarget.videoHeight
          );
        }}
        onLoadedData={() => {
          setIsVideoReady(true);

          if (isVisible && !playbackPaused) {
            playVisibleVideo();
          }
        }}
        onCanPlay={() => {
          setIsVideoReady(true);

          if (isVisible && !playbackPaused) {
            playVisibleVideo();
          }
        }}
        onError={() => {
          setIsVideoReady(false);

          if (!videoPreviewFailed) {
            setVideoPreviewFailed(true);
            return;
          }

          setHasError(true);
        }}
      />
    </span>
  );
}

function isAnimatedImagePreview(asset: AssetRecord): boolean {
  return (
    asset.mediaType === "image" &&
    ANIMATED_IMAGE_EXTENSIONS.has(asset.extension.toLocaleLowerCase("en-US"))
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "a, button, input, select, textarea, [contenteditable='true']"
      )
    )
  );
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(
      (element) =>
        element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true"
    );
}

type ViewerStageSize = {
  width: number;
  height: number;
};

function mediaViewerFrameStyle(
  mediaSize: ViewerStageSize | null,
  stageSize: ViewerStageSize | null
): CSSProperties | undefined {
  if (
    !stageSize ||
    stageSize.width <= 0 ||
    stageSize.height <= 0 ||
    !mediaSize ||
    mediaSize.width <= 0 ||
    mediaSize.height <= 0
  ) {
    return undefined;
  }

  const mediaAspectRatio = mediaSize.width / mediaSize.height;
  const stageAspectRatio = stageSize.width / stageSize.height;
  const frameWidth =
    mediaAspectRatio >= stageAspectRatio
      ? stageSize.width
      : stageSize.height * mediaAspectRatio;
  const frameHeight =
    mediaAspectRatio >= stageAspectRatio
      ? stageSize.width / mediaAspectRatio
      : stageSize.height;

  return {
    width: `${Math.max(1, Math.floor(frameWidth))}px`,
    height: `${Math.max(1, Math.floor(frameHeight))}px`
  };
}

function FeedAnnotationDrawer({
  aiStatus,
  asset,
  onClose,
  onAssetUpdated,
  onAssetTagsUpdated
}: {
  aiStatus: AiStatus | null;
  asset: AssetRecord;
  onClose: () => void;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    drawerRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) {
        return;
      }

      const focusableElements = getFocusableElements(drawerRef.current);

      if (focusableElements.length === 0) {
        event.preventDefault();
        drawerRef.current.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0]!;
      const lastElement = focusableElements[focusableElements.length - 1]!;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="feed-drawer-layer">
      <button
        className="feed-drawer-scrim"
        type="button"
        aria-label="Close details"
        onClick={onClose}
      />
      <section
        className="feed-annotation-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-annotation-title"
        tabIndex={-1}
      >
        <div className="feed-drawer-grip" aria-hidden="true" />
        <header className="feed-drawer-header">
          <div>
            <span>{asset.mediaType}</span>
            <h2 id="feed-annotation-title" title={asset.name}>
              {asset.name}
            </h2>
            <p>{mediaDetailLine(asset)}</p>
          </div>
          <IconButton
            className="feed-drawer-close"
            icon={X}
            iconSize={18}
            label="Close details"
            onClick={onClose}
          />
        </header>
        <AssetAnnotationPanel
          aiStatus={aiStatus}
          asset={asset}
          onAssetTagsUpdated={onAssetTagsUpdated}
          onAssetUpdated={onAssetUpdated}
        />
      </section>
    </div>
  );
}

function AssetAnnotationPanel({
  aiStatus,
  asset,
  onAssetUpdated,
  onAssetTagsUpdated
}: {
  aiStatus: AiStatus | null;
  asset: AssetRecord;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<TagRecord[]>([]);
  const [smartTagSuggestions, setSmartTagSuggestions] = useState<
    TagSuggestion[]
  >([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [isSavingRating, setIsSavingRating] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [isLoadingSmartTags, setIsLoadingSmartTags] = useState(false);
  const [isLoadingAiTags, setIsLoadingAiTags] = useState(false);

  useEffect(() => {
    let active = true;
    setTags([]);
    setTagInput("");
    setTagSuggestions([]);
    setSmartTagSuggestions([]);
    setAnnotationError(null);

    getAssetTags(asset.id)
      .then((response) => {
        if (active) {
          setTags(response.tags);
        }
      })
      .catch(() => {
        if (active) {
          setAnnotationError("Unable to load tags.");
        }
      });

    return () => {
      active = false;
    };
  }, [asset.id]);

  useEffect(() => {
    const query = tagInput.trim();

    if (!query) {
      setTagSuggestions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      suggestTags({ query, limit: 8 })
        .then((response) => {
          if (active) {
            const selectedNames = new Set(
              tags.map((tag) => tag.normalizedName)
            );
            setTagSuggestions(
              response.tags.filter(
                (tag) => !selectedNames.has(tag.normalizedName)
              )
            );
          }
        })
        .catch(() => {
          if (active) {
            setTagSuggestions([]);
          }
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tagInput, tags]);

  async function saveRating(input: {
    rating?: number | null;
    favorite?: boolean;
  }) {
    setIsSavingRating(true);
    setAnnotationError(null);

    try {
      const { asset: updatedAsset } = await updateAssetRating(asset.id, input);
      onAssetUpdated(updatedAsset);
    } catch {
      setAnnotationError("Unable to save rating.");
    } finally {
      setIsSavingRating(false);
    }
  }

  async function saveTags(nextTagNames: string[]) {
    setIsSavingTags(true);
    setAnnotationError(null);

    try {
      const response = await setAssetTags(asset.id, uniqueTagNames(nextTagNames));
      setTags(response.tags);
      onAssetTagsUpdated(asset.id, response.tags);
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(currentSuggestions, response.tags)
      );
      setTagInput("");
      setTagSuggestions([]);
    } catch {
      setAnnotationError("Unable to save tags.");
    } finally {
      setIsSavingTags(false);
    }
  }

  function addTag(rawTagName: string) {
    const tagName = normalizeTagDraft(rawTagName);

    if (!tagName) {
      return;
    }

    void saveTags([...tags.map((tag) => tag.displayName), tagName]);
  }

  function removeTag(tagId: string) {
    void saveTags(
      tags
        .filter((tag) => tag.id !== tagId)
        .map((tag) => tag.displayName)
    );
  }

  async function loadSmartTagSuggestions() {
    setIsLoadingSmartTags(true);
    setAnnotationError(null);

    try {
      const response = await getAssetTagSuggestions(asset.id, 8);
      setSmartTagSuggestions(filterSavedSuggestions(response.suggestions, tags));
    } catch {
      setAnnotationError("Unable to load suggestions.");
    } finally {
      setIsLoadingSmartTags(false);
    }
  }

  async function loadAiTagSuggestions() {
    setIsLoadingAiTags(true);
    setAnnotationError(null);

    try {
      const response = await getAiAssetTagSuggestions(asset.id, 8);
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(
          mergeTagSuggestions(currentSuggestions, response.suggestions),
          tags
        )
      );
    } catch (caught) {
      setAnnotationError(aiSuggestionErrorMessage(caught));
    } finally {
      setIsLoadingAiTags(false);
    }
  }

  return (
    <section className="annotation-panel" aria-label="Media annotations">
      <div className="annotation-row">
        <span className="annotation-label">Rating</span>
        <div className="rating-controls">
          <RatingSlider
            className="annotation-rating-slider"
            disabled={isSavingRating}
            label={`Rating for ${asset.name}`}
            value={asset.rating}
            onClear={() => void saveRating({ rating: null })}
            onCommit={(rating) => void saveRating({ rating })}
          />
        </div>
        <button
          className={asset.favorite ? "favorite-button active" : "favorite-button"}
          type="button"
          aria-label="Favorite"
          title="Favorite"
          aria-pressed={asset.favorite}
          disabled={isSavingRating}
          onClick={() => void saveRating({ favorite: !asset.favorite })}
        >
          <Heart size={18} />
        </button>
      </div>

      <div className="tag-editor">
        <div className="tag-editor-heading">
          <span className="annotation-label">Tags</span>
          <div className="tag-editor-actions">
            <button
              className="suggest-tags-button"
              type="button"
              disabled={isLoadingSmartTags || isSavingTags}
              onClick={() => void loadSmartTagSuggestions()}
            >
              <Sparkles size={14} />
              <span>{isLoadingSmartTags ? "Suggesting" : "Suggest tags"}</span>
            </button>
            {aiStatus?.enabled ? (
              <button
                className="suggest-tags-button"
                type="button"
                disabled={isLoadingAiTags || isSavingTags}
                onClick={() => void loadAiTagSuggestions()}
              >
                <Sparkles size={14} />
                <span>{isLoadingAiTags ? "Analyzing" : "Vision tags"}</span>
              </button>
            ) : null}
          </div>
        </div>
        <div className="tag-chip-list">
          {tags.map((tag) => (
            <span className="tag-chip" key={tag.id}>
              {tag.displayName}
              <button
                type="button"
                aria-label={`Remove ${tag.displayName}`}
                disabled={isSavingTags}
                onClick={() => removeTag(tag.id)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          <div className="tag-input-wrap">
            <input
              value={tagInput}
              maxLength={48}
              placeholder="Add tag"
              disabled={isSavingTags}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagInput);
                }
              }}
            />
            <button
              type="button"
              aria-label="Add tag"
              title="Add tag"
              disabled={isSavingTags || !tagInput.trim()}
              onClick={() => addTag(tagInput)}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>

        {smartTagSuggestions.length ? (
          <div
            className="tag-suggestions smart-suggestions"
            aria-label="Suggested tags"
          >
            {smartTagSuggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion.normalizedName}
                title={`${suggestion.reason}; confidence ${Math.round(
                  suggestion.confidence * 100
                )}%`}
                disabled={isSavingTags}
                onClick={() => addTag(suggestion.displayName)}
              >
                <Sparkles size={13} />
                {suggestion.displayName}
              </button>
            ))}
          </div>
        ) : null}

        {tagSuggestions.length ? (
          <div className="tag-suggestions">
            {tagSuggestions.map((tag) => (
              <button
                type="button"
                key={tag.id}
                disabled={isSavingTags}
                onClick={() => addTag(tag.displayName)}
              >
                {tag.displayName}
              </button>
            ))}
          </div>
        ) : null}

        {annotationError ? (
          <span className="annotation-error">{annotationError}</span>
        ) : null}
      </div>
    </section>
  );
}

function FullscreenViewer({
  asset,
  hasNext,
  hasPrevious,
  onClose,
  onNext,
  onPrevious
}: {
  asset: AssetRecord;
  hasNext: boolean;
  hasPrevious: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const viewerStageRef = useRef<HTMLDivElement | null>(null);
  const [viewerStageSize, setViewerStageSize] =
    useState<ViewerStageSize | null>(null);
  const [viewerVideoSize, setViewerVideoSize] =
    useState<ViewerStageSize | null>(null);
  const storedMediaSize = useMemo<ViewerStageSize | null>(() => {
    if (!asset.width || !asset.height || asset.width <= 0 || asset.height <= 0) {
      return null;
    }

    return { width: asset.width, height: asset.height };
  }, [asset.height, asset.width]);
  const viewerMediaSize =
    asset.mediaType === "video"
      ? viewerVideoSize ?? storedMediaSize
      : storedMediaSize;
  const viewerMediaFrameStyle = useMemo(
    () => mediaViewerFrameStyle(viewerMediaSize, viewerStageSize),
    [viewerMediaSize, viewerStageSize]
  );

  useEffect(() => {
    const stage = viewerStageRef.current;

    if (!stage) {
      return;
    }

    let animationFrame: number | null = null;

    const measureStage = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));

      setViewerStageSize((current) =>
        current?.width === width && current.height === height
          ? current
          : { width, height }
      );
    };

    const scheduleMeasure = () => {
      if (animationFrame !== null) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        measureStage();
      });
    };

    scheduleMeasure();

    if (typeof window.ResizeObserver === "function") {
      const resizeObserver = new window.ResizeObserver(scheduleMeasure);
      resizeObserver.observe(stage);

      return () => {
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }

        resizeObserver.disconnect();
      };
    }

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      window.removeEventListener("resize", scheduleMeasure);
    };
  }, []);

  useEffect(() => {
    setViewerVideoSize(null);
  }, [asset.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) {
        if (event.key === "Escape") {
          onClose();
        }
        return;
      }

      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowRight" && hasNext) {
        onNext();
      } else if (event.key === "ArrowLeft" && hasPrevious) {
        onPrevious();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [hasNext, hasPrevious, onClose, onNext, onPrevious]);

  const viewerClassName =
    asset.mediaType === "video"
      ? "viewer-backdrop viewer-video"
      : "viewer-backdrop";

  return (
    <div
      className={viewerClassName}
      role="dialog"
      aria-label={`${asset.name} viewer`}
      aria-modal="true"
    >
      <div className="viewer-topbar" aria-label="Viewer controls">
        <div className="viewer-actions">
          <a
            className="icon-link"
            href={downloadUrl(asset.id)}
            aria-label={`Download ${asset.name}`}
            title="Download"
          >
            <Download size={18} />
          </a>
          <button
            className="icon-button"
            type="button"
            aria-label="Close viewer"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
      </div>

      <button
        className="viewer-nav previous"
        type="button"
        aria-label="Previous media"
        disabled={!hasPrevious}
        onClick={onPrevious}
      >
        <ChevronLeft size={24} />
      </button>

      <figure className="viewer-stage">
        <div className="viewer-fit-area" ref={viewerStageRef}>
          <div className="viewer-media-frame" style={viewerMediaFrameStyle}>
            {asset.mediaType === "image" ? (
              <img
                src={mediaUrl(asset.id)}
                alt={asset.name}
                width={asset.width ?? undefined}
                height={asset.height ?? undefined}
              />
            ) : (
              <video
                key={asset.id}
                src={mediaUrl(asset.id)}
                width={asset.width ?? undefined}
                height={asset.height ?? undefined}
                controls
                autoPlay
                loop
                playsInline
                onLoadedMetadata={(event) => {
                  const { videoHeight, videoWidth } = event.currentTarget;

                  if (videoWidth <= 0 || videoHeight <= 0) {
                    return;
                  }

                  setViewerVideoSize((current) =>
                    current?.width === videoWidth &&
                    current.height === videoHeight
                      ? current
                      : { width: videoWidth, height: videoHeight }
                  );
                }}
              />
            )}
          </div>
        </div>
      </figure>

      <button
        className="viewer-nav next"
        type="button"
        aria-label="Next media"
        disabled={!hasNext}
        onClick={onNext}
      >
        <ChevronRight size={24} />
      </button>
    </div>
  );
}

function buildFolderChildrenByParentId(
  tree: TreeResponse | null
): Map<string, FolderTreeNode[]> {
  const childrenByParentId = new Map<string, FolderTreeNode[]>();

  if (!tree) {
    return childrenByParentId;
  }

  for (const folder of tree.folders) {
    if (!folder.parentId) {
      continue;
    }

    const siblings = childrenByParentId.get(folder.parentId) ?? [];
    siblings.push(folder);
    childrenByParentId.set(folder.parentId, siblings);
  }

  for (const siblings of childrenByParentId.values()) {
    siblings.sort((left, right) => left.label.localeCompare(right.label));
  }

  return childrenByParentId;
}

function buildFolderById(tree: TreeResponse | null): Map<string, FolderTreeNode> {
  return new Map(tree?.folders.map((folder) => [folder.id, folder]) ?? []);
}

function buildVisibleFolderItems({
  tree,
  folderChildrenByParentId,
  expandedFolderIds
}: {
  tree: TreeResponse;
  folderChildrenByParentId: Map<string, FolderTreeNode[]>;
  expandedFolderIds: ReadonlySet<string>;
}): FolderTreeItem[] {
  const items: FolderTreeItem[] = [];

  for (const root of tree.roots) {
    appendRootTreeItem(root, items, folderChildrenByParentId, expandedFolderIds);
  }

  return items;
}

function appendRootTreeItem(
  root: RootTreeNode,
  items: FolderTreeItem[],
  folderChildrenByParentId: Map<string, FolderTreeNode[]>,
  expandedFolderIds: ReadonlySet<string>
) {
  const children = folderChildrenByParentId.get(root.folderId) ?? [];

  items.push({
    id: root.folderId,
    parentId: null,
    label: root.label,
    assetCount: root.assetCount,
    depth: 0,
    hasChildren: children.length > 0
  });

  if (!expandedFolderIds.has(root.folderId)) {
    return;
  }

  for (const child of children) {
    appendFolderTreeItem(child, 1, items, folderChildrenByParentId, expandedFolderIds);
  }
}

function appendFolderTreeItem(
  folder: FolderTreeNode,
  depth: number,
  items: FolderTreeItem[],
  folderChildrenByParentId: Map<string, FolderTreeNode[]>,
  expandedFolderIds: ReadonlySet<string>
) {
  const children = folderChildrenByParentId.get(folder.id) ?? [];

  items.push({
    id: folder.id,
    parentId: folder.parentId,
    label: folder.label,
    assetCount: folder.assetCount,
    depth,
    hasChildren: children.length > 0
  });

  if (!expandedFolderIds.has(folder.id)) {
    return;
  }

  for (const child of children) {
    appendFolderTreeItem(
      child,
      depth + 1,
      items,
      folderChildrenByParentId,
      expandedFolderIds
    );
  }
}

function getExpandableFolderIds(
  tree: TreeResponse | null,
  folderChildrenByParentId: Map<string, FolderTreeNode[]>
): Set<string> {
  const ids = new Set<string>();

  for (const root of tree?.roots ?? []) {
    if ((folderChildrenByParentId.get(root.folderId) ?? []).length > 0) {
      ids.add(root.folderId);
    }
  }

  for (const [folderId, children] of folderChildrenByParentId) {
    if (children.length > 0) {
      ids.add(folderId);
    }
  }

  return ids;
}

function folderAncestorIds(
  folderId: string,
  folderById: Map<string, FolderTreeNode>
): string[] {
  const ancestors: string[] = [];
  let current = folderById.get(folderId);

  while (current?.parentId) {
    ancestors.unshift(current.parentId);
    current = folderById.get(current.parentId);
  }

  return ancestors;
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}:${remainingMinutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function mediaDetailLine(asset: AssetRecord): string {
  return [
    formatBytes(asset.sizeBytes),
    asset.durationMs ? formatDuration(asset.durationMs) : null,
    asset.codec
  ]
    .filter(Boolean)
    .join(" / ");
}

function mediaUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/media`;
}

function thumbnailUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=640`;
}

function videoPreviewUrl(assetId: string, size: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/preview?size=${size}&duration=4`;
}

function downloadUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/download`;
}

function uniqueTagNames(tagNames: string[]): string[] {
  const tags = new Map<string, string>();

  for (const tagName of tagNames) {
    const displayName = normalizeTagDraft(tagName);

    if (!displayName) {
      continue;
    }

    const normalizedName = displayName.toLocaleLowerCase("en-US");

    if (!tags.has(normalizedName)) {
      tags.set(normalizedName, displayName);
    }
  }

  return [...tags.values()];
}

function selectedMediaLabel(count: number): string {
  return count === 1 ? "item" : "items";
}

function optimisticRatingAsset(
  asset: AssetRecord,
  input: { rating?: number | null; favorite?: boolean }
): AssetRecord {
  return {
    ...asset,
    favorite: input.favorite ?? asset.favorite,
    rating: input.rating === undefined ? asset.rating : input.rating
  };
}

function ratingActionErrorMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return "Unable to update media.";
  }

  switch (caught.code) {
    case "asset_not_indexed":
      return "This media is no longer indexed.";
    case "invalid_request":
      return "Rating request was invalid.";
    default:
      return "Unable to update media.";
  }
}

function batchActionErrorMessage(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiError)) {
    return fallback;
  }

  switch (caught.code) {
    case "asset_not_indexed":
      return "Some selected media is no longer indexed.";
    case "invalid_tag":
      return "Use shorter, non-empty tags.";
    case "invalid_request":
      return "Selection request was invalid.";
    default:
      return fallback;
  }
}

function aiSuggestionErrorMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return "Unable to analyze media.";
  }

  switch (caught.code) {
    case "ai_disabled":
      return "AI suggestions are disabled.";
    case "ai_not_supported":
      return "Vision suggestions support images first.";
    case "ai_provider_failed":
      return "Local AI provider did not respond.";
    default:
      return "Unable to analyze media.";
  }
}

function batchTagStatus(
  tags: string[],
  mode: "add" | "replace",
  updatedCount: number
): string {
  const mediaLabel = selectedMediaLabel(updatedCount);

  if (mode === "replace") {
    return tags.length
      ? `Tags replaced on ${updatedCount} ${mediaLabel}.`
      : `Tags cleared on ${updatedCount} ${mediaLabel}.`;
  }

  const tagLabel = tags.length === 1 ? tags[0] : `${tags.length} tags`;

  return `${tagLabel} added to ${updatedCount} ${mediaLabel}.`;
}

function filterSavedSuggestions(
  suggestions: TagSuggestion[],
  savedTags: TagRecord[]
): TagSuggestion[] {
  const savedTagNames = new Set(savedTags.map((tag) => tag.normalizedName));

  return suggestions.filter(
    (suggestion) => !savedTagNames.has(suggestion.normalizedName)
  );
}

function mergeTagSuggestions(
  currentSuggestions: TagSuggestion[],
  nextSuggestions: TagSuggestion[]
): TagSuggestion[] {
  const suggestions = new Map<string, TagSuggestion>();

  for (const suggestion of [...currentSuggestions, ...nextSuggestions]) {
    if (!suggestions.has(suggestion.normalizedName)) {
      suggestions.set(suggestion.normalizedName, suggestion);
    }
  }

  return [...suggestions.values()];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
