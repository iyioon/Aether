import type { FileOperation, FileOperationItem } from "../../api/client";

type ActivityEntry = {
  operation?: Pick<FileOperation, "status" | "createdAt">;
  transfer?: { state: string; createdAt?: string };
};

export function activityCreatedAt(entry: ActivityEntry): string | undefined {
  return entry.transfer?.createdAt ?? entry.operation?.createdAt;
}

function creationTimestamp(value: string | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compareActivityEntries(
  left: ActivityEntry,
  right: ActivityEntry
): number {
  const active = (entry: ActivityEntry) =>
    entry.operation
      ? ["queued", "running", "needs_attention"].includes(
          entry.operation.status
        )
      : Boolean(entry.transfer && !isUploadTerminalState(entry.transfer.state));
  return (
    Number(active(right)) - Number(active(left)) ||
    creationTimestamp(activityCreatedAt(right)) -
      creationTimestamp(activityCreatedAt(left))
  );
}

const terminalUploadStates = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired"
]);

export function isUploadTerminalState(state: string): boolean {
  return terminalUploadStates.has(state);
}

/** Keep unfinished uploads visible when recent results fill the Activity limit. */
export function prioritizeUploadTransfers<
  T extends { state: string; createdAt?: string }
>(transfers: T[]): T[] {
  const active: T[] = [];
  const recent: T[] = [];
  for (const transfer of transfers)
    (isUploadTerminalState(transfer.state) ? recent : active).push(transfer);
  recent.sort(
    (left, right) =>
      creationTimestamp(right.createdAt) - creationTimestamp(left.createdAt)
  );
  return [...active, ...recent].slice(0, 100);
}

export function activityNeedsAttention(operation: FileOperation): boolean {
  return (
    operation.status === "needs_attention" ||
    operation.status === "failed" ||
    (operation.status === "partial" &&
      (operation.summary?.failed ??
        operation.items.filter((item) => item.status === "failed").length) > 0)
  );
}

export function activityItemName(item: FileOperationItem): string | null {
  return (
    item.name ??
    item.asset?.name ??
    item.folder?.label ??
    item.folder?.name ??
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
