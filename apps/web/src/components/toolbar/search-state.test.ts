import { describe, expect, it } from "vitest";
import type { TreeResponse } from "../../api/client";
import { MAX_TAG_FILTERS } from "../library-state";
import {
  addPendingSearchTag,
  matchingSearchFolders,
  searchFolders,
  type LibrarySearchValues
} from "./search-state";

describe("pending search tags", () => {
  const value: LibrarySearchValues = {
    folderId: "root",
    search: "holiday",
    tags: ["Travel"],
    tagMatch: "any",
    tagStatus: "all",
    mediaType: "image",
    scoreFilter: "favorites"
  };

  it("includes a typed tag on submission without changing other criteria or the existing draft", () => {
    expect(addPendingSearchTag(value, "  Ｆａｍｉｌｙ   trip ")).toEqual({
      ...value,
      tags: ["Travel", "Family trip"]
    });
    expect(value.tags).toEqual(["Travel"]);
    expect(addPendingSearchTag(value, "  ｔｒａｖｅｌ ")).toBe(value);
    expect(addPendingSearchTag(value, "  ")).toBe(value);
  });

  it("preserves the tag limit and resolves a pending tag against untagged criteria", () => {
    const atLimit = {
      ...value,
      tags: Array.from(
        { length: MAX_TAG_FILTERS },
        (_, index) => `Tag ${index}`
      )
    };
    expect(addPendingSearchTag(atLimit, "Extra")).toBe(atLimit);
    expect(
      addPendingSearchTag(
        { ...value, tags: [], tagStatus: "untagged" },
        "Family"
      )
    ).toEqual({ ...value, tags: ["Family"], tagStatus: "all" });
  });
});

describe("search folder scope", () => {
  const tree: TreeResponse = {
    roots: [
      { id: "a", folderId: "root-a", label: "Archive", assetCount: 2 },
      { id: "b", folderId: "root-b", label: "Photos", assetCount: 1 }
    ],
    folders: [
      {
        id: "root-a",
        rootId: "a",
        parentId: null,
        relativePath: "",
        label: "Archive",
        assetCount: 2,
        writable: false
      },
      {
        id: "summer-a",
        rootId: "a",
        parentId: "root-a",
        relativePath: "Family/Summer",
        label: "Summer",
        assetCount: 1,
        writable: false
      },
      {
        id: "summer-b",
        rootId: "b",
        parentId: "root-b",
        relativePath: "Summer",
        label: "Summer",
        assetCount: 1,
        writable: true
      }
    ]
  };

  it("includes read-only folders and distinguishes matching names by root and path", () => {
    const folders = searchFolders(tree);
    expect(folders.map((folder) => folder.label)).toEqual([
      "Archive",
      "Archive / Family / Summer",
      "Photos",
      "Photos / Summer"
    ]);
    expect(
      matchingSearchFolders(folders, "SUMMER archive").options.map(
        (folder) => folder.id
      )
    ).toEqual(["summer-a"]);
    expect(searchFolders(null)).toEqual([]);
  });

  it("bounds visible options while matching the entire indexed tree", () => {
    const folders = searchFolders({
      roots: tree.roots,
      folders: Array.from({ length: 1_000 }, (_, index) => ({
        id: `folder-${index}`,
        rootId: "a",
        parentId: "root-a",
        relativePath: `Folder ${index}`,
        label: `Folder ${index}`,
        assetCount: 0
      }))
    });
    const matches = matchingSearchFolders(folders, "archive");
    expect(matches.total).toBe(1_001);
    expect(matches.options).toHaveLength(50);
    const selectedMatches = matchingSearchFolders(folders, "", "folder-999");
    expect(selectedMatches.total).toBe(folders.length);
    expect(selectedMatches.options).toHaveLength(50);
    expect(selectedMatches.options.at(-1)?.id).toBe("folder-999");
    expect(matchingSearchFolders(folders, "  ", "folder-999").options).toEqual(
      selectedMatches.options
    );
    expect(
      matchingSearchFolders(folders, "Folder 998", "folder-999").options.map(
        (folder) => folder.id
      )
    ).toEqual(["folder-998"]);
    expect(
      matchingSearchFolders(folders, "no matching folder", "folder-999").options
    ).toEqual([]);
    expect(
      matchingSearchFolders(folders, "Ｆｏｌｄｅｒ 999").options.map(
        (folder) => folder.id
      )
    ).toEqual(["folder-999"]);
  });
});
