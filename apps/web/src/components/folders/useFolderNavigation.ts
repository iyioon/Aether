import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import type { TreeResponse } from "../../api/client";
import { setsEqual } from "../app/app-helpers";
import {
  readFolderNavigationState,
  writeFolderNavigationState
} from "../sidebar/sidebar-state";
import { folderTreeItemDomId } from "./folder-tree-dom";
import {
  buildFolderById,
  buildFolderChildrenByParentId,
  buildVisibleFolderItems,
  folderAncestorIds,
  getExpandableFolderIds
} from "./folder-tree-model";
import type { FolderSortMode, FolderTreeItem } from "./folder-tree-types";

interface UseFolderNavigationOptions {
  selectedFolderId: string | null;
  tree: TreeResponse | null;
  onSelectFolder: (folderId: string) => void;
}

export function useFolderNavigation({
  selectedFolderId,
  tree,
  onSelectFolder
}: UseFolderNavigationOptions) {
  const [initialNavigationState] = useState(readFolderNavigationState);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(initialNavigationState?.expandedFolderIds ?? [])
  );
  const [folderSortMode, setFolderSortMode] = useState<FolderSortMode>(
    initialNavigationState?.folderSortMode ?? "name-asc"
  );
  const hasInitializedExpansionRef = useRef(initialNavigationState !== null);
  const folderChildrenByParentId = useMemo(
    () => buildFolderChildrenByParentId(tree, folderSortMode),
    [folderSortMode, tree]
  );
  const folderById = useMemo(() => buildFolderById(tree), [tree]);
  const visibleFolderItems = useMemo(
    () =>
      tree
        ? buildVisibleFolderItems({
            tree,
            folderChildrenByParentId,
            expandedFolderIds,
            sortMode: folderSortMode
          })
        : [],
    [expandedFolderIds, folderChildrenByParentId, folderSortMode, tree]
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
    if (!tree || !selectedFolderId) {
      return;
    }

    setExpandedFolderIds((current) => {
      const next = new Set(current);

      for (const folderId of next) {
        if (!expandableFolderIds.has(folderId)) {
          next.delete(folderId);
        }
      }

      if (!hasInitializedExpansionRef.current) {
        for (const root of tree.roots) {
          next.add(root.folderId);
        }
        hasInitializedExpansionRef.current = true;
      }

      for (const ancestorId of folderAncestorIds(
        selectedFolderId,
        folderById
      )) {
        next.add(ancestorId);
      }

      return setsEqual(current, next) ? current : next;
    });
  }, [expandableFolderIds, folderById, selectedFolderId, tree]);

  useEffect(() => {
    if (!tree) {
      return;
    }

    writeFolderNavigationState({
      expandedFolderIds: [...expandedFolderIds],
      folderSortMode
    });
  }, [expandedFolderIds, folderSortMode, tree]);

  const toggleFolderExpansion = useCallback(
    (folderId: string) => {
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
    },
    [expandableFolderIds]
  );

  const expandAllFolders = useCallback(() => {
    setExpandedFolderIds(new Set(expandableFolderIds));
  }, [expandableFolderIds]);

  const collapseAllFolders = useCallback(() => {
    setExpandedFolderIds(new Set());
  }, []);

  const handleFolderTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, item: FolderTreeItem) => {
      const currentIndex = visibleFolderItems.findIndex(
        (visibleItem) => visibleItem.id === item.id
      );

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextItem =
            visibleFolderItems[
              Math.min(currentIndex + 1, visibleFolderItems.length - 1)
            ];
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
          onSelectFolder(item.id);
          break;
        }
        default:
          break;
      }
    },
    [
      expandedFolderIds,
      folderChildrenByParentId,
      onSelectFolder,
      toggleFolderExpansion,
      visibleFolderItems
    ]
  );

  return {
    collapseAllFolders,
    expandableFolderIds,
    expandedFolderCount,
    expandedFolderIds,
    expandAllFolders,
    folderSortMode,
    handleFolderTreeKeyDown,
    setFolderSortMode,
    treeTabStopId,
    toggleFolderExpansion,
    visibleFolderItems
  };
}

function focusFolderItem(folderId: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(folderTreeItemDomId(folderId))?.focus();
  });
}
