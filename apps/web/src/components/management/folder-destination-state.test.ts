import { describe, expect, it } from "vitest";
import type { TreeResponse } from "../../api/client";
import {
  destinationBreadcrumbs,
  destinationChildren,
  destinationFolderIndex,
  destinationIsProhibited,
  destinationUnavailableReason
} from "./folder-destination-state";

const tree: TreeResponse = {
  roots: [
    {
      id: "root",
      folderId: "root-folder",
      label: "Photos",
      assetCount: 0,
      writable: true,
      sourceVersion: "root-version"
    },
    {
      id: "archive",
      folderId: "archive-folder",
      label: "Archive",
      assetCount: 0,
      writable: false
    }
  ],
  folders: [
    {
      id: "album",
      rootId: "root",
      parentId: "root-folder",
      relativePath: "Album",
      label: "Album",
      assetCount: 0,
      sourceVersion: "album-version"
    },
    {
      id: "child",
      rootId: "root",
      parentId: "album",
      relativePath: "Album/Child",
      label: "Child",
      assetCount: 0
    },
    {
      id: "other",
      rootId: "root",
      parentId: "root-folder",
      relativePath: "Other",
      label: "Other",
      assetCount: 0
    }
  ]
};

describe("destination folder navigation", () => {
  it("includes assigned roots and lists only one immediate level", () => {
    const index = destinationFolderIndex(tree);
    expect(
      [...index.values()]
        .filter((folder) => !folder.parentId)
        .map((folder) => folder.id)
    ).toEqual(["root-folder", "archive-folder"]);
    expect(
      destinationChildren(index, "root-folder").map((folder) => folder.id)
    ).toEqual(["album", "other"]);
    expect(
      destinationChildren(index, "album").map((folder) => folder.id)
    ).toEqual(["child"]);
    expect(index.get("root-folder")?.sourceVersion).toBe("root-version");
  });
  it("builds relative breadcrumbs and blocks the moving folder and every descendant", () => {
    const index = destinationFolderIndex(tree);
    expect(
      destinationBreadcrumbs(index, "child").map((folder) => folder.label)
    ).toEqual(["Photos", "Album", "Child"]);
    expect(destinationIsProhibited(index, "album", "album")).toBe(true);
    expect(destinationIsProhibited(index, "child", "album")).toBe(true);
    expect(destinationIsProhibited(index, "other", "album")).toBe(false);
    expect(destinationIsProhibited(index, "archive-folder", "album")).toBe(
      false
    );
  });
  it("makes a newly committed folder navigable before tree refresh and prefers current server records", () => {
    const created = {
      id: "new",
      rootId: "root",
      parentId: "album",
      relativePath: "Album/New",
      label: "New",
      assetCount: 0,
      writable: true,
      sourceVersion: "new-version"
    };
    const index = destinationFolderIndex(tree, [created]);
    expect(
      destinationChildren(index, "album").map((folder) => folder.id)
    ).toEqual(["child", "new"]);
    expect(
      destinationBreadcrumbs(index, "new").map((folder) => folder.id)
    ).toEqual(["root-folder", "album", "new"]);
    const refreshed = destinationFolderIndex(
      { ...tree, folders: [...tree.folders, { ...created, label: "Renamed" }] },
      [created]
    );
    expect(refreshed.get("new")?.label).toBe("Renamed");
  });
  it("bounds malformed cyclic parent chains", () => {
    const index = destinationFolderIndex(tree);
    index.set("album", { ...index.get("album")!, parentId: "child" });
    expect(destinationBreadcrumbs(index, "child")).toHaveLength(2);
    expect(destinationIsProhibited(index, "child", "album")).toBe(true);
  });
  it("distinguishes disconnected drives from configured read-only folders", () => {
    const index = destinationFolderIndex(tree);
    expect(
      destinationUnavailableReason(tree, index.get("archive-folder")!)
    ).toBe("Read-only");
    const unavailable: TreeResponse = {
      ...tree,
      roots: tree.roots.map((root) => ({
        ...root,
        writable: false,
        writeUnavailableReason: "source_unavailable"
      }))
    };
    expect(destinationUnavailableReason(unavailable, index.get("other")!)).toBe(
      "Drive unavailable"
    );
    expect(destinationUnavailableReason(tree, index.get("other")!)).toBe(
      "Scan required"
    );
  });
});
