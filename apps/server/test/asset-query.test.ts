import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  buildAssetFilterQuery,
  buildAssetOrderClause,
  FINAL_SCORE_SQL
} from "../src/library/asset-query.js";
import type {
  AssetListOptions,
  FolderRecord
} from "../src/library/repository-types.js";

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
    expect(query.whereClause).toContain(
      "substr(a.relative_path, 1, length(@relativePrefix)) = @relativePrefix"
    );
    expect(query.whereClause).toContain("a.media_type = @mediaType");
    expect(query.whereClause).toContain("asset_search MATCH @searchQuery");
    expect(query.whereClause).toContain(`${FINAL_SCORE_SQL} > 0`);
    expect(query.parameters).toMatchObject({
      rootId: "root",
      folderId: "folder",
      relativePath: "Trips/Seoul",
      relativePrefix: "Trips/Seoul/",
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

  it.each([
    {
      tagMatch: "all",
      tagStatus: "all",
      tags: ["travel", "night"],
      expected: ["a"]
    },
    {
      tagMatch: "any",
      tagStatus: "all",
      tags: ["travel", "night"],
      expected: ["a", "b"]
    },
    { tagMatch: "any", tagStatus: "tagged", tags: [], expected: ["a", "b"] },
    { tagMatch: "all", tagStatus: "untagged", tags: [], expected: ["c"] },
    { tagMatch: "any", tagStatus: "untagged", tags: ["travel"], expected: [] }
  ] as const)(
    "combines $tagMatch matching with $tagStatus status",
    ({ tagMatch, tagStatus, tags, expected }) => {
      const db = new Database(":memory:");
      try {
        db.exec(`
        CREATE TABLE assets (id TEXT, root_id TEXT, folder_id TEXT, relative_path TEXT, lifecycle TEXT);
        CREATE TABLE tags (id TEXT, normalized_name TEXT);
        CREATE TABLE asset_tags (asset_id TEXT, tag_id TEXT);
        INSERT INTO assets VALUES ('a', 'root', 'folder', 'a.jpg', 'active'),
          ('b', 'root', 'folder', 'b.jpg', 'active'), ('c', 'root', 'folder', 'c.jpg', 'active'),
          ('outside', 'other', 'folder', 'outside.jpg', 'active'), ('trashed', 'root', 'folder', 'trash.jpg', 'trashed');
        INSERT INTO tags VALUES ('travel', 'travel'), ('night', 'night');
        INSERT INTO asset_tags VALUES ('a', 'travel'), ('a', 'night'), ('b', 'travel'),
          ('outside', 'night'), ('trashed', 'travel');
      `);
        const query = buildAssetFilterQuery(nestedFolder, {
          folderId: "folder",
          recursive: false,
          type: "all",
          tags: [...tags],
          tagMatch,
          tagStatus
        });
        expect(
          db
            .prepare(
              `SELECT a.id FROM assets a WHERE ${query.whereClause} ORDER BY a.id`
            )
            .all(query.parameters)
        ).toEqual(expected.map((id) => ({ id })));
      } finally {
        db.close();
      }
    }
  );

  it.each([
    ["a_b", "axb"],
    ["100%", "1000"],
    ["Case", "case"]
  ])("scopes %s literally without including %s", (selected, sibling) => {
    const db = new Database(":memory:");
    try {
      db.exec(
        "CREATE TABLE assets (id TEXT, root_id TEXT, relative_path TEXT, lifecycle TEXT)"
      );
      const insert = db.prepare(
        "INSERT INTO assets VALUES (?, 'root', ?, 'active')"
      );
      insert.run("direct", `${selected}/photo.jpg`);
      insert.run("nested", `${selected}/child/photo.jpg`);
      insert.run("sibling", `${sibling}/photo.jpg`);
      insert.run("prefix", `${selected}suffix/photo.jpg`);
      const query = buildAssetFilterQuery(
        { ...nestedFolder, relativePath: selected },
        { folderId: nestedFolder.id, recursive: true, type: "all" }
      );
      expect(
        db
          .prepare(
            `SELECT a.id FROM assets a WHERE ${query.whereClause} ORDER BY a.id`
          )
          .all(query.parameters)
      ).toEqual([{ id: "direct" }, { id: "nested" }]);
    } finally {
      db.close();
    }
  });
});

