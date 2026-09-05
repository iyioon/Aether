import {
  GalleryHorizontalEnd,
  Grid3X3,
  Menu,
  PanelLeftOpen,
  Search,
  SlidersHorizontal
} from "lucide-react";
import type { ViewMode } from "../library-state";
import { IconButton } from "../ui/IconButton";

interface LibraryToolbarProps {
  isSidebarCollapsed: boolean;
  isSidebarOpen: boolean;
  searchDraft: string;
  selectedLabel: string;
  totalAssets: number;
  view: ViewMode;
  onExpandSidebar: () => void;
  onOpenSidebar: () => void;
  onSearchDraftChange: (value: string) => void;
  onSwitchView: (view: ViewMode) => void;
}

export function LibraryToolbar({
  isSidebarCollapsed,
  isSidebarOpen,
  searchDraft,
  selectedLabel,
  totalAssets,
  view,
  onExpandSidebar,
  onOpenSidebar,
  onSearchDraftChange,
  onSwitchView
}: LibraryToolbarProps) {
  return (
    <header className="library-toolbar">
      <IconButton
        aria-controls="library-sidebar"
        aria-expanded={isSidebarOpen}
        className="mobile-sidebar-toggle"
        icon={Menu}
        label="Open folders"
        title="Folders"
        onClick={onOpenSidebar}
      />
      <IconButton
        aria-controls="library-sidebar"
        aria-expanded={!isSidebarCollapsed}
        className="desktop-sidebar-expand"
        icon={PanelLeftOpen}
        label="Expand sidebar"
        title="Show folders"
        onClick={onExpandSidebar}
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
          onChange={(event) => onSearchDraftChange(event.target.value)}
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
          onClick={() => onSwitchView(view === "gallery" ? "feed" : "gallery")}
        />
      </div>
    </header>
  );
}

interface FeedCollapsedTopbarProps {
  selectedLabel: string;
  totalAssets: number;
  onOpenControls: () => void;
  onOpenSidebar: () => void;
  onSwitchView: (view: ViewMode) => void;
}

export function FeedCollapsedTopbar({
  selectedLabel,
  totalAssets,
  onOpenControls,
  onOpenSidebar,
  onSwitchView
}: FeedCollapsedTopbarProps) {
  return (
    <div className="feed-collapsed-topbar" aria-label="Feed controls">
      <IconButton
        className="feed-floating-action"
        icon={Menu}
        label="Open folders"
        title="Folders"
        onClick={onOpenSidebar}
      />
      <button
        className="feed-collapsed-title"
        type="button"
        aria-label="Show feed controls"
        aria-expanded="false"
        onClick={onOpenControls}
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
        onClick={onOpenControls}
      />
      <IconButton
        className="feed-floating-action"
        icon={Grid3X3}
        label="Gallery view"
        onClick={() => onSwitchView("gallery")}
      />
    </div>
  );
}
