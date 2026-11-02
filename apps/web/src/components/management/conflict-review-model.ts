import type {
  FileOperationInput,
  FileOperationPreview,
  FileOperationPreviewInput,
  NameConflictChoice
} from "../../api/client";

export function isCompletePreview(
  preview: FileOperationPreview,
  count: number
) {
  return (
    preview.items.length === count &&
    new Set(preview.items.map((item) => item.index)).size === count &&
    preview.items.every(
      (item) =>
        Number.isInteger(item.index) && item.index >= 0 && item.index < count
    )
  );
}

export function reviewCounts(preview: FileOperationPreview) {
  const unchanged = preview.items.filter((item) => item.noOp).length;
  const skipped = preview.items.filter(
    (item) => !item.noOp && item.hasConflict && item.choice === "skip"
  ).length;
  return {
    included: preview.items.length - unchanged - skipped,
    skipped,
    unchanged
  };
}

export function chooseConflicts(
  input: FileOperationPreviewInput,
  preview: FileOperationPreview,
  key: string,
  choice: NameConflictChoice,
  remaining: boolean
): FileOperationPreviewInput {
  const selected = preview.items.find((item) => item.key === key);
  if (!selected) return input;
  const indexes = new Set(
    preview.items
      .filter(
        (item) =>
          item.hasConflict &&
          (remaining ? item.index >= selected.index : item.key === key)
      )
      .map((item) => item.index)
  );
  return input.type === "add-media"
    ? {
        ...input,
        files: input.files.map((file, index) =>
          indexes.has(index) ? { ...file, conflict: choice } : file
        )
      }
    : {
        ...input,
        items: input.items.map((item, index) =>
          indexes.has(index) ? { ...item, conflict: choice } : item
        )
      };
}

export function reviewedOperation(
  input: FileOperationInput,
  preview: FileOperationPreview
): FileOperationInput {
  if (!isCompletePreview(preview, input.items.length))
    throw new Error("Incomplete name check");
  return {
    ...input,
    conflict: "skip",
    items: input.items.flatMap((item, index) => {
      const checked = preview.items.find((entry) => entry.index === index);
      if (
        !checked ||
        checked.noOp ||
        (checked.hasConflict && checked.choice === "skip")
      )
        return [];
      return [
        {
          ...item,
          conflict: checked.hasConflict ? checked.choice : ("skip" as const)
        }
      ];
    })
  };
}
