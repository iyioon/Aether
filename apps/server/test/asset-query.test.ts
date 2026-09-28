import { describe, expect, it } from "vitest";
import {
  buildAssetFilterQuery,
  FINAL_SCORE_SQL
} from "../src/library/asset-query.js";
import type { FolderRecord } from "../src/library/repository-types.js";

const nestedFolder: FolderRecord = {
  id: "folder",
  rootId: "root",
  parentId: "parent",
  relativePath: "Trips/Seoul",
  name: "Seoul",
  assetCount: 12
};

describe("asset filter query", () => {
  it("builds one shared recursive filter for search, tags, and ranked state", () => {
    const query = buildAssetFilterQuery(nestedFolder, {
      folderId: nestedFolder.id,
      recursive: true,
      type: "image",
      search: "night",
      tags: [" Travel ", "travel", "City"],
      scoreFilter: "ranked"
    });

    expect(query.whereClause).toContain("a.root_id = @rootId");
    expect(query.whereClause).toContain("a.relative_path LIKE @relativePrefix");
    expect(query.whereClause).toContain("a.media_type = @mediaType");
    expect(query.whereClause).toContain("asset_search MATCH @searchQuery");
    expect(query.whereClause).toContain(`${FINAL_SCORE_SQL} > 0`);
    expect(query.parameters).toMatchObject({
      rootId: "root",
      folderId: "folder",
      relativePath: "Trips/Seoul",
      relativePrefix: "Trips/Seoul/%",
      mediaType: "image",
      tagFilter0: "travel",
      tagFilter1: "city"
    });
    expect(
      Object.keys(query.parameters).filter((key) => key.startsWith("tag"))
    ).toHaveLength(2);
  });

  it("uses direct folder scope and treats zero as unranked", () => {
    const query = buildAssetFilterQuery(nestedFolder, {
      folderId: nestedFolder.id,
      recursive: false,
      type: "all",
      scoreFilter: "unranked"
    });

    expect(query.whereClause).toContain("a.folder_id = @folderId");
    expect(query.whereClause).toContain(`${FINAL_SCORE_SQL} = 0`);
    expect(query.whereClause).not.toContain("a.media_type = @mediaType");
  });
});
