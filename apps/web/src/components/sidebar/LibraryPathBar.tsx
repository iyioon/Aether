import {
  Fragment,
  useEffect,
  useMemo,
  type ReactNode,
  type RefObject
} from "react";
import {
  ChevronDown,
  GalleryHorizontalEnd,
  GitCompareArrows,
  Grid3X3,
  MoreHorizontal,
  Search
} from "lucide-react";
import type { TreeResponse } from "../../api/client";
import type { ViewMode } from "../library-state";
import {
  hasOpenKeyboardLayer,
  hasShortcutModifier,
  isEditableKeyboardTarget
} from "../../lib/keyboard";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "../ui/breadcrumb";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { SidebarTrigger, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface LibraryPathBarProps {
  isFeedChromeHidden: boolean;
  isGuideOpen: boolean;
  isSettingsOpen: boolean;
  isTrashOpen?: boolean;
  isAddMediaOpen?: boolean;
  isActivityOpen?: boolean;
  controls?: ReactNode;
  status?: ReactNode;
  hasSearchCriteria: boolean;
  isSearchOpen: boolean;
  searchTriggerRef: RefObject<HTMLButtonElement | null>;
  selectedFolderId: string | null;
  tree: TreeResponse | null;
  view: ViewMode;
  onBackToLibrary: () => void;
  onPreloadView: (view: ViewMode) => void;
  onOpenSearch: () => void;
  onSelectFolder: (folderId: string) => void;
  onSwitchView: (view: ViewMode) => void;
}

interface PathSegment {
  id: string;
  label: string;
}

const libraryViews = [
  { value: "gallery", label: "Gallery view", name: "Gallery", icon: Grid3X3 },
  {
    value: "feed",
    label: "Feed view",
    name: "Feed",
    icon: GalleryHorizontalEnd
  },
  {
    value: "compare",
    label: "Compare and rank",
    name: "Compare",
    icon: GitCompareArrows
  }
] as const;

export function LibraryPathBar({
  isFeedChromeHidden,
  isGuideOpen,
  isSettingsOpen,
  isTrashOpen = false,
  isAddMediaOpen = false,
  isActivityOpen = false,
  controls,
  status,
  hasSearchCriteria,
  isSearchOpen,
  searchTriggerRef,
  selectedFolderId,
  tree,
  view,
  onBackToLibrary,
  onPreloadView,
  onOpenSearch,
  onSelectFolder,
  onSwitchView
}: LibraryPathBarProps) {
  const { isMobile } = useSidebar();
  const path = useMemo(
    () => buildFolderPath(tree, selectedFolderId),
    [selectedFolderId, tree]
  );
  const collapsedParents = path.length > 2 ? path.slice(1, -1) : [];
  const currentView = libraryViews.find((option) => option.value === view)!;
  const isLibraryOpen =
    !isSettingsOpen &&
    !isGuideOpen &&
    !isTrashOpen &&
    !isAddMediaOpen &&
    !isActivityOpen;

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.key !== "/" ||
        hasShortcutModifier(event) ||
        isEditableKeyboardTarget(event.target) ||
        hasOpenKeyboardLayer()
      ) {
        return;
      }

      const searchButton = searchTriggerRef.current;

      if (!searchButton || searchButton.disabled) {
        return;
      }

      event.preventDefault();
      searchButton.click();
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [searchTriggerRef]);

  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="library-search-trigger"
          type="button"
          ref={searchTriggerRef}
          size="icon"
          variant="ghost"
          aria-label="Search"
          aria-description={
            hasSearchCriteria ? "Search criteria are active" : undefined
          }
          aria-keyshortcuts="/"
          aria-haspopup="dialog"
          aria-expanded={isSearchOpen}
          data-active={hasSearchCriteria}
          onClick={onOpenSearch}
        >
          <Search aria-hidden="true" />
          {hasSearchCriteria ? (
            <span className="library-search-indicator" aria-hidden="true" />
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        className="library-search-tooltip"
        side="left"
        sideOffset={8}
      >
        {hasSearchCriteria ? "Search criteria are active (/)" : "Search (/)"}
      </TooltipContent>
    </Tooltip>
  );

  const viewSwitcher = (
    <div
      className="library-view-switcher"
      role="group"
      aria-label="Library view"
    >
      {libraryViews.map(({ value: viewOption, label, icon: Icon }) => (
        <Button
          aria-label={label}
          aria-pressed={view === viewOption}
          data-active={view === viewOption ? "true" : "false"}
          key={viewOption}
          size="icon"
          title={label}
          variant={view === viewOption ? "secondary" : "ghost"}
          onFocus={() => onPreloadView(viewOption)}
          onClick={() => onSwitchView(viewOption)}
          onPointerEnter={() => onPreloadView(viewOption)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );

  if (
    isMobile &&
    view === "feed" &&
    !isSettingsOpen &&
    !isGuideOpen &&
    !isTrashOpen &&
    !isAddMediaOpen &&
    !isActivityOpen
  ) {
    return (
      <div
        className="feed-view-controls"
        data-hidden={isFeedChromeHidden}
        inert={isFeedChromeHidden}
      >
        {status}
        {controls}
        {searchButton}
        {viewSwitcher}
      </div>
    );
  }

  return (
    <header className="library-path-bar">
      <div className="library-path-heading">
        <div className="library-path-navigation">
          <SidebarTrigger aria-controls="library-sidebar" />
          <Separator
            className="library-path-separator"
            orientation="vertical"
          />
          <Breadcrumb>
            <BreadcrumbList className="library-folder-breadcrumb flex-nowrap overflow-hidden">
              {isSettingsOpen ||
              isGuideOpen ||
              isTrashOpen ||
              isAddMediaOpen ||
              isActivityOpen ? (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <button type="button" onClick={onBackToLibrary}>
                        Library
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>
                      {isSettingsOpen
                        ? "Settings"
                        : isActivityOpen
                          ? "Activity"
                          : isAddMediaOpen
                            ? "Add media"
                            : isTrashOpen
                              ? "Trash"
                              : "User guide"}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : path.length ? (
                path.map((segment, index) => {
                  const isCurrent = index === path.length - 1;
                  if (collapsedParents.length && index > 0 && !isCurrent)
                    return null;

                  return (
                    <Fragment key={segment.id}>
                      {index > 0 ? <BreadcrumbSeparator /> : null}
                      {isCurrent && collapsedParents.length ? (
                        <>
                          <BreadcrumbItem className="library-parent-folders">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label="Show parent folders"
                                >
                                  <MoreHorizontal aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                className="library-parent-folder-menu"
                                align="start"
                                collisionPadding={12}
                                aria-label="Parent folders"
                                aria-labelledby={undefined}
                              >
                                {collapsedParents.map((parent) => (
                                  <DropdownMenuItem
                                    key={parent.id}
                                    onSelect={() => onSelectFolder(parent.id)}
                                    title={parent.label}
                                  >
                                    <span className="truncate">
                                      {parent.label}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                        </>
                      ) : null}
                      <BreadcrumbItem
                        className={
                          isCurrent
                            ? "library-current-folder min-w-0"
                            : "library-root-folder min-w-0"
                        }
                      >
                        {isCurrent ? (
                          <BreadcrumbPage
                            className="truncate"
                            title={segment.label}
                          >
                            {segment.label}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <button
                              className="truncate"
                              type="button"
                              title={segment.label}
                              onClick={() => onSelectFolder(segment.id)}
                            >
                              {segment.label}
                            </button>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  );
                })
              ) : (
                <BreadcrumbItem>
                  <BreadcrumbPage>Library</BreadcrumbPage>
                </BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        {isLibraryOpen ? (
          <div className="library-path-status">{status}</div>
        ) : null}
        {isLibraryOpen ? searchButton : null}
      </div>
      {isLibraryOpen ? (
        <div className="library-path-actions">
          {controls}
          <div className="library-path-view-actions">
            <Separator
              className="library-view-separator"
              orientation="vertical"
            />
            {viewSwitcher}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="library-view-menu-trigger"
                  size="icon"
                  variant="outline"
                  aria-label={`Change view, ${currentView.name} selected`}
                >
                  <currentView.icon aria-hidden="true" />
                  <ChevronDown className="size-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" collisionPadding={12}>
                <DropdownMenuRadioGroup
                  aria-label="Library view"
                  value={view}
                  onValueChange={(value) => {
                    const option = libraryViews.find(
                      (entry) => entry.value === value
                    );
                    if (option) onSwitchView(option.value);
                  }}
                >
                  {libraryViews.map(({ value, name, icon: Icon }) => (
                    <DropdownMenuRadioItem
                      className="min-h-11"
                      key={value}
                      value={value}
                      onFocus={() => onPreloadView(value)}
                      onPointerEnter={() => onPreloadView(value)}
                    >
                      <Icon aria-hidden="true" />
                      {name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function buildFolderPath(
  tree: TreeResponse | null,
  selectedFolderId: string | null
): PathSegment[] {
  if (!tree || !selectedFolderId) {
    return [];
  }

  const selectedRoot = tree.roots.find(
    (root) => root.folderId === selectedFolderId
  );
  if (selectedRoot) {
    return [{ id: selectedRoot.folderId, label: selectedRoot.label }];
  }

  const folderById = new Map(tree.folders.map((folder) => [folder.id, folder]));
  const selectedFolder = folderById.get(selectedFolderId);
  if (!selectedFolder) {
    return [];
  }

  const path: PathSegment[] = [];
  let current: TreeResponse["folders"][number] | undefined = selectedFolder;

  while (current) {
    path.unshift({ id: current.id, label: current.label });
    current = current.parentId ? folderById.get(current.parentId) : undefined;
  }

  const root = tree.roots.find((entry) => entry.id === selectedFolder.rootId);
  if (root && path[0]?.id !== root.folderId) {
    path.unshift({ id: root.folderId, label: root.label });
  }

  return path;
}
