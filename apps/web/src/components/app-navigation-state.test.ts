import { describe, expect, it } from "vitest";
import { parseAppNavigationState } from "./app-navigation-state";

describe("app navigation state", () => {
  it("restores the current page and comparison workspace", () => {
    expect(
      parseAppNavigationState(
        JSON.stringify({
          version: 1,
          page: "settings",
          comparisonWorkspace: "ranking"
        })
      )
    ).toEqual({ page: "settings", comparisonWorkspace: "ranking" });
  });

  it("uses safe defaults for missing, stale, or invalid state", () => {
    const expected = { page: "library", comparisonWorkspace: "leaderboard" };

    expect(parseAppNavigationState(null)).toEqual(expected);
    expect(parseAppNavigationState("not-json")).toEqual(expected);
    expect(
      parseAppNavigationState(
        JSON.stringify({
          version: 2,
          page: "settings",
          comparisonWorkspace: "ranking"
        })
      )
    ).toEqual(expected);
    expect(
      parseAppNavigationState(
        JSON.stringify({
          version: 1,
          page: "admin",
          comparisonWorkspace: "edit"
        })
      )
    ).toEqual(expected);
  });
});
