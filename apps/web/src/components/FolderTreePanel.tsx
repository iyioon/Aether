import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw
} from "lucide-react";
import type { LibraryWatchStatus, ScanProgress } from "../api/client";
import { folderTreeItemDomId } from "./folders/folder-tree-dom";
import type {
  FolderScanState,
  FolderSortMode,
  FolderTreeAction,
  FolderTreeItem
} from "./folders/folder-tree-types";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "./ui/context-menu";
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
  checkpointScrollPositionOnPageLifecycle,
  flushSessionScrollPositions,
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
  canCreateFolder?: boolean;
  canManageFolder?: boolean;
  onFolderAction?: (action: FolderTreeAction, folderId?: string) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolderExpansion: (folderId: string) => void;
}

interface FolderTreeRowProps {
  isExpanded: boolean;
  isSelected: boolean;
  isTabStop: boolean;
  item: FolderTreeItem;
  onFolderAction?: (action: FolderTreeAction, folderId?: string) => void;
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
  canCreateFolder,
  canManageFolder,
  onFolderAction,
  onSelectFolder,
  onToggleFolderExpansion
}: FolderTreePanelProps) {
  const isScanInProgress = scanState === "starting" || scanState === "running";
  const treeListRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
  const hasRestoredScrollRef = useRef(false);
  const skipInitialSelectedRevealRef = useRef(false);

  const saveTreeScrollPosition = useCallback(() => {
    if (!hasRestoredScrollRef.current) {
      return;
    }
    const treeList = treeListRef.current;
    const listTop = treeList?.getBoundingClientRect().top;
    const anchor = treeList
      ? Array.from(
          treeList.querySelectorAll<HTMLElement>("[data-folder-id]")
        ).find((node) => node.getBoundingClientRect().bottom > (listTop ?? 0))
      : undefined;

    writeSessionScrollPosition("folder-tree", {
      anchorId: anchor?.dataset.folderId,
      anchorOffset:
        anchor && listTop !== undefined
          ? listTop - anchor.getBoundingClientRect().top
          : undefined,
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
      const anchor = storedPosition.anchorId
        ? document.getElementById(folderTreeItemDomId(storedPosition.anchorId))
        : null;
      treeList.scrollTop =
        anchor && treeList.contains(anchor)
          ? treeList.scrollTop +
            anchor.getBoundingClientRect().top -
            treeList.getBoundingClientRect().top +
            (storedPosition.anchorOffset ?? 0)
          : storedPosition.scrollTop;
      latestScrollTopRef.current = treeList.scrollTop;
      skipInitialSelectedRevealRef.current = true;
    }
  }, [isLoadingTree, items.length]);

  useLayoutEffect(() => {
    const treeList = treeListRef.current;

    if (!treeList || !selectedFolderId) {
      return;
    }
    if (skipInitialSelectedRevealRef.current) {
      skipInitialSelectedRevealRef.current = false;
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
      if (
        itemBounds.top < listBounds.top ||
        itemBounds.bottom > listBounds.bottom
      ) {
        selectedItem.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [items, selectedFolderId]);

  useLayoutEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      saveTreeScrollPosition();
      flushSessionScrollPositions("folder-tree");
    },
    [saveTreeScrollPosition]
  );

  useEffect(
    () =>
      checkpointScrollPositionOnPageLifecycle(
        "folder-tree",
        saveTreeScrollPosition
      ),
    [saveTreeScrollPosition]
  );

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
          {onFolderAction ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Selected folder actions"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!canCreateFolder}
                  onSelect={() =>
                    onFolderAction(
                      "create-folder",
                      selectedFolderId ?? undefined
                    )
                  }
                >
                  <Plus />
                  New folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canManageFolder}
                  onSelect={() =>
                    onFolderAction(
                      "rename-folder",
                      selectedFolderId ?? undefined
                    )
                  }
                >
                  <Pencil />
                  Rename…
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canManageFolder}
                  onSelect={() =>
                    onFolderAction("move-folder", selectedFolderId ?? undefined)
                  }
                >
                  <FolderInput />
                  Move to…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

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
              isExpanded={expandedFolderIds.has(item.id)}
              isSelected={selectedFolderId === item.id}
              isTabStop={treeTabStopId === item.id}
              item={item}
              key={item.id}
              onFolderAction={onFolderAction}
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

const FolderTreeRow = memo(function FolderTreeRow({
  isExpanded,
  isSelected,
  isTabStop,
  item,
  onFolderAction,
  onFolderKeyDown,
  onSelectFolder,
  onToggleFolderExpansion
}: FolderTreeRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const pendingActionRef = useRef<FolderTreeAction | null>(null);
  const touchPointerRef = useRef(false);
  const blockTouchMenuRef = useRef(false);
  const suppressClickRef = useRef(false);

  const row = (
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
      ref={rowRef}
      data-folder-id={item.id}
      role="treeitem"
      tabIndex={isTabStop ? 0 : -1}
      style={
        {
          "--tree-indent": `${item.depth * 8}px`
        } as CSSProperties
      }
      title={item.label}
      onClickCapture={(event) => {
        if (suppressClickRef.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
      onClick={() => onSelectFolder(item.id)}
      onKeyDown={(event) => {
        if (
          onFolderAction &&
          (event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10"))
        ) {
          event.preventDefault();
          event.stopPropagation();
          blockTouchMenuRef.current = false;
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: Math.min(
                window.innerWidth - 12,
                Math.max(12, bounds.left + Math.min(bounds.width / 2, 24))
              ),
              clientY: Math.min(
                window.innerHeight - 12,
                Math.max(12, bounds.top + bounds.height / 2)
              )
            })
          );
          return;
        }
        onFolderKeyDown(event, item);
      }}
    >
      {item.hasChildren ? (
        <button
          className="tree-disclosure"
          type="button"
          aria-label={
            isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`
          }
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
        {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
      </span>
      <span className="tree-label">{item.label}</span>
      <small className="tree-count">{item.assetCount}</small>
    </div>
  );

  if (!onFolderAction) return row;

  return (
    <ContextMenu
      open={menuOpen}
      onOpenChange={(open) => {
        if (open && blockTouchMenuRef.current) return;
        if (open) {
          pendingActionRef.current = null;
          suppressClickRef.current = touchPointerRef.current;
        }
        setMenuOpen(open);
      }}
    >
      <ContextMenuTrigger
        asChild
        onPointerDownCapture={(event) => {
          touchPointerRef.current = event.pointerType !== "mouse";
          suppressClickRef.current = false;
          blockTouchMenuRef.current =
            touchPointerRef.current &&
            event.target instanceof Element &&
            Boolean(event.target.closest(".tree-disclosure"));
        }}
        onPointerUpCapture={() => {
          touchPointerRef.current = false;
        }}
        onPointerCancelCapture={() => {
          touchPointerRef.current = false;
        }}
      >
        {row}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`Actions for ${item.label}`}
        className="folder-context-menu"
        collisionPadding={12}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          rowRef.current?.focus({ preventScroll: true });
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          if (action) onFolderAction(action, item.id);
        }}
      >
        <ContextMenuItem
          disabled={!item.canCreateFolder}
          onSelect={() => {
            pendingActionRef.current = "create-folder";
          }}
        >
          <Plus aria-hidden="true" />
          New folder
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!item.canManageFolder}
          onSelect={() => {
            pendingActionRef.current = "rename-folder";
          }}
        >
          <Pencil aria-hidden="true" />
          Rename…
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!item.canManageFolder}
          onSelect={() => {
            pendingActionRef.current = "move-folder";
          }}
        >
          <FolderInput aria-hidden="true" />
          Move to…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

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
