import { describe, expect, it } from "vitest";
import type { AssetRecord, TreeResponse } from "../../api/client";
import {
  assetIsWritable,
  folderIsWritable,
  folderWithin,
  invalidName,
  managementFolders,
  mediaNameStem
} from "./management-model";
const tree = {
  roots: [{ id: "r", folderId: "root", writable: true }],
  folders: [
    { id: "root", rootId: "r", parentId: null },
    { id: "a", rootId: "r", parentId: "root" },
    { id: "b", rootId: "r", parentId: "a" },
    { id: "other", rootId: "other-root", parentId: null }
  ]
} as TreeResponse;
describe("management eligibility", () => {
  it("requires a known writable root and source version", () => {
    expect(folderIsWritable(tree, "a")).toBe(true);
    expect(folderIsWritable(tree, "other")).toBe(false);
    expect(
      assetIsWritable(tree, {
        folderId: "a",
        sourceVersion: "v1"
      } as AssetRecord)
    ).toBe(true);
    expect(assetIsWritable(tree, { folderId: "a" } as AssetRecord)).toBe(false);
  });
  it("checks recursive scope by identity without prefix collisions", () => {
    expect(folderWithin(tree, "b", "a")).toBe(true);
    expect(folderWithin(tree, "a", "b")).toBe(false);
    expect(folderWithin(tree, "other", "a")).toBe(false);
  });
  it("does not loop on an invalid cyclic tree", () => {
    expect(
      folderWithin(
        {
          ...tree,
          folders: [
            { id: "a", parentId: "b" },
            { id: "b", parentId: "a" }
          ]
        } as TreeResponse,
        "a",
        "other"
      )
    ).toBe(false);
  });
});
describe("management names", () => {
  it("preserves only the actual media suffix, including mixed case and extra dots", () => {
    expect(
      mediaNameStem({ name: "Trip.2026.JPG", extension: "jpg" } as AssetRecord)
    ).toBe("Trip.2026");
    expect(
      mediaNameStem({ name: "photo.jpg", extension: ".jpg" } as AssetRecord)
    ).toBe("photo");
  });
  it("rejects invalid local drafts without removing meaningful spaces or Unicode", () => {
    for (const value of [
      "",
      " ",
      ".hidden",
      "../file",
      "a/b",
      "a\\b",
      " folder",
      "folder "
    ])
      expect(invalidName(value)).toBe(true);
    expect(invalidName("여행 2026")).toBe(false);
  });
});

it("includes assigned roots as writable destinations even though tree.folders excludes roots", () => {
  const response = {
    roots: [
      {
        id: "root-id",
        folderId: "folder-id",
        label: "Library",
        assetCount: 0,
        writable: true,
        sourceVersion: "v1"
      }
    ],
    folders: []
  } as TreeResponse;
  expect(managementFolders(response)).toEqual([
    expect.objectContaining({
      id: "folder-id",
      sourceVersion: "v1",
      writable: true
    })
  ]);
});
