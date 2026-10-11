import { describe, expect, it } from "vitest";
import { buildBatchCurationInput } from "./batch-curation-model";

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
