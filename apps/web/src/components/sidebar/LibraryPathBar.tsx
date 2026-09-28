import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { GalleryHorizontalEnd, Grid3X3, Search } from "lucide-react";
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
  isSettingsOpen: boolean;
  controls?: ReactNode;
  searchDraft: string;
  selectedFolderId: string | null;
  tree: TreeResponse | null;
  view: ViewMode;
  onBackToLibrary: () => void;
  onSearchDraftChange: (value: string) => void;
  onSelectFolder: (folderId: string) => void;
  onSwitchView: (view: ViewMode) => void;
}

interface PathSegment {
  id: string;
  label: string;
}

export function LibraryPathBar({
  isSettingsOpen,
  controls,
  searchDraft,
  selectedFolderId,
  tree,
  view,
  onBackToLibrary,
  onSearchDraftChange,
  onSelectFolder,
  onSwitchView
}: LibraryPathBarProps) {
  const path = buildFolderPath(tree, selectedFolderId);
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
          {isSettingsOpen ? (
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
                <BreadcrumbPage>Settings</BreadcrumbPage>
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
      {!isSettingsOpen ? (
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
          <Button
            aria-label={
              view === "gallery"
                ? "Switch to feed view"
                : "Switch to gallery view"
            }
            size="icon"
            title={view === "gallery" ? "Feed view" : "Gallery view"}
            variant="outline"
            onClick={() => onSwitchView(view === "gallery" ? "feed" : "gallery")}
          >
            {view === "gallery" ? <GalleryHorizontalEnd /> : <Grid3X3 />}
          </Button>
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
