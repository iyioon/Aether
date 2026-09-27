import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { LogOut, Settings } from "lucide-react";
import type { LibraryWatchStatus, ScanProgress } from "../../api/client";
import { BrandMark } from "../BrandMark";
import { FolderTreePanel } from "../FolderTreePanel";
import type {
  FolderScanState,
  FolderSortMode,
  FolderTreeItem
} from "../folders/folder-tree-types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from "../ui/sidebar";

interface LibrarySidebarProps {
  error: string | null;
  expandableFolderIds: ReadonlySet<string>;
  expandedFolderCount: number;
  expandedFolderIds: ReadonlySet<string>;
  folderSortMode: FolderSortMode;
  isLoadingTree: boolean;
  isSettingsOpen: boolean;
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
  onLogout: () => void;
  onOpenSettings: () => void;
  onScan: () => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolderExpansion: (folderId: string) => void;
}

const SIDEBAR_WIDTH_STORAGE_KEY = "aether.sidebar.width";
const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 480;

export function LibrarySidebar({
  error,
  expandableFolderIds,
  expandedFolderCount,
  expandedFolderIds,
  folderSortMode,
  isLoadingTree,
  isSettingsOpen,
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
  onLogout,
  onOpenSettings,
  onScan,
  onSelectFolder,
  onToggleFolderExpansion
}: LibrarySidebarProps) {
  const { setOpenMobile } = useSidebar();

  function selectFolder(folderId: string) {
    onSelectFolder(folderId);
    setOpenMobile(false);
  }

  function openSettings() {
    onOpenSettings();
    setOpenMobile(false);
  }

  return (
    <Sidebar collapsible="offcanvas" id="library-sidebar">
      <SidebarHeader className="p-4 pb-2">
        <div className="flex h-12 items-center gap-2 px-2">
          <BrandMark />
          <span className="flex min-w-0 flex-col gap-0.5 leading-none">
            <strong className="truncate font-semibold">Aether</strong>
            <span className="truncate text-xs text-muted-foreground">
              Private library
            </span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="min-h-0 flex-1 px-3 py-2">
          <FolderTreePanel
            error={error}
            expandableFolderIds={expandableFolderIds}
            expandedFolderCount={expandedFolderCount}
            expandedFolderIds={expandedFolderIds}
            folderSortMode={folderSortMode}
            isLoadingTree={isLoadingTree}
            items={items}
            scanProgress={scanProgress}
            scanState={scanState}
            selectedFolderId={selectedFolderId}
            treeTabStopId={treeTabStopId}
            watchStatus={watchStatus}
            onCollapseAll={onCollapseAll}
            onExpandAll={onExpandAll}
            onFolderKeyDown={onFolderKeyDown}
            onFolderSortChange={onFolderSortChange}
            onScan={onScan}
            onSelectFolder={selectFolder}
            onToggleFolderExpansion={onToggleFolderExpansion}
          />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="sidebar-footer-action"
              isActive={isSettingsOpen}
              onClick={openSettings}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="sidebar-footer-action"
              onClick={onLogout}
            >
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <ResizableSidebarRail />
    </Sidebar>
  );
}

function ResizableSidebarRail() {
  const railRef = useRef<HTMLButtonElement>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
    width: number;
    wrapper: HTMLElement;
  } | null>(null);

  useLayoutEffect(() => {
    const wrapper = sidebarWrapperFor(railRef.current);
    const storedWidth = Number.parseFloat(
      window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? ""
    );

    if (wrapper && Number.isFinite(storedWidth)) {
      applySidebarWidth(wrapper, storedWidth, railRef.current);
    }
  }, []);

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const wrapper = sidebarWrapperFor(event.currentTarget);
    const sidebar = wrapper?.querySelector<HTMLElement>(
      '[data-slot="sidebar-container"]'
    );

    if (!wrapper || !sidebar) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startWidth: sidebar.getBoundingClientRect().width,
      startX: event.clientX,
      width: sidebar.getBoundingClientRect().width,
      wrapper
    };
    document.documentElement.dataset.sidebarResizing = "true";
  }

  function resize(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeResize = resizeRef.current;

    if (!activeResize || activeResize.pointerId !== event.pointerId) {
      return;
    }

    activeResize.width = applySidebarWidth(
      activeResize.wrapper,
      activeResize.startWidth + event.clientX - activeResize.startX,
      event.currentTarget
    );
  }

  function finishResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeResize = resizeRef.current;

    if (!activeResize || activeResize.pointerId !== event.pointerId) {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(Math.round(activeResize.width))
    );
    resizeRef.current = null;
    delete document.documentElement.dataset.sidebarResizing;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    const wrapper = sidebarWrapperFor(event.currentTarget);
    const sidebar = wrapper?.querySelector<HTMLElement>(
      '[data-slot="sidebar-container"]'
    );

    if (!wrapper || !sidebar) {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const width = applySidebarWidth(
      wrapper,
      sidebar.getBoundingClientRect().width + direction * 16,
      event.currentTarget
    );
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  }

  function resetWidth(event: ReactPointerEvent<HTMLButtonElement>) {
    const wrapper = sidebarWrapperFor(event.currentTarget);

    if (!wrapper) {
      return;
    }

    applySidebarWidth(wrapper, DEFAULT_SIDEBAR_WIDTH, event.currentTarget);
    window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
  }

  return (
    <SidebarRail
      ref={railRef}
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuenow={DEFAULT_SIDEBAR_WIDTH}
      className="sidebar-resize-rail"
      role="separator"
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onClick={(event) => event.preventDefault()}
      onDoubleClick={resetWidth}
      onKeyDown={resizeWithKeyboard}
      onPointerCancel={finishResize}
      onPointerDown={beginResize}
      onPointerMove={resize}
      onPointerUp={finishResize}
    />
  );
}

function sidebarWrapperFor(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]') ?? null;
}

function applySidebarWidth(
  wrapper: HTMLElement,
  requestedWidth: number,
  rail: HTMLElement | null
): number {
  const maximumWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth * 0.5)
  );
  const width = Math.round(
    Math.min(maximumWidth, Math.max(MIN_SIDEBAR_WIDTH, requestedWidth))
  );

  wrapper.style.setProperty("--sidebar-width", `${width}px`);
  rail?.setAttribute("aria-valuenow", String(width));
  return width;
}
