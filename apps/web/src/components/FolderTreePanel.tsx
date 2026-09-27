import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderOpen,
  RefreshCw
} from "lucide-react";
import type { LibraryWatchStatus, ScanProgress } from "../api/client";
import { folderTreeItemDomId } from "./folders/folder-tree-dom";
import type {
  FolderScanState,
  FolderSortMode,
  FolderTreeItem
} from "./folders/folder-tree-types";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";
import { Progress } from "./ui/progress";
import { Skeleton } from "./ui/skeleton";
import {
  readSessionScrollPosition,
  writeSessionScrollPosition
} from "./scroll-restoration";

interface FolderTreePanelProps {
  error: string | null;
  expandableFolderIds: ReadonlySet<string>;
  expandedFolderCount: number;
  expandedFolderIds: ReadonlySet<string>;
  folderSortMode: FolderSortMode;
  isLoadingTree: boolean;
  items: FolderTreeItem[];
  scanProgress: ScanProgress | null;
  scanState: FolderScanState;
  selectedFolderId: string | null;
  treeTabStopId: string | null;
  watchStatus: LibraryWatchStatus | null;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onFolderKeyDown: (
    event: ReactKeyboardEvent<HTMLElement>,
    item: FolderTreeItem
  ) => void;
  onFolderSortChange: (sortMode: FolderSortMode) => void;
  onScan: () => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolderExpansion: (folderId: string) => void;
}

interface FolderTreeRowProps {
  expandedFolderIds: ReadonlySet<string>;
  item: FolderTreeItem;
  selectedFolderId: string | null;
  treeTabStopId: string | null;
  onFolderKeyDown: (
    event: ReactKeyboardEvent<HTMLElement>,
    item: FolderTreeItem
  ) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolderExpansion: (folderId: string) => void;
}

export function FolderTreePanel({
  error,
  expandableFolderIds,
  expandedFolderCount,
  expandedFolderIds,
  folderSortMode,
  isLoadingTree,
  items,
  scanProgress,
  scanState,
  selectedFolderId,
  treeTabStopId,
  watchStatus,
  onCollapseAll,
  onExpandAll,
  onFolderKeyDown,
  onFolderSortChange,
  onScan,
  onSelectFolder,
  onToggleFolderExpansion
}: FolderTreePanelProps) {
  const isScanInProgress =
    scanState === "starting" || scanState === "running";
  const treeListRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
  const hasRestoredScrollRef = useRef(false);

  const saveTreeScrollPosition = useCallback(() => {
    const treeList = treeListRef.current;

    writeSessionScrollPosition("folder-tree", {
      contextKey: "library",
      scrollTop: treeList?.scrollTop ?? latestScrollTopRef.current
    });
  }, []);

  const handleTreeScroll = useCallback(() => {
    latestScrollTopRef.current = treeListRef.current?.scrollTop ?? 0;

    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      saveTreeScrollPosition();
    });
  }, [saveTreeScrollPosition]);

  useLayoutEffect(() => {
    const treeList = treeListRef.current;

    if (!treeList || hasRestoredScrollRef.current) {
      return;
    }

    hasRestoredScrollRef.current = true;
    const storedPosition = readSessionScrollPosition("folder-tree");
    if (storedPosition?.contextKey === "library") {
      latestScrollTopRef.current = storedPosition.scrollTop;
      treeList.scrollTop = storedPosition.scrollTop;
    }
  }, [isLoadingTree, items.length]);

  useLayoutEffect(() => {
    const treeList = treeListRef.current;

    if (!treeList || !selectedFolderId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const selectedItem = document.getElementById(
        folderTreeItemDomId(selectedFolderId)
      );

      if (!selectedItem || !treeList.contains(selectedItem)) {
        return;
      }

      const listBounds = treeList.getBoundingClientRect();
      const itemBounds = selectedItem.getBoundingClientRect();
      if (itemBounds.top < listBounds.top || itemBounds.bottom > listBounds.bottom) {
        selectedItem.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [items, selectedFolderId]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      saveTreeScrollPosition();
    },
    [saveTreeScrollPosition]
  );

  useEffect(() => {
    window.addEventListener("pagehide", saveTreeScrollPosition);
    return () =>
      window.removeEventListener("pagehide", saveTreeScrollPosition);
  }, [saveTreeScrollPosition]);

  return (
    <nav className="tree-panel" aria-label="Media folders">
      <div className="panel-heading">
        <div className="panel-heading-title">
          <Button
            aria-label={isScanInProgress ? "Scanning library" : "Scan library"}
            disabled={isScanInProgress}
            size="icon-sm"
            title={isScanInProgress ? "Scanning library" : "Scan library"}
            variant="outline"
            onClick={onScan}
          >
            <RefreshCw className={isScanInProgress ? "spin-icon" : undefined} />
          </Button>
          <span>Folders</span>
        </div>
        <div className="panel-actions" aria-label="Folder tree actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Sort and organize folders"
                size="sm"
                variant="ghost"
              >
                <FolderSortIcon sortMode={folderSortMode} />
                <span>{folderSortLabel(folderSortMode)}</span>
                <ChevronDown className="folder-sort-chevron" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Sort folders</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={folderSortMode}
                onValueChange={(value) =>
                  onFolderSortChange(value as FolderSortMode)
                }
              >
                <DropdownMenuRadioItem value="name-asc">
                  <ArrowDownAZ />
                  Name, A–Z
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name-desc">
                  <ArrowUpAZ />
                  Name, Z–A
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="items-desc">
                  <ArrowDownWideNarrow />
                  Most items
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="items-asc">
                  <ArrowUpNarrowWide />
                  Fewest items
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  expandableFolderIds.size === 0 ||
                  expandedFolderCount === expandableFolderIds.size
                }
                onSelect={onExpandAll}
              >
                <ChevronDown />
                Expand all
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={expandedFolderCount === 0}
                onSelect={onCollapseAll}
              >
                <ChevronUp />
                Collapse all
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isLoadingTree ? (
        <div className="empty-tree">Loading library.</div>
      ) : items.length ? (
        <div
          className="tree-list"
          ref={treeListRef}
          role="tree"
          aria-label="Media folders"
          onScroll={handleTreeScroll}
        >
          {items.map((item) => (
            <FolderTreeRow
              expandedFolderIds={expandedFolderIds}
              item={item}
              key={item.id}
              selectedFolderId={selectedFolderId}
              treeTabStopId={treeTabStopId}
              onFolderKeyDown={onFolderKeyDown}
              onSelectFolder={onSelectFolder}
              onToggleFolderExpansion={onToggleFolderExpansion}
            />
          ))}
        </div>
      ) : (
        <div className="empty-tree">
          {error ? "Library unavailable." : "No media roots configured."}
        </div>
      )}

      {isScanInProgress ? (
        <div className={`scan-state scan-progress-state ${scanState}`}>
          <div className="scan-progress-label">
            <span>{scanProgressLabel(scanState, scanProgress)}</span>
            {scanProgress?.percent !== null &&
            scanProgress?.percent !== undefined ? (
              <span>{scanProgress.percent}%</span>
            ) : null}
          </div>
          {scanProgress?.percent == null ? (
            <Skeleton
              aria-label="Preparing library scan"
              className="scan-progress-bar"
              role="progressbar"
            />
          ) : (
            <Progress
              aria-label="Library scan progress"
              className="scan-progress-bar"
              value={scanProgress.percent}
            />
          )}
        </div>
      ) : null}
      {watchStatus?.lastError ? (
        <div className="scan-state failed">
          <span>Watcher issue</span>
        </div>
      ) : null}
    </nav>
  );
}

