import { useRef, useState, type ReactNode } from "react";
import { Check, Clock3, File, LoaderCircle, TriangleAlert } from "lucide-react";
import {
  cancelFileOperation,
  retryFileOperation,
  type FileOperation
} from "../../api/client";
import { formatBytes } from "../media/media-format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import {
  activityNeedsAttention,
  activityItemName,
  activityItemsLabel,
  activityProgressLabel
} from "./activity-model";
import { managementError, operationTitle } from "./management-model";

const statusLabels: Record<FileOperation["status"], string> = {
  queued: "Queued",
  running: "In progress",
  completed: "Completed",
  partial: "Partly completed",
  cancelled: "Cancelled",
  failed: "Failed",
  needs_attention: "Needs attention"
};

export function ActivityStatus({
  label,
  attention = false,
  running = false,
  completed = false
}: {
  label: string;
  attention?: boolean;
  running?: boolean;
  completed?: boolean;
}) {
  const Icon = attention
    ? TriangleAlert
    : running
      ? LoaderCircle
      : completed
        ? Check
        : Clock3;
  return (
    <Badge
      variant={attention ? "outline" : "secondary"}
      className={
        attention ? "activity-status text-destructive" : "activity-status"
      }
    >
      <Icon
        aria-hidden="true"
        className={running ? "motion-safe:animate-spin" : undefined}
      />
      {label}
    </Badge>
  );
}

export function ActivityTime({ value }: { value?: string }) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value);
  return (
    <time dateTime={value} title={date.toLocaleString()}>
      {date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })}
    </time>
  );
}

function conflictRetryInstruction(operation: FileOperation): string | null {
  if (
    !operation.retryInput ||
    !operation.items.some((item) => item.errorCode === "destination_exists")
  )
    return null;
  if (operation.type === "restore")
    return "In Trash, restore the affected items again. Choose another folder or Keep both in the name conflict review.";
  if (operation.type === "move-media" || operation.type === "move-folder")
    return "In the library, choose Move to… for the affected items again. Choose another folder or Keep both in the name conflict review.";
  return null;
}

export function ActivityOperation({
  operation,
  primaryName,
  children,
  onOperation,
  onRetry
}: {
  operation: FileOperation;
  primaryName?: string;
  children?: ReactNode;
  onOperation: (operation: FileOperation, notify: boolean) => void;
  onRetry: (operation: FileOperation) => Promise<FileOperation>;
}) {
  const activeRef = useRef(false);
  const [busy, setBusy] = useState<"retry" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "retry" | "cancel") {
    if (activeRef.current) return;
    activeRef.current = true;
    setBusy(action);
    setError(null);
    try {
      if (action === "cancel")
        onOperation(await cancelFileOperation(operation.id), true);
      else if (operation.status === "needs_attention")
        onOperation(await retryFileOperation(operation.id), true);
      else if (operation.retryInput) {
        await onRetry(operation);
      }
    } catch {
      setError(
        action === "cancel"
          ? "Cancellation could not be confirmed. Refresh Activity to check the result."
          : "The operation could not be checked. Try again to check the same request."
      );
    } finally {
      activeRef.current = false;
      setBusy(null);
    }
  }
  const name =
    activityItemsLabel(operation) ??
    primaryName ??
    (operation.summary?.total ?? operation.items.length) +
      ((operation.summary?.total ?? operation.items.length) === 1
        ? " item"
        : " items");
  const attention = activityNeedsAttention(operation);
  const multipleItems =
    (operation.summary?.total ?? operation.items.length) > 1;
  const instruction = conflictRetryInstruction(operation);
  return (
    <section
      className="activity-item"
      aria-label={
        primaryName ? "Upload " + primaryName : operationTitle(operation.type)
      }
    >
      <span className="activity-item-icon" aria-hidden="true">
        <File />
      </span>
      <div className="activity-item-content">
        <div className="activity-item-heading">
          <strong className="activity-item-name">{name}</strong>
          <ActivityStatus
            label={statusLabels[operation.status]}
            attention={attention}
            running={operation.status === "running"}
            completed={operation.status === "completed"}
          />
        </div>
        <p className="activity-item-meta">
          <span>{operationTitle(operation.type)}</span>
          <ActivityTime value={operation.createdAt} />
        </p>
        {activityProgressLabel(operation) ? (
          <p className="activity-item-summary">
            {activityProgressLabel(operation)}
          </p>
        ) : null}
        {children}
        {operation.progress ? (
          <div className="activity-item-progress">
            <Progress
              value={
                operation.progress.totalBytes
                  ? Math.min(
                      100,
                      (operation.progress.bytes /
                        operation.progress.totalBytes) *
                        100
                    )
                  : 0
              }
              aria-label={operationTitle(operation.type) + " file progress"}
            />
            <span>
              {formatBytes(operation.progress.bytes)} of{" "}
              {formatBytes(operation.progress.totalBytes)}
            </span>
          </div>
        ) : null}
        {operation.items
          .filter((item) => item.errorCode && item.status !== "cancelled")
          .map((item, index) => (
            <p
              key={item.assetId ?? item.folderId ?? item.trashId ?? index}
              className="activity-item-error"
            >
              {multipleItems
                ? (activityItemName(item) ?? "Item " + (index + 1)) + ": "
                : null}
              {managementError(
                { code: item.errorCode },
                operation.status === "needs_attention" ? "recovery" : undefined
              )}
            </p>
          ))}
        {instruction ? <p className="text-sm">{instruction}</p> : null}
        {operation.status === "needs_attention" ? (
          <p className="text-sm text-muted-foreground">
            Resolve the reported problem, then check again. Keep the affected
            files available.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="activity-item-error">
            {error}
          </p>
        ) : null}
        {operation.canCancel ||
        operation.status === "needs_attention" ||
        (operation.retryInput && !instruction) ? (
          <div className="activity-item-actions">
            {operation.canCancel ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void act("cancel")}
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel remaining"}
              </Button>
            ) : null}
            {operation.status === "needs_attention" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void act("retry")}
              >
                {busy === "retry" ? "Checking…" : "Check again"}
              </Button>
            ) : operation.retryInput && !instruction ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void act("retry")}
              >
                {busy === "retry" ? "Retrying…" : "Retry remaining"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
