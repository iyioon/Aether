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
