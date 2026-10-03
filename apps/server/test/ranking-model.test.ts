import { describe, expect, it } from "vitest";
import {
  comparisonPairKey,
  fitRankingModel,
  selectInformativePair
} from "../src/library/ranking-model.js";

describe("ranking model", () => {
  it("projects repeated wins into ordered, centered scores", () => {
    const rankings = fitRankingModel([
      { assetLowId: "a", assetHighId: "b", winnerId: "a" },
      { assetLowId: "a", assetHighId: "c", winnerId: "a" },
      { assetLowId: "b", assetHighId: "c", winnerId: "b" }
    ]);

    expect(rankings.get("a")!.comparisonScore).toBeGreaterThan(
      rankings.get("b")!.comparisonScore
    );
    expect(rankings.get("b")!.comparisonScore).toBeGreaterThan(
      rankings.get("c")!.comparisonScore
    );
    expect(rankings.get("a")!.comparisonCount).toBe(2);
    expect(rankings.get("b")!.comparisonCount).toBe(2);
    expect(rankings.get("c")!.comparisonCount).toBe(2);
    expect(
      [...rankings.values()].reduce((sum, ranking) => sum + ranking.skill, 0)
    ).toBeCloseTo(0, 8);
  });

  it("returns no projections when there are no decisions", () => {
    expect(fitRankingModel([]).size).toBe(0);
  });

  it("reserves zero for assets without an active ranking projection", () => {
    const preferences = Array.from({ length: 5_000 }, (_, index) => {
      const winnerId = `winner-${index.toString().padStart(4, "0")}`;
      return {
        assetLowId: "loser",
        assetHighId: winnerId,
        winnerId
      };
    });
    const rankings = fitRankingModel(preferences);

    expect(rankings.get("loser")?.comparisonScore).toBe(1);
    expect(
      [...rankings.values()].every((ranking) => ranking.comparisonScore >= 1)
    ).toBe(true);
  });

  it("prefers under-compared candidates and avoids the previous pair", () => {
    const candidates = [
      { id: "a", skill: 0, comparisonCount: 0 },
      { id: "b", skill: 0.1, comparisonCount: 0 },
      { id: "c", skill: 2, comparisonCount: 4 }
    ];
    const randomValues = [0, 0.5, 0, 0];
    const pair = selectInformativePair(
      candidates,
      new Set([comparisonPairKey("a", "b")]),
      ["a", "b"],
      () => randomValues.shift() ?? 0
    );

    expect(pair).toEqual(["a", "c"]);
  });

  it("uses a canonical key regardless of pair direction", () => {
    expect(comparisonPairKey("left", "right")).toBe(
      comparisonPairKey("right", "left")
    );
  });
});
