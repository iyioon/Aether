import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { LogOut, PanelLeftClose, X } from "lucide-react";
import type { LibraryWatchStatus } from "../../api/client";
import { BrandMark } from "../BrandMark";
import { FolderTreePanel } from "../FolderTreePanel";
import type {
  FolderScanState,
  FolderTreeItem
} from "../folders/folder-tree-types";
import { IconButton } from "../ui/IconButton";

interface LibrarySidebarProps {
  error: string | null;
  expandableFolderIds: ReadonlySet<string>;
  expandedFolderCount: number;
  expandedFolderIds: ReadonlySet<string>;
  isLoadingTree: boolean;
  isSidebarCollapsed: boolean;
  isSidebarOpen: boolean;
  items: FolderTreeItem[];
  scanState: FolderScanState;
  selectedFolderId: string | null;
  treeTabStopId: string | null;
  watchStatus: LibraryWatchStatus | null;
  onCloseSidebar: () => void;
  onCollapseAll: () => void;
  onCollapseSidebar: () => void;
  onExpandAll: () => void;
  onFolderKeyDown: (
    event: ReactKeyboardEvent<HTMLElement>,
    item: FolderTreeItem
  ) => void;
  onLogout: () => void;
  onScan: () => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolderExpansion: (folderId: string) => void;
}

export function LibrarySidebar({
  error,
  expandableFolderIds,
  expandedFolderCount,
  expandedFolderIds,
  isLoadingTree,
  isSidebarCollapsed,
  isSidebarOpen,
  items,
  scanState,
  selectedFolderId,
  treeTabStopId,
  watchStatus,
  onCloseSidebar,
  onCollapseAll,
  onCollapseSidebar,
  onExpandAll,
  onFolderKeyDown,
  onLogout,
  onScan,
  onSelectFolder,
  onToggleFolderExpansion
}: LibrarySidebarProps) {
  return (
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
          onClick={onCollapseSidebar}
        />
        <IconButton
          aria-controls="library-sidebar"
          aria-expanded={isSidebarOpen}
          className="mobile-sidebar-close"
          icon={X}
          label="Close folders"
          onClick={onCloseSidebar}
        />
      </div>

      <FolderTreePanel
        error={error}
        expandableFolderIds={expandableFolderIds}
        expandedFolderCount={expandedFolderCount}
        expandedFolderIds={expandedFolderIds}
        isLoadingTree={isLoadingTree}
        items={items}
        scanState={scanState}
        selectedFolderId={selectedFolderId}
        treeTabStopId={treeTabStopId}
        watchStatus={watchStatus}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
        onFolderKeyDown={onFolderKeyDown}
        onScan={onScan}
        onSelectFolder={onSelectFolder}
        onToggleFolderExpansion={onToggleFolderExpansion}
      />

      <div className="sidebar-actions">
        <button className="ghost-action" type="button" onClick={onLogout}>
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