describe("asset ordering", () => {
  function fixture() {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE assets (id TEXT, name TEXT, mtime_ms INTEGER, size_bytes INTEGER, duration_ms INTEGER, media_type TEXT);
      CREATE TABLE asset_annotations (asset_id TEXT, manual_score INTEGER, favorite INTEGER);
      CREATE TABLE asset_rankings (asset_id TEXT, comparison_score INTEGER, manual_adjustment INTEGER);
      CREATE TABLE tags (id TEXT PRIMARY KEY, normalized_name TEXT);
      CREATE TABLE asset_tags (asset_id TEXT, tag_id TEXT);
      INSERT INTO assets VALUES ('a', 'Zed.jpg', 1000, 300, 2000, 'image'),
        ('b', 'Able.jpg', 2000, 100, 1000, 'image'), ('c', 'Clip.mp4', 3000, 200, NULL, 'video'),
        ('d', 'Blank.jpg', 4000, 100, 1000, 'image');
      INSERT INTO asset_annotations VALUES ('a', 10, 1), ('b', 10, 0), ('c', 5, 1), ('d', 0, 1);
      INSERT INTO tags VALUES ('alpha', 'a'), ('beta', 'b'), ('zulu', 'z');
      INSERT INTO asset_tags VALUES ('a', 'alpha'), ('a', 'zulu'), ('b', 'alpha'), ('b', 'beta'), ('c', 'alpha');
    `);
    const order = (
      options: Pick<AssetListOptions, "sort" | "sortDirection" | "sortCriteria">
    ) =>
      (
        db
          .prepare(
            `SELECT a.id FROM assets a LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
        LEFT JOIN asset_rankings ar ON ar.asset_id = a.id ORDER BY ${buildAssetOrderClause(options)}`
          )
          .all() as Array<{ id: string }>
      ).map((row) => row.id);
    return { db, order };
  }

  it("honors ordered criteria before legacy hidden tie-breakers and keeps zero last at the score criterion", () => {
    const { db, order } = fixture();
    try {
      expect(order({ sort: "score" })).toEqual(["a", "b", "c", "d"]);
      expect(
        order({
          sort: "score",
          sortCriteria: [
            { field: "score", direction: "desc" },
            { field: "filename", direction: "asc" }
          ]
        })
      ).toEqual(["b", "a", "c", "d"]);
      expect(
        order({
          sort: "score",
          sortCriteria: [
            { field: "score", direction: "asc" },
            { field: "favorite", direction: "desc" }
          ]
        })
      ).toEqual(["c", "a", "b", "d"]);
      expect(
        order({
          sort: "favorite",
          sortCriteria: [
            { field: "favorite", direction: "desc" },
            { field: "score", direction: "asc" }
          ]
        })
      ).toEqual(["c", "a", "d", "b"]);
    } finally {
      db.close();
    }
  });

  it("orders dates, sizes, types and durations with stable ID ties and missing durations last", () => {
    const { db, order } = fixture();
    try {
      expect(
        order({
          sort: "date",
          sortCriteria: [{ field: "date", direction: "asc" }]
        })
      ).toEqual(["a", "b", "c", "d"]);
      expect(
        order({
          sort: "size",
          sortCriteria: [
            { field: "size", direction: "asc" },
            { field: "filename", direction: "desc" }
          ]
        })
      ).toEqual(["d", "b", "c", "a"]);
      expect(
        order({
          sort: "type",
          sortCriteria: [
            { field: "type", direction: "asc" },
            { field: "date", direction: "desc" }
          ]
        })
      ).toEqual(["d", "b", "a", "c"]);
      expect(
        order({
          sort: "duration",
          sortCriteria: [{ field: "duration", direction: "asc" }]
        })
      ).toEqual(["b", "d", "a", "c"]);
      expect(
        order({
          sort: "duration",
          sortCriteria: [{ field: "duration", direction: "desc" }]
        })
      ).toEqual(["a", "b", "d", "c"]);
    } finally {
      db.close();
    }
  });

  it("sorts complete normalized tag sequences in both directions with untagged last and no separator collisions", () => {
    const { db, order } = fixture();
    try {
      expect(
        order({
          sort: "tags",
          sortCriteria: [{ field: "tags", direction: "asc" }]
        })
      ).toEqual(["c", "b", "a", "d"]);
      expect(
        order({
          sort: "tags",
          sortCriteria: [{ field: "tags", direction: "desc" }]
        })
      ).toEqual(["a", "b", "c", "d"]);
      db.prepare("INSERT INTO tags VALUES ('embedded', ?)").run("a\u0000b");
      db.exec(
        "DELETE FROM asset_tags WHERE asset_id='a'; INSERT INTO asset_tags VALUES ('a','embedded');"
      );
      expect(
        order({
          sort: "tags",
          sortCriteria: [{ field: "tags", direction: "asc" }]
        })
      ).toEqual(["c", "b", "a", "d"]);
    } finally {
      db.close();
    }
  });

  it("rejects duplicate, unbounded, random-combined and untrusted sort criteria before preparing SQL", () => {
    const criteria = [{ field: "date", direction: "asc" }] as const;
    expect(() =>
      buildAssetOrderClause({ sort: "date", sortCriteria: [] })
    ).toThrow(RangeError);
    expect(() =>
      buildAssetOrderClause({
        sort: "date",
        sortCriteria: [...criteria, ...criteria]
      })
    ).toThrow(RangeError);
    expect(() =>
      buildAssetOrderClause({ sort: "random", sortCriteria: [...criteria] })
    ).toThrow(RangeError);
    expect(() =>
      buildAssetOrderClause({
        sort: "date",
        sortCriteria: [
          { field: "date; DROP TABLE assets" as never, direction: "asc" }
        ]
      })
    ).toThrow(RangeError);
    expect(() =>
      buildAssetOrderClause({
        sort: "date",
        sortCriteria: [{ field: "date", direction: "ASC NULLS FIRST" as never }]
      })
    ).toThrow(RangeError);
  });
});
