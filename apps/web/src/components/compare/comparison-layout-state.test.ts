import { describe, expect, it } from "vitest";
import { parseComparisonAspect } from "./comparison-layout-state";

describe("comparison aspect preference", () => {
  it("restores supported proportions and rejects malformed or oversized state", () => {
    expect(
      parseComparisonAspect(JSON.stringify({ version: 1, aspect: "Portrait" }))
    ).toBe("Portrait");
    for (const value of [
      null,
      "",
      "broken",
      "null",
      JSON.stringify({ version: 2, aspect: "Square" }),
      JSON.stringify({ version: 1, aspect: "Unexpected" }),
      JSON.stringify({ version: 1, aspect: "Square", ignored: "x".repeat(128) })
    ]) {
      expect(parseComparisonAspect(value)).toBe("Original");
    }
  });
});
