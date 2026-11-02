import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ApiError,
  emptyTrash,
  getFileOperation,
  getFileOperations,
  startFileOperation,
  type FileOperation,
  type FileOperationInput,
  type EmptyTrashInput
} from "../../api/client";
import { usePageLifecycle } from "../../hooks/usePageLifecycle";
import {
  completedOperationItems,
  isOperationTerminal,
  operationResult
} from "./management-model";
import {
  noticeSeverity,
  operationNotice,
  OperationNotificationBuffer,
  type OperationNotice
} from "./operation-notifications";

export function useFileOperations(
  onCommitted: (operation: FileOperation) => void,
  onViewActivity: () => void,
  onUndoTrash: (operation: FileOperation) => void
) {
  const [operations, setOperations] = useState<FileOperation[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const activeRef = useRef(true);
  const notificationsRef = useRef(new OperationNotificationBuffer());
  const notificationTimerRef = useRef<number | undefined>(undefined);
  const pollingRef = useRef(0);
  const observedRef = useRef(new Map<string, string>());
  const toastIdsRef = useRef(new Set<string>());
  const undoTrashRef = useRef(onUndoTrash);
  undoTrashRef.current = onUndoTrash;
  const viewActivityRef = useRef(onViewActivity);
  viewActivityRef.current = onViewActivity;
  const uploadBatchesRef = useRef<Array<{ id: string; ids: string[] }>>([]);
  const uploadOutcomesRef = useRef(
    new Map<string, "added" | "failed" | "cancelled">()
  );
  const flushNotifications = useCallback(() => {
    notificationTimerRef.current = undefined;
    if (
      !activeRef.current ||
      document.visibilityState === "hidden" ||
      pollingRef.current > 0
    )
      return;
    const batch = notificationsRef.current.drain();
    if (!batch.count) return;
    const viewActivity = {
      label: "View activity",
      onClick: () => {
        if (activeRef.current) viewActivityRef.current();
      }
    };
    if (batch.count > 1) {
      const id = "file-operation-summary";
      toastIdsRef.current.add(id);
      toast[batch.severity](`${batch.count} results in Activity`, {
        id,
        action: viewActivity
      });
      return;
    }
    const notice = batch.notices[0];
    if (!notice) return;
    const id = `file-operation-${notice.id}`;
    toastIdsRef.current.add(id);
    if (notice.kind === "upload") {
      toast[noticeSeverity(notice)](
        notice.failed
          ? `${notice.added} of ${notice.total} items added`
          : notice.added
            ? `${notice.added} ${notice.added === 1 ? "item" : "items"} added`
            : "Uploads cancelled",
        { id, action: viewActivity }
      );
      return;
    }
    const { operation } = notice;
    const completed =
      operation.summary?.completed ?? completedOperationItems(operation).length;
    const title =
      operation.status === "completed"
        ? operationResult(operation.type, completed)
        : operation.status === "cancelled"
          ? "Operation cancelled"
          : operation.status === "partial"
            ? "Some items could not be completed"
            : "Operation needs attention";
    toast[noticeSeverity(notice)](title, {
      id,
      action:
        operation.type === "trash" && completed > 0
          ? {
              label: "Undo",
              onClick: () => {
                if (activeRef.current) undoTrashRef.current(operation);
              }
            }
          : viewActivity,
      description:
        operation.status === "partial"
          ? `${completed} completed. Review the remaining items in Activity.`
          : operation.status === "failed" ||
              operation.status === "needs_attention"
            ? "Review this operation in Activity."
            : undefined
    });
  }, []);
  const scheduleNotifications = useCallback(() => {
    if (
      !activeRef.current ||
      document.visibilityState === "hidden" ||
      notificationTimerRef.current !== undefined
    )
      return;
    notificationTimerRef.current = window.setTimeout(flushNotifications, 200);
  }, [flushNotifications]);
  const queueNotification = useCallback(
    (notice: OperationNotice) => {
      if (!activeRef.current) return;
      if (notificationsRef.current.enqueue(notice)) scheduleNotifications();
    },
    [scheduleNotifications]
  );
  const settleUpload = useCallback(
    (id: string, outcome: "added" | "failed" | "cancelled") => {
      if (!activeRef.current) return;
      uploadOutcomesRef.current.set(id, outcome);
      for (const batch of uploadBatchesRef.current) {
        if (!batch.ids.every((entry) => uploadOutcomesRef.current.has(entry)))
          continue;
        const added = batch.ids.filter(
          (entry) => uploadOutcomesRef.current.get(entry) === "added"
        ).length;
        const failed = batch.ids.filter(
          (entry) => uploadOutcomesRef.current.get(entry) === "failed"
        ).length;
        queueNotification({
          kind: "upload",
          id: batch.id,
          eventId: batch.id,
          added,
          failed,
          total: batch.ids.length
        });
      }
    },
    [queueNotification]
  );
  const trackUploadBatch = useCallback((ids: string[]) => {
    uploadBatchesRef.current = [
      ...uploadBatchesRef.current,
      { id: crypto.randomUUID(), ids }
    ].slice(-100);
  }, []);
  const callbacksRef = useRef(onCommitted);
  callbacksRef.current = onCommitted;
  const accept = useCallback(
    (operation: FileOperation, notify: boolean) => {
      if (!activeRef.current) return;
      setOperations((current) =>
        [
          operation,
          ...current.filter((entry) => entry.id !== operation.id)
        ].slice(0, 100)
      );
      const committed = completedOperationItems(operation);
      const committedSignature =
        `${operation.summary?.completed ?? 0}:` +
        committed
          .map(
            (item) =>
              `${item.assetId ?? item.folderId ?? item.trashId}:${item.asset?.sourceVersion ?? item.folder?.sourceVersion ?? ""}`
          )
          .join("|");
      if (
        (committed.length || operation.summary?.completed) &&
        observedRef.current.get(operation.id) !== committedSignature
      ) {
        observedRef.current.set(operation.id, committedSignature);
        callbacksRef.current(operation);
      }
      if (!isOperationTerminal(operation)) return;
      if (operation.type === "add-media")
        settleUpload(
          operation.id,
          operation.status === "completed"
            ? "added"
            : operation.status === "cancelled"
              ? "cancelled"
              : "failed"
        );
      if (notify) {
        const notice = operationNotice(operation);
        if (notice) queueNotification(notice);
      }
    },
    [queueNotification, settleUpload]
  );
  useEffect(() => {
    activeRef.current = true;
    const toastIds = toastIdsRef.current;
    const notifications = notificationsRef.current;
    return () => {
      activeRef.current = false;
      window.clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = undefined;
      notifications.clear();
      for (const id of toastIds) toast.dismiss(id);
    };
  }, []);
  const [watchIds, setWatchIds] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(() => void poll(), 1000);
        return;
      }
      const terminalIds = new Set<string>();
      pollingRef.current++;
      try {
        await Promise.all(
          watchIds.map(async (id) => {
            try {
              const operation = await getFileOperation(id, controller.signal);
              if (controller.signal.aborted) return;
              accept(operation, true);
              if (isOperationTerminal(operation)) terminalIds.add(id);
            } catch (error) {
              if (error instanceof ApiError && error.status === 401)
                controller.abort();
            }
          })
        );
      } finally {
        pollingRef.current--;
        scheduleNotifications();
      }
      if (!controller.signal.aborted && terminalIds.size)
        setWatchIds((current) => current.filter((id) => !terminalIds.has(id)));
      if (!controller.signal.aborted && watchIds.length)
        timer = window.setTimeout(() => void poll(), 700);
    }
    if (watchIds.length) void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [accept, refreshToken, scheduleNotifications, watchIds]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await getFileOperations(signal);
    if (signal?.aborted || !activeRef.current) return;
    setOperations(result.items);
    setWatchIds((current) => [
      ...new Set([
        ...current,
        ...result.items
          .filter((entry) => !isOperationTerminal(entry))
          .map((entry) => entry.id)
      ])
    ]);
  }, []);
  usePageLifecycle({
    onHidden: () => {
      window.clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = undefined;
    },
    onResume: () => {
      setRefreshToken((current) => current + 1);
      scheduleNotifications();
      void refresh().catch(() => undefined);
    }
  });
  const submit = useCallback(
    async (input: FileOperationInput) => {
      setWatchIds((current) => [...new Set([...current, input.requestId])]);
      try {
        const operation = await startFileOperation(input);
        if (!activeRef.current) return operation;
        accept(operation, true);
        if (isOperationTerminal(operation))
          setWatchIds((current) =>
            current.filter((id) => id !== input.requestId)
          );
        return operation;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        )
          setWatchIds((current) =>
            current.filter((id) => id !== input.requestId)
          );
        throw error;
      }
    },
    [accept]
  );
  const observe = useCallback(
    (operation: FileOperation, notify: boolean) => {
      accept(operation, notify);
      if (!isOperationTerminal(operation))
        setWatchIds((current) => [...new Set([...current, operation.id])]);
    },
    [accept]
  );
  const submitEmptyTrash = useCallback(
    async (input: EmptyTrashInput) => {
      setWatchIds((current) => [...new Set([...current, input.requestId])]);
      try {
        const operation = await emptyTrash(input);
        if (activeRef.current) {
          accept(operation, true);
          if (isOperationTerminal(operation))
            setWatchIds((current) =>
              current.filter((id) => id !== input.requestId)
            );
        }
        return operation;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        )
          setWatchIds((current) =>
            current.filter((id) => id !== input.requestId)
          );
        throw error;
      }
    },
    [accept]
  );
  return {
    operations,
    submit,
    submitEmptyTrash,
    refresh,
    accept: observe,
    trackUploadBatch,
    settleUpload
  };
}
