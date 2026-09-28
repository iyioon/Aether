import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../api/client";
import { buildLeaderboardEntries } from "./leaderboard-model";

describe("buildLeaderboardEntries", () => {
  it("sorts final scores and gives tied scores the same competition rank", () => {
    const entries = buildLeaderboardEntries([
      asset("low", 12),
      asset("leader", 40),
      asset("tie-a", 25, 3),
      asset("tie-b", 25, 2)
    ]);

    expect(
      entries.map(({ asset: entryAsset, rank }) => [entryAsset.id, rank])
    ).toEqual([
      ["leader", 1],
      ["tie-a", 2],
      ["tie-b", 2],
      ["low", 4]
    ]);
  });

  it("places zero-score media last and marks it unranked", () => {
    const entries = buildLeaderboardEntries([
      asset("newer-zero", 0, 10),
      asset("ranked", 1),
      asset("older-zero", 0, 2)
    ]);

    expect(
      entries.map(({ asset: entryAsset, rank }) => [entryAsset.id, rank])
    ).toEqual([
      ["ranked", 1],
      ["newer-zero", null],
      ["older-zero", null]
    ]);
  });
});

function asset(id: string, score: number, mtimeMs = 1): AssetRecord {
  return {
    id,
    folderId: "folder",
    name: id,
    extension: ".jpg",
    mediaType: "image",
    mimeType: "image/jpeg",
    sizeBytes: 1,
    mtimeMs,
    width: 1,
    height: 1,
    durationMs: null,
    codec: null,
    status: "indexed",
    error: null,
    score,
    ranking: null,
    favorite: false,
    tags: []
  };
}
