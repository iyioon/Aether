import type { FileOperation, FileOperationItem } from "../../api/client";

export function activityItemName(item: FileOperationItem): string | null {
  return (
    item.asset?.name ??
    item.folder?.label ??
    item.folder?.name ??
    item.name ??
    null
  );
}

export function activityItemsLabel(operation: FileOperation): string | null {
  const names = operation.items
    .map(activityItemName)
    .filter((name) => name !== null);
  if (!names.length) return null;
  const total = operation.summary?.total ?? operation.items.length;
  return total > 1 ? `${names[0]} and ${total - 1} more` : names[0]!;
}

export function activityProgressLabel(operation: FileOperation): string | null {
  const count = (status: string) =>
    operation.items.filter((item) => item.status === status).length;
  const total = operation.summary?.total ?? operation.items.length;
  if (total <= 1) return null;
  const completed = operation.summary?.completed ?? count("completed");
  const failed = operation.summary?.failed ?? count("failed");
  const cancelled = operation.summary?.cancelled ?? count("cancelled");
  const needsAttention =
    operation.summary?.needsAttention ?? count("needs_attention");
  return [
    `${completed} of ${total} completed`,
    failed ? `${failed} failed` : null,
    cancelled ? `${cancelled} cancelled` : null,
    needsAttention
      ? `${needsAttention} ${needsAttention === 1 ? "needs" : "need"} attention`
      : null
  ]
    .filter(Boolean)
    .join(" · ");
}
