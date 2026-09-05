import type { TreeResponse } from "../../api/client";
import type { FolderTreeItem } from "./folder-tree-types";

type RootTreeNode = TreeResponse["roots"][number];
type FolderTreeNode = TreeResponse["folders"][number];

export function buildFolderChildrenByParentId(
  tree: TreeResponse | null
): Map<string, FolderTreeNode[]> {
  const childrenByParentId = new Map<string, FolderTreeNode[]>();

  if (!tree) {
    return childrenByParentId;
  }

  for (const folder of tree.folders) {
    if (!folder.parentId) {
      continue;
    }

    const siblings = childrenByParentId.get(folder.parentId) ?? [];
    siblings.push(folder);
    childrenByParentId.set(folder.parentId, siblings);
  }

  for (const siblings of childrenByParentId.values()) {
    siblings.sort((left, right) => left.label.localeCompare(right.label));
  }

  return childrenByParentId;
}

export function buildFolderById(
  tree: TreeResponse | null
): Map<string, FolderTreeNode> {
  return new Map(tree?.folders.map((folder) => [folder.id, folder]) ?? []);
}

export function buildVisibleFolderItems({
  tree,
  folderChildrenByParentId,
  expandedFolderIds
}: {
  tree: TreeResponse;
  folderChildrenByParentId: Map<string, FolderTreeNode[]>;
  expandedFolderIds: ReadonlySet<string>;
}): FolderTreeItem[] {
  const items: FolderTreeItem[] = [];

  for (const root of tree.roots) {
    appendRootTreeItem(root, items, folderChildrenByParentId, expandedFolderIds);
  }

  return items;
}

export function getExpandableFolderIds(
  tree: TreeResponse | null,
  folderChildrenByParentId: Map<string, FolderTreeNode[]>
): Set<string> {
  const ids = new Set<string>();

  for (const root of tree?.roots ?? []) {
    if ((folderChildrenByParentId.get(root.folderId) ?? []).length > 0) {
      ids.add(root.folderId);
    }
  }

  for (const [folderId, children] of folderChildrenByParentId) {
    if (children.length > 0) {
      ids.add(folderId);
    }
  }

  return ids;
}

export function folderAncestorIds(
  folderId: string,
  folderById: Map<string, FolderTreeNode>
): string[] {
  const ancestors: string[] = [];
  let current = folderById.get(folderId);

  while (current?.parentId) {
    ancestors.unshift(current.parentId);
    current = folderById.get(current.parentId);
  }

  return ancestors;
}

function appendRootTreeItem(
  root: RootTreeNode,
  items: FolderTreeItem[],
  folderChildrenByParentId: Map<string, FolderTreeNode[]>,
  expandedFolderIds: ReadonlySet<string>
) {
  const children = folderChildrenByParentId.get(root.folderId) ?? [];

  items.push({
    id: root.folderId,
    parentId: null,
    label: root.label,
    assetCount: root.assetCount,
    depth: 0,
    hasChildren: children.length > 0
  });

  if (!expandedFolderIds.has(root.folderId)) {
    return;
  }

  for (const child of children) {
    appendFolderTreeItem(child, 1, items, folderChildrenByParentId, expandedFolderIds);
  }
}

function appendFolderTreeItem(
  folder: FolderTreeNode,
  depth: number,
  items: FolderTreeItem[],
  folderChildrenByParentId: Map<string, FolderTreeNode[]>,
  expandedFolderIds: ReadonlySet<string>
) {
  const children = folderChildrenByParentId.get(folder.id) ?? [];

  items.push({
    id: folder.id,
    parentId: folder.parentId,
    label: folder.label,
    assetCount: folder.assetCount,
    depth,
    hasChildren: children.length > 0
  });

  if (!expandedFolderIds.has(folder.id)) {
    return;
  }

  for (const child of children) {
    appendFolderTreeItem(
      child,
      depth + 1,
      items,
      folderChildrenByParentId,
      expandedFolderIds
    );
  }
}
