import { describe, expect, it } from "vitest";
import {
  buildBatchCurationInput,
  batchTagNames,
  changedScoreDraft,
  parseScoreDraft,
  selectableAssetIds,
  uniformValue
} from "./batch-curation-model";

describe("buildBatchCurationInput", () => {
  it("omits an untouched score from favorite-only updates", () => {
    expect(
      buildBatchCurationInput({
        score: undefined,
        favorite: true,
        isFavoriteDirty: true
      })
    ).toEqual({ favorite: true });
  });

  it("keeps an explicitly selected zero score", () => {
    expect(
      buildBatchCurationInput({
        score: 0,
        favorite: false,
        isFavoriteDirty: false
      })
    ).toEqual({ score: 0 });
  });

  it("combines intentional score and favorite changes", () => {
    expect(
      buildBatchCurationInput({
        score: 8,
        favorite: false,
        isFavoriteDirty: true
      })
    ).toEqual({ score: 8, favorite: false });
  });

  it("returns no payload when every field is untouched", () => {
    expect(
      buildBatchCurationInput({
        score: undefined,
        favorite: false,
        isFavoriteDirty: false
      })
    ).toBeNull();
  });
});

describe("score editor drafts", () => {
  it("distinguishes mixed values from an explicit unranked score", () => {
    expect(uniformValue([0, 0])).toBe(0);
    expect(uniformValue([0, 4])).toBeUndefined();
    expect(parseScoreDraft("")).toBeUndefined();
    expect(parseScoreDraft("0")).toBe(0);
  });
  it("rejects negative, fractional, nonnumeric and unsafe integer drafts", () => {
    for (const draft of [
      "-1",
      "1.5",
      "Infinity",
      "1e3",
      "9007199254740992",
      " 1"
    ])
      expect(parseScoreDraft(draft)).toBeUndefined();
    expect(parseScoreDraft("123")).toBe(123);
  });
  it("treats mixed favorites as unset rather than false", () => {
    expect(uniformValue([true, false])).toBeUndefined();
    expect(uniformValue([false, false])).toBe(false);
  });
  it("does not submit a uniform score that was edited and restored", () => {
    expect(changedScoreDraft("8", 8, true)).toBeUndefined();
    expect(changedScoreDraft("9", 8, true)).toBe(9);
    expect(changedScoreDraft("0", undefined, true)).toBe(0);
    expect(changedScoreDraft("8", undefined, false)).toBeUndefined();
  });
});

describe("batch tag drafts", () => {
  it("includes the current input without requiring an extra Add click", () => {
    expect(batchTagNames(["Family"], "Trip")).toEqual(["Family", "Trip"]);
  });
  it("normalizes and deduplicates staged tags and the current input", () => {
    expect(batchTagNames(["Family", "Trip"], "  family  ")).toEqual([
      "Family",
      "Trip"
    ]);
    expect(batchTagNames(["Family"], "   ")).toEqual(["Family"]);
  });
});

describe("selection scope", () => {
  it("omits unavailable records from Select loaded", () => {
    expect([
      ...selectableAssetIds([
        { id: "available" },
        { id: "missing", unavailable: true },
        { id: "available-too", unavailable: false }
      ])
    ]).toEqual(["available", "available-too"]);
  });
});
