import { describe, expect, it } from "vitest";
import {
  parseFolderNavigationState,
  parseSidebarOpenCookie
} from "./sidebar-state";

describe("sidebar persistence", () => {
  it("restores the stock sidebar open cookie", () => {
    expect(parseSidebarOpenCookie("theme=dark; sidebar_state=false")).toBe(
      false
    );
    expect(parseSidebarOpenCookie("sidebar_state=true; theme=dark")).toBe(true);
    expect(parseSidebarOpenCookie("theme=dark")).toBe(true);
  });

  it("restores valid folder navigation state", () => {
    expect(
      parseFolderNavigationState(
        JSON.stringify({
          version: 1,
          expandedFolderIds: ["root", "travel", "root"],
          folderSortMode: "items-desc"
        })
      )
    ).toEqual({
      expandedFolderIds: ["root", "travel"],
      folderSortMode: "items-desc"
    });
  });

  it("ignores malformed or unsupported folder navigation state", () => {
    expect(parseFolderNavigationState("not-json")).toBeNull();
    expect(
      parseFolderNavigationState(
        JSON.stringify({
          version: 2,
          expandedFolderIds: [],
          folderSortMode: "name-asc"
        })
      )
    ).toBeNull();
    expect(
      parseFolderNavigationState(
        JSON.stringify({
          version: 1,
          expandedFolderIds: [],
          folderSortMode: "unknown"
        })
      )
    ).toBeNull();
  });
});
