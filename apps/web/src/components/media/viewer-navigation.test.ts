import { describe, expect, it } from "vitest";
import { adjacentViewerId } from "./viewer-navigation";
describe("viewer neighbors after a move", () => {
  it("uses current accepted order while the item is present", () => {
    expect(adjacentViewerId("b", 1, ["a", "b", "c"], ["b", "a", "c"])).toBe(
      "c"
    );
  });
  it("retains surviving former neighbors when the current item leaves the folder", () => {
    expect(adjacentViewerId("b", 1, ["a", "d"], ["a", "b", "c", "d"])).toBe(
      "d"
    );
    expect(adjacentViewerId("b", -1, ["a", "d"], ["a", "b", "c", "d"])).toBe(
      "a"
    );
    expect(adjacentViewerId("b", 1, ["a"], ["a", "b", "c"])).toBeNull();
  });
  it("never treats a missing index as the first item", () => {
    expect(adjacentViewerId("unknown", 1, ["a", "b"], ["a", "b"])).toBeNull();
  });
});
