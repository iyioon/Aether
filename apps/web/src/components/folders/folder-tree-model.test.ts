import { describe, expect, it } from "vitest";
import type { TreeResponse } from "../../api/client";
import {
  buildFolderChildrenByParentId,
  buildVisibleFolderItems
} from "./folder-tree-model";

const tree: TreeResponse = {
  roots: [
    { id: "root-b", folderId: "folder-b", label: "Beta", assetCount: 4 },
    { id: "root-a", folderId: "folder-a", label: "Alpha", assetCount: 12 }
  ],
  folders: [
    {
      id: "child-z",
      rootId: "root-a",
      parentId: "folder-a",
      relativePath: "Zulu",
      label: "Zulu",
      assetCount: 2
    },
    {
      id: "child-a",
      rootId: "root-a",
      parentId: "folder-a",
      relativePath: "Archive",
      label: "Archive",
      assetCount: 8
    }
  ]
};

describe("folder tree sorting", () => {
  it("sorts roots and siblings by name while preserving hierarchy", () => {
    const children = buildFolderChildrenByParentId(tree, "name-asc");
    const items = buildVisibleFolderItems({
      tree,
      folderChildrenByParentId: children,
      expandedFolderIds: new Set(["folder-a"]),
      sortMode: "name-asc"
    });

    expect(items.map((item) => item.label)).toEqual([
      "Alpha",
      "Archive",
      "Zulu",
      "Beta"
    ]);
  });

  it("sorts each hierarchy level by item count", () => {
    const children = buildFolderChildrenByParentId(tree, "items-asc");
    const items = buildVisibleFolderItems({
      tree,
      folderChildrenByParentId: children,
      expandedFolderIds: new Set(["folder-a"]),
      sortMode: "items-asc"
    });

    expect(items.map((item) => item.label)).toEqual([
      "Beta",
      "Alpha",
      "Zulu",
      "Archive"
    ]);
  });
});

describe("folder tree actions", () => {
  it("limits configured roots to creation and keeps read-only folders disabled", () => {
    const writableTree: TreeResponse = {
      roots: tree.roots.map((root) => ({
        ...root,
        writable: root.id === "root-a",
        allowedActions: ["create-folder", "rename-folder", "move-folder"]
      })),
      folders: tree.folders.map((folder) => ({
        ...folder,
        ...(folder.id === "child-z" ? { writable: false } : {})
      }))
    };
    const items = buildVisibleFolderItems({
      tree: writableTree,
      folderChildrenByParentId: buildFolderChildrenByParentId(writableTree),
      expandedFolderIds: new Set(["folder-a"])
    });

    expect(
      items.map(({ id, canCreateFolder, canManageFolder }) => ({
        id,
        canCreateFolder,
        canManageFolder
      }))
    ).toEqual([
      { id: "folder-a", canCreateFolder: true, canManageFolder: false },
      { id: "child-a", canCreateFolder: true, canManageFolder: true },
      { id: "child-z", canCreateFolder: false, canManageFolder: false },
      { id: "folder-b", canCreateFolder: false, canManageFolder: false }
    ]);
  });

  it("respects explicit server action restrictions", () => {
    const restrictedTree: TreeResponse = {
      roots: tree.roots.map((root) => ({
        ...root,
        writable: true,
        allowedActions: []
      })),
      folders: tree.folders.map((folder) => ({
        ...folder,
        writable: true,
        allowedActions: folder.id === "child-a" ? ["create-folder"] : []
      }))
    };
    const items = buildVisibleFolderItems({
      tree: restrictedTree,
      folderChildrenByParentId: buildFolderChildrenByParentId(restrictedTree),
      expandedFolderIds: new Set(["folder-a"])
    });

    expect(items.filter((item) => item.canManageFolder)).toEqual([]);
    expect(
      items.filter((item) => item.canCreateFolder).map((item) => item.id)
    ).toEqual(["child-a"]);
  });
});
