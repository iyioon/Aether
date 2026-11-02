import { describe, expect, it } from "vitest";
import type {
  FileOperationInput,
  FileOperationPreview,
  FileOperationPreviewInput
} from "../../api/client";
import {
  chooseConflicts,
  isCompletePreview,
  reviewCounts,
  reviewedOperation
} from "./conflict-review-model";

const preview: FileOperationPreview = {
  revision: "4",
  items: [
    {
      key: "asset:a",
      index: 0,
      name: "a.png",
      destinationFolderId: "destination",
      destinationLabel: "Media / Trip",
      expectedParentVersion: "parent",
      hasConflict: true,
      proposedName: "a (1).png",
      choice: "skip",
      noOp: false
    },
    {
      key: "asset:b",
      index: 1,
      name: "b.png",
      destinationFolderId: "destination",
      destinationLabel: "Media / Trip",
      expectedParentVersion: "parent",
      hasConflict: true,
      proposedName: "b (1).png",
      choice: "keep-both",
      noOp: false
    },
    {
      key: "asset:c",
      index: 2,
      name: "c.png",
      destinationFolderId: "destination",
      destinationLabel: "Media / Trip",
      expectedParentVersion: "parent",
      hasConflict: false,
      proposedName: null,
      choice: "skip",
      noOp: false
    },
    {
      key: "asset:d",
      index: 3,
      name: "d.png",
      destinationFolderId: "destination",
      destinationLabel: "Media / Trip",
      expectedParentVersion: "parent",
      hasConflict: false,
      proposedName: null,
      choice: "skip",
      noOp: true
    }
  ]
};
const input: FileOperationInput = {
  requestId: "request",
  type: "move-media",
  items: ["a", "b", "c", "d"].map((assetId) => ({
    assetId,
    expectedVersion: "source"
  })),
  destinationFolderId: "destination",
  expectedParentVersion: "parent"
};

describe("name conflict review", () => {
  it("counts explicit skips and same-folder items separately from submitted items", () => {
    expect(reviewCounts(preview)).toEqual({
      included: 2,
      skipped: 1,
      unchanged: 1
    });
    expect(reviewedOperation(input, preview)).toEqual({
      ...input,
      conflict: "skip",
      items: [
        { assetId: "b", expectedVersion: "source", conflict: "keep-both" },
        { assetId: "c", expectedVersion: "source", conflict: "skip" }
      ]
    });
  });
  it("applies a choice only to this and following conflicts in the current batch", () => {
    const checked = chooseConflicts(
      { ...input, type: "move-media" },
      preview,
      "asset:b",
      "skip",
      true
    );
    expect(
      checked.type !== "add-media" && checked.items.map((item) => item.conflict)
    ).toEqual([undefined, "skip", undefined, undefined]);
    expect(input.items.every((item) => !item.conflict)).toBe(true);
  });
  it("keeps upload row identity when choosing multiple files with the same name", () => {
    const uploads: FileOperationPreviewInput = {
      type: "add-media",
      files: [
        { clientId: "a", name: "same.png" },
        { clientId: "b", name: "same.png" }
      ],
      destinationFolderId: "destination",
      expectedParentVersion: "parent"
    };
    const result = chooseConflicts(
      uploads,
      preview,
      "asset:b",
      "keep-both",
      false
    );
    expect(result.type === "add-media" && result.files).toEqual([
      { clientId: "a", name: "same.png" },
      { clientId: "b", name: "same.png", conflict: "keep-both" }
    ]);
  });
  it("does not submit a job when every selected item is explicitly skipped or unchanged", () => {
    const skipped = {
      ...preview,
      items: preview.items.map((item) => ({
        ...item,
        hasConflict: true,
        choice: "skip" as const
      }))
    };
    expect(reviewCounts(skipped).included).toBe(0);
    expect(reviewedOperation(input, skipped).items).toEqual([]);
  });
  it("rejects incomplete, duplicate or out-of-range checks instead of silently omitting items", () => {
    for (const items of [
      preview.items.slice(1),
      [preview.items[0]!, preview.items[0]!, ...preview.items.slice(2)],
      preview.items.map((item) => ({ ...item, index: item.index + 1 }))
    ]) {
      expect(isCompletePreview({ ...preview, items }, 4)).toBe(false);
      expect(() => reviewedOperation(input, { ...preview, items })).toThrow(
        "Incomplete name check"
      );
    }
    expect(isCompletePreview(preview, 4)).toBe(true);
  });
});
