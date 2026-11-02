import { describe, expect, it } from "vitest";
import {
  buildBatchCurationInput,
  parseScoreDraft,
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
});
