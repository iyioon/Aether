import { describe, expect, it } from "vitest";
import type { SortCriterion } from "../../api/client";
import { closestSortRow, moveSortCriterion } from "./sort-criteria-state";

describe("sort priority", () => {
  const criteria: SortCriterion[] = [
    { field: "date", direction: "desc" },
    { field: "tags", direction: "asc" },
    { field: "filename", direction: "asc" }
  ];

  it("changes priority while preserving each criterion's direction", () => {
    const moved = moveSortCriterion(criteria, 2, 0);
    expect(moved).toEqual([criteria[2], criteria[0], criteria[1]]);
    expect(moved[0]).toBe(criteria[2]);
    expect(criteria.map((criterion) => criterion.field)).toEqual([
      "date",
      "tags",
      "filename"
    ]);
    expect(moveSortCriterion(moved, 0, 2)).toEqual(criteria);
  });

  it.each([
    [-1, 1],
    [0, 3],
    [1, 1],
    [0.5, 1],
    [0, NaN]
  ])("ignores unavailable or unchanged moves from %s to %s", (from, to) => {
    expect(moveSortCriterion(criteria, from, to)).toBe(criteria);
  });

  it("finds a drop target for unequal row heights and viewport edges", () => {
    const rows = [
      { top: 30, height: 80 },
      { top: 122, height: 110 },
      { top: 244, height: 80 }
    ];
    expect(closestSortRow(-100, rows)).toBe(0);
    expect(closestSortRow(180, rows)).toBe(1);
    expect(closestSortRow(500, rows)).toBe(2);
    expect(closestSortRow(100, [])).toBe(-1);
    expect(closestSortRow(NaN, rows)).toBe(-1);
  });
});
