import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  GalleryHorizontalEnd,
  GitCompareArrows,
  Grid3X3,
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
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { SidebarTrigger } from "../ui/sidebar";

interface LibraryPathBarProps {
  isGuideOpen: boolean;
  isSettingsOpen: boolean;
  controls?: ReactNode;
  searchDraft: string;
  selectedFolderId: string | null;
  tree: TreeResponse | null;
  view: ViewMode;
  onBackToLibrary: () => void;
  onPreloadView: (view: ViewMode) => void;
  onSearchDraftChange: (value: string) => void;
  onSelectFolder: (folderId: string) => void;
  onSwitchView: (view: ViewMode) => void;
}

interface PathSegment {
  id: string;
  label: string;
}

export function LibraryPathBar({
  isGuideOpen,
  isSettingsOpen,
  controls,
  searchDraft,
  selectedFolderId,
  tree,
  view,
  onBackToLibrary,
  onPreloadView,
  onSearchDraftChange,
  onSelectFolder,
  onSwitchView
}: LibraryPathBarProps) {
  const path = useMemo(
    () => buildFolderPath(tree, selectedFolderId),
    [selectedFolderId, tree]
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

      const searchInput = searchInputRef.current;

      if (!searchInput || searchInput.disabled) {
        return;
      }

      event.preventDefault();
      searchInput.focus({ preventScroll: true });
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <header className="library-path-bar">
      <div className="library-path-navigation">
        <SidebarTrigger />
        <Separator className="library-path-separator" orientation="vertical" />
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap overflow-hidden">
            {isSettingsOpen || isGuideOpen ? (
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
                    {isSettingsOpen ? "Settings" : "User guide"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : path.length ? (
              path.map((segment, index) => {
                const isCurrent = index === path.length - 1;

                return (
                  <Fragment key={segment.id}>
                    {index > 0 ? <BreadcrumbSeparator /> : null}
                    <BreadcrumbItem className="min-w-0">
                      {isCurrent ? (
                        <BreadcrumbPage className="truncate">
                          {segment.label}
                        </BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <button
                            className="max-w-44 truncate"
                            type="button"
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
      {!isSettingsOpen && !isGuideOpen ? (
        <div className="library-path-actions">
          <div className="topbar-search">
            <Search aria-hidden="true" />
            <Input
              className="h-9 pl-9"
              aria-label="Search"
              aria-keyshortcuts="/"
              placeholder="Search"
              ref={searchInputRef}
              type="search"
              value={searchDraft}
              onChange={(event) => onSearchDraftChange(event.target.value)}
            />
          </div>
          {controls}
          {controls ? (
            <Separator
              className="library-view-separator"
              orientation="vertical"
            />
          ) : null}
          <div
            className="library-view-switcher"
            role="group"
            aria-label="Library view"
          >
            {(
              [
                ["gallery", "Gallery view", Grid3X3],
                ["feed", "Feed view", GalleryHorizontalEnd],
                ["compare", "Compare and rank", GitCompareArrows]
              ] as const
            ).map(([viewOption, label, Icon]) => (
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