function FolderTreeRow({
  expandedFolderIds,
  item,
  selectedFolderId,
  treeTabStopId,
  onFolderKeyDown,
  onSelectFolder,
  onToggleFolderExpansion
}: FolderTreeRowProps) {
  const isExpanded = expandedFolderIds.has(item.id);
  const isSelected = selectedFolderId === item.id;

  return (
    <div
      aria-expanded={item.hasChildren ? isExpanded : undefined}
      aria-label={`${item.label}, ${item.assetCount} ${
        item.assetCount === 1 ? "item" : "items"
      }`}
      aria-level={item.depth + 1}
      aria-selected={isSelected}
      className={[
        "tree-row",
        item.hasChildren ? "has-children" : "leaf",
        isExpanded ? "expanded" : "",
        isSelected ? "active" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      id={folderTreeItemDomId(item.id)}
      role="treeitem"
      tabIndex={treeTabStopId === item.id ? 0 : -1}
      style={
        {
          "--tree-indent": `${item.depth * 8}px`
        } as CSSProperties
      }
      title={item.label}
      onClick={() => onSelectFolder(item.id)}
      onKeyDown={(event) => onFolderKeyDown(event, item)}
    >
      {item.hasChildren ? (
        <button
          className="tree-disclosure"
          type="button"
          aria-label={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
          title={isExpanded ? "Collapse folder" : "Expand folder"}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFolderExpansion(item.id);
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span className="tree-disclosure-spacer" aria-hidden="true" />
      )}
      <span className="tree-folder-icon" aria-hidden="true">
        {isExpanded ? (
          <FolderOpen size={15} />
        ) : (
          <Folder size={15} />
        )}
      </span>
      <span className="tree-label">{item.label}</span>
      <small className="tree-count">{item.assetCount}</small>
    </div>
  );
}

function FolderSortIcon({ sortMode }: { sortMode: FolderSortMode }) {
  switch (sortMode) {
    case "name-desc":
      return <ArrowUpAZ />;
    case "items-desc":
      return <ArrowDownWideNarrow />;
    case "items-asc":
      return <ArrowUpNarrowWide />;
    case "name-asc":
    default:
      return <ArrowDownAZ />;
  }
}

function folderSortLabel(sortMode: FolderSortMode): string {
  switch (sortMode) {
    case "name-desc":
      return "Z–A";
    case "items-desc":
      return "Most";
    case "items-asc":
      return "Fewest";
    case "name-asc":
    default:
      return "A–Z";
  }
}

function scanLabel(state: FolderScanState): string {
  switch (state) {
    case "starting":
      return "Starting scan";
    case "running":
      return "Scanning";
    case "completed":
      return "Scan complete";
    case "failed":
      return "Scan failed";
    case "idle":
    default:
      return "";
  }
}

function scanProgressLabel(
  state: FolderScanState,
  progress: ScanProgress | null
): string {
  if (state === "starting" || progress?.phase === "discovering") {
    return "Preparing scan";
  }
  if (progress?.phase === "finalizing") {
    return "Finishing scan";
  }
  if (progress?.total !== null && progress?.total !== undefined) {
    return `Scanning ${progress.processed} of ${progress.total}`;
  }
  return scanLabel(state);
}
