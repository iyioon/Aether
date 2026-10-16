import { describe, expect, it } from "vitest";
import {
  leaderboardAnchorOffset,
  leaderboardRestoreCount,
  leaderboardScrollContextKey
} from "./leaderboard-restoration";

describe("leaderboard resume identity", () => {
  const query = {
    folderId: "folder-1",
    mediaType: "all" as const,
    scoreFilter: "all" as const,
    search: "",
    tagFilters: ["b", "a"]
  };

  it("treats tag selection as a set while keeping filter changes distinct", () => {
    const key = leaderboardScrollContextKey(query);
    expect(
      leaderboardScrollContextKey({ ...query, tagFilters: ["a", "b"] })
    ).toBe(key);
    expect(
      leaderboardScrollContextKey({ ...query, mediaType: "video" })
    ).not.toBe(key);
    expect(
      leaderboardScrollContextKey({ ...query, search: "sunset" })
    ).not.toBe(key);
    expect(
      leaderboardScrollContextKey({ ...query, folderId: "folder-2" })
    ).not.toBe(key);
  });

  it("restores loaded depth only for the same query", () => {
    const position = { contextKey: "q1", loadedCount: 144, scrollTop: 1200 };
    expect(leaderboardRestoreCount(position, "q1")).toBe(144);
    expect(leaderboardRestoreCount(position, "q2")).toBe(48);
    expect(leaderboardRestoreCount(null, "q1")).toBe(48);
  });

  it("loads enough entries for an anchor and bounds excessive stored depth", () => {
    expect(
      leaderboardRestoreCount(
        { contextKey: "q1", index: 90, scrollTop: 10 },
        "q1"
      )
    ).toBe(91);
    expect(
      leaderboardRestoreCount(
        { contextKey: "q1", loadedCount: 1_000_000, scrollTop: 10 },
        "q1"
      )
    ).toBe(10_000);
  });

  it("preserves relative position when the viewport changes row height", () => {
    expect(
      leaderboardAnchorOffset(
        { contextKey: "q1", anchorOffset: 24, anchorSize: 96, scrollTop: 100 },
        144
      )
    ).toBe(36);
    expect(
      leaderboardAnchorOffset(
        { contextKey: "q1", anchorOffset: -80, anchorSize: 96, scrollTop: 0 },
        144
      )
    ).toBe(-80);
  });
});
