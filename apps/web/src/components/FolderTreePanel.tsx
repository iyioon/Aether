import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderOpen,
  RefreshCw,
  Rows3,
  type LucideIcon
} from "lucide-react";
import type { LibraryWatchStatus } from "../api/client";
import { IconButton } from "./ui/IconButton";

export type FolderScanState =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed";

export interface FolderTreeItem {
  id: string;
  parentId: string | null;
  label: string;
  assetCount: number;
  depth: number;
  hasChildren: boolean;
}

interface FolderTreePanelProps {
  error: string | null;
  expandableFolderIds: ReadonlySet<string>;
  expandedFolderCount: number;
  expandedFolderIds: ReadonlySet<string>;
  isLoadingTree: boolean;
  items: FolderTreeItem[];
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
  onScan: () => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolderExpansion: (folderId: string) => void;
}

interface FolderActionButtonProps {
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
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
  isLoadingTree,
  items,
  scanState,
  selectedFolderId,
  treeTabStopId,
  watchStatus,
  onCollapseAll,
  onExpandAll,
  onFolderKeyDown,
  onScan,
  onSelectFolder,
  onToggleFolderExpansion
}: FolderTreePanelProps) {
  return (
    <nav className="tree-panel" aria-label="Media folders">
      <div className="panel-heading">
        <span>Folders</span>
        <div className="panel-actions" aria-label="Folder tree actions">
          <div
            className="folder-disclosure-group"
            role="group"
            aria-label="Folder expansion"
          >
            <FolderActionButton
              disabled={
                expandableFolderIds.size === 0 ||
                expandedFolderCount === expandableFolderIds.size
              }
              icon={ChevronDown}
              label="Expand all folders"
              onClick={onExpandAll}
            />
            <FolderActionButton
              disabled={expandedFolderCount === 0}
              icon={ChevronUp}
              label="Collapse all folders"
              onClick={onCollapseAll}
            />
          </div>
          <IconButton
            className="folder-refresh"
            disabled={scanState === "starting" || scanState === "running"}
            icon={RefreshCw}
            iconClassName={
              scanState === "starting" || scanState === "running"
                ? "spin-icon"
                : undefined
            }
            iconSize={17}
            label="Scan library"
            onClick={onScan}
          />
        </div>
      </div>

      {isLoadingTree ? (
        <div className="empty-tree">Loading library.</div>
      ) : items.length ? (
        <div className="tree-list" role="tree" aria-label="Media folders">
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

      {scanState !== "idle" ? (
        <div className={`scan-state ${scanState}`}>
          {scanState === "completed" ? <CheckCircle2 size={15} /> : null}
          <span>{scanLabel(scanState)}</span>
        </div>
      ) : null}
      {watchStatus?.enabled &&
      (scanState === "idle" || watchStatus.lastError) ? (
        <div
          className={`scan-state ${
            watchStatus.lastError ? "failed" : "watching"
          }`}
        >
          {!watchStatus.lastError ? <CheckCircle2 size={15} /> : null}
          <span>
            {watchStatus.lastError
              ? "Watcher issue"
              : `Watching ${watchStatus.watchedDirectories} folders`}
          </span>
        </div>
      ) : null}
    </nav>
  );
}

function FolderActionButton({
  disabled,
  icon: Icon,
  label,
  onClick
}: FolderActionButtonProps) {
  return (
    <button
      className="folder-action"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
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
          "--tree-indent": `${item.depth * 14}px`
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
        {item.depth === 0 ? (
          <Rows3 size={15} />
        ) : isExpanded ? (
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

export function folderTreeItemDomId(folderId: string): string {
  return `folder-tree-${folderId}`;
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
