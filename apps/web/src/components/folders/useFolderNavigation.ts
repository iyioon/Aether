import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import type { TreeResponse } from "../../api/client";
import { setsEqual } from "../app/app-helpers";
import { folderTreeItemDomId } from "./folder-tree-dom";
import {
  buildFolderById,
  buildFolderChildrenByParentId,
  buildVisibleFolderItems,
  folderAncestorIds,
  getExpandableFolderIds
} from "./folder-tree-model";
import type { FolderTreeItem } from "./folder-tree-types";

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
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set()
  );
  const folderChildrenByParentId = useMemo(
    () => buildFolderChildrenByParentId(tree),
    [tree]
  );
  const folderById = useMemo(() => buildFolderById(tree), [tree]);
  const visibleFolderItems = useMemo(
    () =>
      tree
        ? buildVisibleFolderItems({
            tree,
            folderChildrenByParentId,
            expandedFolderIds
          })
        : [],
    [expandedFolderIds, folderChildrenByParentId, tree]
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

      if (current.size === 0) {
        for (const root of tree.roots) {
          next.add(root.folderId);
        }
      }

      for (const ancestorId of folderAncestorIds(selectedFolderId, folderById)) {
        next.add(ancestorId);
      }

      return setsEqual(current, next) ? current : next;
    });
  }, [folderById, selectedFolderId, tree]);

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
    handleFolderTreeKeyDown,
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
