import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../api/client";
import {
  buildLeaderboardEntries,
  leaderboardUpdateRequiresReload
} from "./leaderboard-model";

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

  it("uses a stable id tie-breaker that matches server pagination", () => {
    const entries = buildLeaderboardEntries([
      asset("asset-z", 25),
      asset("asset-a", 25)
    ]);

    expect(entries.map(({ asset: entryAsset }) => entryAsset.id)).toEqual([
      "asset-a",
      "asset-z"
    ]);
  });
});

describe("leaderboardUpdateRequiresReload", () => {
  it("reloads when a score change can cross the loaded page boundary", () => {
    const current = asset("entry", 12);

    expect(
      leaderboardUpdateRequiresReload(current, { ...current, score: 42 }, "all")
    ).toBe(true);
  });

  it("reloads when a tie-breaker or filter membership changes", () => {
    const current = asset("entry", 12);

    expect(
      leaderboardUpdateRequiresReload(
        current,
        { ...current, favorite: true },
        "all"
      )
    ).toBe(true);
    expect(
      leaderboardUpdateRequiresReload(
        { ...current, favorite: true },
        { ...current, favorite: false },
        "favorites"
      )
    ).toBe(true);
  });

  it("reloads an updated entry that is outside the loaded page", () => {
    expect(
      leaderboardUpdateRequiresReload(undefined, asset("entry", 12), "all")
    ).toBe(true);
  });

  it("reloads when comparison metadata changes but the final score does not", () => {
    const current = {
      ...asset("entry", 100),
      ranking: {
        skill: 1,
        comparisonScore: 60,
        manualAdjustment: 40,
        comparisonCount: 4
      }
    };

    expect(
      leaderboardUpdateRequiresReload(
        current,
        { ...current, ranking: null },
        "all"
      )
    ).toBe(true);
  });

  it("keeps equivalent reconstructed comparison metadata local", () => {
    const current = {
      ...asset("entry", 100),
      ranking: {
        skill: 1,
        comparisonScore: 60,
        manualAdjustment: 40,
        comparisonCount: 4
      }
    };

    expect(
      leaderboardUpdateRequiresReload(
        current,
        { ...current, ranking: { ...current.ranking }, codec: "jpeg" },
        "all"
      )
    ).toBe(false);
  });

  it("keeps metadata-only updates local when ordering is unchanged", () => {
    const current = asset("entry", 12);

    expect(
      leaderboardUpdateRequiresReload(
        current,
        { ...current, codec: "jpeg" },
        "all"
      )
    ).toBe(false);
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
