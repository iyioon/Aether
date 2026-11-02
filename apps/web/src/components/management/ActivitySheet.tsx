import { useEffect, useRef, useState } from "react";
import {
  cancelFileOperation,
  retryFileOperation,
  type FileOperation,
  type FileOperationInput
} from "../../api/client";
import type { ReactNode } from "react";
import { useIsMobile } from "../../hooks/use-mobile";
import { formatBytes } from "../media/media-format";
import { Progress } from "../ui/progress";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import {
  isOperationTerminal,
  managementError,
  operationTitle
} from "./management-model";

const statusLabels: Record<FileOperation["status"], string> = {
  queued: "Queued",
  running: "In progress",
  completed: "Completed",
  partial: "Partly completed",
  cancelled: "Cancelled",
  failed: "Failed",
  needs_attention: "Needs attention"
};

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

export function ActivityPanel({
  open,
  onClose,
  busy = false,
  children
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <Sheet
      open={open}
      modal={mobile}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <SheetContent
        data-modal={mobile}
        className={`activity-sheet h-dvh w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] ${mobile ? "sm:max-w-none" : "sm:max-w-[520px]"}`}
        side="right"
        showOverlay={mobile}
        showCloseButton={!busy}
        aria-describedby={undefined}
        onInteractOutside={(event) => {
          if (!mobile) event.preventDefault();
        }}
      >
        <SheetHeader className="pt-[max(1rem,env(safe-area-inset-top))]">
          <SheetTitle>Activity</SheetTitle>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

export function ActivityContents({
  open,
  operations,
  onRefresh,
  onOperation,
  onRetry
}: {
  open: boolean;
  onRetry: (input: FileOperationInput) => Promise<FileOperation>;
  operations: FileOperation[];
  onRefresh: () => Promise<void>;
  onOperation: (operation: FileOperation, notify: boolean) => void;
}) {
  const retryRequestsRef = useRef(new Map<string, FileOperationInput>());
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setError(null);
      void onRefresh().catch(() =>
        setError("Activity could not be loaded. Try again.")
      );
    }
  }, [open, onRefresh]);
  async function cancel(operation: FileOperation) {
    if (cancelling) return;
    setCancelling(operation.id);
    setError(null);
    try {
      onOperation(await cancelFileOperation(operation.id), true);
    } catch {
      setError(
        "Cancellation could not be confirmed. Refresh Activity to check the result."
      );
    } finally {
      setCancelling(null);
    }
  }
  async function retry(operation: FileOperation) {
    if (!operation.retryInput || retrying) return;
    setRetrying(operation.id);
    setError(null);
    const input = retryRequestsRef.current.get(operation.id) ?? {
      ...operation.retryInput,
      requestId: crypto.randomUUID()
    };
    retryRequestsRef.current.set(operation.id, input);
    try {
      await onRetry(input);
    } catch {
      setError(
        "The retry could not be confirmed. Try again to check the same request."
      );
    } finally {
      setRetrying(null);
    }
  }
  async function checkAgain(operation: FileOperation) {
    if (retrying) return;
    setRetrying(operation.id);
    setError(null);
    try {
      onOperation(await retryFileOperation(operation.id), true);
    } catch {
      setError(
        "The operation could not be checked. Try again to check the same request."
      );
    } finally {
      setRetrying(null);
    }
  }
  return (
    <div className="grid gap-3">
      {error ? (
        <div role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void onRefresh()
                .then(() => setError(null))
                .catch(() =>
                  setError("Activity could not be loaded. Try again.")
                )
            }
          >
            Retry
          </Button>
        </div>
      ) : null}
      {operations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recent file operations.
        </p>
      ) : (
        operations.map((operation) => (
          <section
            key={operation.id}
            className="grid gap-2 rounded-lg border p-3"
            aria-label={operationTitle(operation.type)}
          >
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm">
                {operationTitle(operation.type)}
              </strong>
              <span className="text-xs text-muted-foreground">
                {statusLabels[operation.status]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {operation.summary?.completed ??
                operation.items.filter((item) => item.status === "completed")
                  .length}{" "}
              of {operation.summary?.total ?? operation.items.length} completed
            </p>
            {operation.progress ? (
              <div className="grid gap-1">
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
                  aria-label={`${operationTitle(operation.type)} file progress`}
                />
                <span className="text-xs text-muted-foreground">
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
                  className="text-sm text-destructive"
                >
                  {item.asset?.name ??
                    item.name ??
                    item.folder?.label ??
                    item.folder?.name ??
                    `Item ${index + 1}`}
                  : {managementError({ code: item.errorCode })}
                </p>
              ))}
            {conflictRetryInstruction(operation) ? (
              <p className="text-sm">{conflictRetryInstruction(operation)}</p>
            ) : operation.retryInput ? (
              <Button
                className="justify-self-start"
                type="button"
                size="sm"
                variant="outline"
                disabled={retrying !== null}
                onClick={() => void retry(operation)}
              >
                {retrying === operation.id ? "Retrying…" : "Retry remaining"}
              </Button>
            ) : null}
            {!isOperationTerminal(operation) || operation.canCancel ? (
              <Button
                className="justify-self-start"
                type="button"
                size="sm"
                variant="outline"
                disabled={cancelling !== null}
                onClick={() => void cancel(operation)}
              >
                {cancelling === operation.id
                  ? "Cancelling…"
                  : "Cancel remaining"}
              </Button>
            ) : null}
            {operation.status === "needs_attention" ? (
              <div className="grid justify-items-start gap-2">
                <p className="text-sm">
                  Resolve the reported problem, then check again. Keep the
                  affected files available.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={retrying !== null}
                  onClick={() => void checkAgain(operation)}
                >
                  {retrying === operation.id ? "Checking…" : "Check again"}
                </Button>
              </div>
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}
