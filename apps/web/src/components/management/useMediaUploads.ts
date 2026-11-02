import { useCallback, useEffect, useRef, useState } from "react";
import {
  createUploadHttpStack,
  cancelUpload,
  ApiError,
  getFileOperation,
  getUploadPrefix,
  getUploads,
  type FileOperation,
  type TreeResponse,
  type UploadLimits,
  type UploadRecord
} from "../../api/client";
import { usePageLifecycle } from "../../hooks/usePageLifecycle";
import { folderVersion } from "./management-model";
import { saveUploadCheckpoint } from "./upload-checkpoints";
import type { Upload } from "tus-js-client";

const failedUploadMessage =
  "This upload failed. Check the file type, size and destination, then add it again.";

export interface UploadProgress {
  key: string;
  name: string;
  size: number;
  accepted: number;
  state: string;
  error?: string;
}
export interface Transfer extends UploadProgress {
  key: string;
  name: string;
  size: number;
  accepted: number;
  state:
    | "queued"
    | "uploading"
    | "paused"
    | "checking"
    | "received"
    | "error"
    | "cancelled"
    | "failed"
    | "completed"
    | "expired";
  error?: string;
  id?: string;
  operationId: string;
  file?: File;
  folderId?: string;
  expectedParentVersion?: string;
  conflict?: string;
  record?: UploadRecord;
}
export function useMediaUploads({
  tree,
  destination,
  conflict,
  open,
  onTransfers,
  onBatchStarted,
  onUploadCancelled,
  onOperation
}: {
  tree: TreeResponse | null;
  destination: string;
  conflict: string;
  open: boolean;
  onTransfers: (transfers: UploadProgress[]) => void;
  onBatchStarted: (ids: string[]) => void;
  onUploadCancelled: (id: string, outcome: "cancelled" | "failed") => void;
  onOperation: (operation: FileOperation, notify: boolean) => void;
}) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const instancesRef = useRef(new Map<string, Upload>());
  const startingRef = useRef(new Set<string>());
  const proofBusyRef = useRef(new Set<string>());
  const cancelBusyRef = useRef(new Set<string>());
  const cancelledRef = useRef(new Set<string>());
  const workersRef = useRef(new Set<Worker>());
  const proofRequestsRef = useRef(new Map<string, AbortController>());
  const activeRef = useRef(true);
  const transfersCallbackRef = useRef(onTransfers);
  transfersCallbackRef.current = onTransfers;
  useEffect(() => {
    transfersCallbackRef.current(
      transfers.map(({ key, name, size, accepted, state, error }) => ({
        key,
        name,
        size,
        accepted,
        state,
        error
      }))
    );
  }, [transfers]);
  const callbacksRef = useRef(onOperation);
  callbacksRef.current = onOperation;
  const destinationRef = useRef(destination);
  destinationRef.current = destination;
  const update = useCallback((key: string, values: Partial<Transfer>) => {
    if (activeRef.current)
      setTransfers((current) =>
        current.map((transfer) =>
          transfer.key === key ? { ...transfer, ...values } : transfer
        )
      );
  }, []);
  const refresh = useCallback(async () => {
    const result = await getUploads();
    if (!activeRef.current) return;
    setLimits(result.limits);
    for (const record of result.items) {
      if (
        record.operationId &&
        (record.status === "publishing" || record.status === "validating")
      ) {
        void getFileOperation(record.operationId)
          .then((operation) => {
            if (activeRef.current) callbacksRef.current(operation, false);
          })
          .catch(() => undefined);
      }
    }
    setTransfers((current) => {
      const incoming = new Map(
        result.items.map((record) => [record.id, record])
      );
      const incomingRequests = new Map(
        result.items.map((record) => [record.requestId, record])
      );
      const knownIds = new Set(current.map((transfer) => transfer.id));
      const knownRequests = new Set(
        current.map((transfer) => transfer.operationId)
      );
      const stateFor = (record: UploadRecord): Transfer["state"] =>
        record.status === "completed"
          ? "completed"
          : record.status === "failed"
            ? "failed"
            : record.status === "cancelled"
              ? "cancelled"
              : record.status === "expired"
                ? "expired"
                : record.offset === record.size
                  ? "received"
                  : "paused";
      const retained = current.map((transfer) => {
        const record =
          (transfer.id ? incoming.get(transfer.id) : undefined) ??
          incomingRequests.get(transfer.operationId);
        if (!record) return transfer;
        const terminal = [
          "completed",
          "failed",
          "cancelled",
          "expired"
        ].includes(record.status);
        return {
          ...transfer,
          id: record.id,
          record,
          error: terminal
            ? record.status === "failed"
              ? failedUploadMessage
              : undefined
            : transfer.error,
          file: terminal ? undefined : transfer.file,
          operationId:
            record.operationId ?? record.requestId ?? transfer.operationId,
          accepted: Math.max(transfer.accepted, record.offset),
          state:
            terminal ||
            transfer.state === "received" ||
            record.offset === record.size
              ? stateFor(record)
              : transfer.state
        };
      });
      return [
        ...retained,
        ...result.items
          .filter(
            (record) =>
              !knownIds.has(record.id) &&
              !knownRequests.has(record.requestId ?? "")
          )
          .map((record) => ({
            key: record.id,
            id: record.id,
            operationId: record.operationId ?? record.requestId ?? "",
            name: record.name ?? "Incomplete upload",
            size: record.size,
            accepted: record.offset,
            state: stateFor(record),
            error: record.status === "failed" ? failedUploadMessage : undefined,
            record
          }))
      ].slice(0, 100);
    });
  }, []);
  useEffect(() => {
    activeRef.current = true;
    const instances = instancesRef.current;
    const workers = workersRef.current;
    const proofRequests = proofRequestsRef.current;
    return () => {
      activeRef.current = false;
      for (const upload of instances.values()) void upload.abort();
      for (const request of proofRequests.values()) request.abort();
      for (const worker of workers) worker.terminate();
    };
  }, [refresh]);
  useEffect(() => {
    if (open)
      void refresh().catch(() => {
        if (activeRef.current)
          setError("Uploads could not be loaded. Try opening Add media again.");
      });
  }, [open, refresh]);
  usePageLifecycle({
    onHidden: () => {
      for (const [key, request] of proofRequestsRef.current) {
        request.abort();
        update(key, { state: "paused" });
      }
      for (const [key, upload] of instancesRef.current) {
        void upload.abort();
        update(key, { state: "paused" });
      }
    },
    onResume: () => {
      void refresh().catch(() => undefined);
    }
  });
  async function watchPublication(operationId: string) {
    if (!operationId || !activeRef.current) return;
    try {
      const operation = await getFileOperation(operationId);
      if (activeRef.current) callbacksRef.current(operation, false);
    } catch {
      /* Activity can reconcile publication after a delayed acknowledgement. */
    }
  }
  async function start(
    transfer: Transfer,
    retained?: { id: string; offset: number }
  ) {
    if (
      !transfer.file ||
      startingRef.current.has(transfer.key) ||
      cancelledRef.current.has(transfer.key)
    )
      return;
    startingRef.current.add(transfer.key);
    try {
      update(transfer.key, { state: "checking", error: undefined });
      if (
        !retained &&
        !transfer.id &&
        (transfer.state === "error" || transfer.state === "paused")
      ) {
        try {
          const { items } = await getUploads(undefined, transfer.operationId);
          if (!activeRef.current) return;
          const existing = items.find(
            (entry) => entry.requestId === transfer.operationId
          );
          if (existing) {
            update(transfer.key, { id: existing.id, record: existing });
            if (existing.status === "receiving") {
              startingRef.current.delete(transfer.key);
              await proveAndResume(
                { ...transfer, id: existing.id, record: existing },
                transfer.file
              );
              return;
            }
            if (existing.operationId) {
              update(transfer.key, {
                state: "received",
                accepted: existing.offset
              });
              await watchPublication(existing.operationId);
              return;
            }
            update(transfer.key, {
              state: "failed",
              error:
                "This upload could not be accepted. Add the file again to start a new upload."
            });
            onUploadCancelled(transfer.operationId, "failed");
            return;
          }
        } catch {
          update(transfer.key, {
            state: "error",
            error: "The upload could not be checked. Try Resume again."
          });
          return;
        }
      }
      const sdk = await import("tus-js-client").catch(() => null);
      if (!sdk) {
        update(transfer.key, {
          state: "error",
          error: "Uploads could not be opened. Reload and try again."
        });
        return;
      }
      const { Upload } = sdk;
      if (cancelledRef.current.has(transfer.key)) return;
      if (!activeRef.current || document.visibilityState === "hidden") {
        update(transfer.key, { state: "paused" });
        return;
      }
      const folderId =
        transfer.folderId ??
        transfer.record?.folderId ??
        destinationRef.current;
      const expectedParentVersion =
        transfer.expectedParentVersion ?? folderVersion(tree, folderId);
      if (!retained && (!folderId || !expectedParentVersion)) {
        update(transfer.key, {
          state: "error",
          error: "Choose a writable destination."
        });
        return;
      }
      const upload = new Upload(transfer.file, {
        endpoint: "/api/uploads",
        uploadUrl: retained
          ? `/api/uploads/${encodeURIComponent(retained.id)}`
          : undefined,
        metadata: {
          requestId: transfer.operationId,
          folderId,
          expectedParentVersion: expectedParentVersion ?? "",
          name: transfer.name,
          conflict: transfer.conflict ?? conflict
        },
        chunkSize: 16 * 1024 * 1024,
        parallelUploads: 1,
        retryDelays: [0, 1000, 3000, 5000],
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        httpStack: createUploadHttpStack(retained?.offset),
        onUploadUrlAvailable: () => {
          const id = upload.url?.split("/").at(-1);
          if (id) {
            saveUploadCheckpoint(id);
            update(transfer.key, { id });
          }
        },
        onChunkComplete: (_chunk, accepted) =>
          update(transfer.key, { accepted }),
        onShouldRetry: (caught) =>
          caught.originalRequest.getMethod() !== "POST" &&
          ![400, 401, 403, 404, 409, 410, 413, 415, 422].includes(
            caught.originalResponse?.getStatus() ?? 0
          ) &&
          document.visibilityState !== "hidden",
        onError: (caught) => {
          instancesRef.current.delete(transfer.key);
          const status =
            "originalResponse" in caught
              ? (
                  caught.originalResponse as { getStatus: () => number } | null
                )?.getStatus()
              : undefined;
          const rejected =
            status !== undefined && [400, 403, 413, 415, 422].includes(status);
          update(transfer.key, {
            state: rejected ? "failed" : "error",
            ...(rejected ? { file: undefined } : {}),
            error: rejected
              ? "This file could not be added. Check its type, size and destination, then add it again."
              : "Upload paused. Resume checks the received bytes before continuing."
          });
          if (rejected) onUploadCancelled(transfer.operationId, "failed");
        },
        onSuccess: ({ lastResponse }) => {
          instancesRef.current.delete(transfer.key);
          update(transfer.key, {
            state: "received",
            accepted: transfer.size,
            file: undefined
          });
          void watchPublication(
            lastResponse.getHeader("Upload-Operation-Id") ??
              transfer.operationId
          );
        }
      });
      instancesRef.current.set(transfer.key, upload);
      update(transfer.key, { state: "uploading" });
      upload.start();
    } catch {
      update(transfer.key, {
        state: "error",
        error:
          "The upload could not be started. Try Resume to check its status."
      });
    } finally {
      startingRef.current.delete(transfer.key);
    }
  }
  const startRef = useRef(start);
  startRef.current = start;
  const running = transfers.filter(
    (transfer) =>
      transfer.state === "uploading" || transfer.state === "checking"
  ).length;
  useEffect(() => {
    if (running >= 2 || document.visibilityState === "hidden") return;
    const queued = transfers
      .filter((transfer) => transfer.state === "queued")
      .slice(0, 2 - running);
    for (const transfer of queued) {
      update(transfer.key, { state: "checking" });
      void startRef.current(transfer);
    }
  }, [running, transfers, update]);
  useEffect(() => {
    if (!transfers.some((transfer) => transfer.state === "received")) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "hidden")
        void refresh().catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [refresh, transfers]);
  function enqueue(
    files: Array<{ key: string; file: File; conflict?: "skip" | "keep-both" }>
  ) {
    const active = transfers.filter(
      (transfer) =>
        !["completed", "failed", "cancelled", "expired"].includes(
          transfer.state
        )
    );
    if (active.length + files.length > 100) {
      return false;
    }
    const next = files.map(({ file, key, conflict: fileConflict }) => ({
      key,
      operationId: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      accepted: 0,
      folderId: destination,
      expectedParentVersion: folderVersion(tree, destination),
      conflict: fileConflict ?? conflict,
      state: "queued" as const,
      file
    }));
    onBatchStarted(next.map((transfer) => transfer.operationId));
    setTransfers([...active, ...next]);
    return true;
  }
  async function proveAndResume(transfer: Transfer, file: File) {
    if (!transfer.id) {
      await start({ ...transfer, file });
      return;
    }
    if (file.size !== transfer.size || file.name !== transfer.name) {
      update(transfer.key, {
        state: "error",
        error: "Choose the same file, or add the changed file as a new upload."
      });
      return;
    }
    if (
      proofBusyRef.current.has(transfer.key) ||
      cancelledRef.current.has(transfer.key)
    )
      return;
    const admitted = new Set([
      ...instancesRef.current.keys(),
      ...startingRef.current,
      ...proofBusyRef.current
    ]);
    if (!admitted.has(transfer.key) && admitted.size >= 2) return;
    proofBusyRef.current.add(transfer.key);
    update(transfer.key, { state: "checking", error: undefined });
    let ownedWorker: Worker | undefined;
    const controller = new AbortController();
    proofRequestsRef.current.set(transfer.key, controller);
    try {
      const status = await getUploads(controller.signal, transfer.operationId);
      const retained = status.items.find((record) => record.id === transfer.id);
      if (
        retained &&
        retained.offset === retained.size &&
        ["validating", "publishing", "completed"].includes(retained.status)
      ) {
        update(transfer.key, {
          state: retained.status === "completed" ? "completed" : "received",
          accepted: retained.offset,
          file: undefined
        });
        if (retained.operationId) await watchPublication(retained.operationId);
        return;
      }
      const proof = await getUploadPrefix(transfer.id, controller.signal);
      const worker = new Worker(
        new URL("./upload-prefix.worker.ts", import.meta.url),
        { type: "module" }
      );
      ownedWorker = worker;
      workersRef.current.add(worker);
      const digest = await new Promise<string>((resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => {
            worker.terminate();
            reject(new DOMException("Cancelled", "AbortError"));
          },
          { once: true }
        );
        worker.onmessage = (
          event: MessageEvent<{ sha256?: string; error?: string }>
        ) =>
          event.data.sha256
            ? resolve(event.data.sha256)
            : reject(new Error(event.data.error));
        worker.onerror = () => reject(new Error("File check failed."));
        worker.postMessage({ file, offset: proof.offset });
      });
      worker.terminate();
      workersRef.current.delete(worker);
      if (!activeRef.current || controller.signal.aborted) return;
      if (digest !== proof.sha256)
        throw new Error(
          "The selected file differs from the received bytes. Add it as a new upload."
        );
      const current = await getUploadPrefix(transfer.id, controller.signal);
      if (current.offset !== proof.offset || current.sha256 !== proof.sha256)
        throw new Error("This upload changed while checking. Try again.");
      await start(
        { ...transfer, file },
        { id: transfer.id, offset: proof.offset }
      );
    } catch (caught) {
      if (controller.signal.aborted) return;
      update(transfer.key, {
        state: "error",
        error:
          caught instanceof Error
            ? caught.message
            : "The selected file could not be checked."
      });
    } finally {
      ownedWorker?.terminate();
      if (ownedWorker) workersRef.current.delete(ownedWorker);
      proofBusyRef.current.delete(transfer.key);
      proofRequestsRef.current.delete(transfer.key);
    }
  }
  async function cancelTransfer(transfer: Transfer) {
    if (cancelBusyRef.current.has(transfer.key)) return;
    cancelBusyRef.current.add(transfer.key);
    cancelledRef.current.add(transfer.key);
    proofRequestsRef.current.get(transfer.key)?.abort();
    const upload = instancesRef.current.get(transfer.key);
    try {
      if (upload) await upload.abort();
      await cancelUpload(transfer.operationId);
      update(transfer.key, { state: "cancelled", file: undefined });
      onUploadCancelled(transfer.operationId, "cancelled");
    } catch (caught) {
      cancelledRef.current.delete(transfer.key);
      update(transfer.key, {
        state: "error",
        error:
          caught instanceof ApiError && caught.status === 409
            ? "This upload is already being prepared. Check Activity for its result."
            : "Cancellation could not be confirmed. Try again."
      });
      if (caught instanceof ApiError && caught.status === 409)
        void refresh().catch(() => undefined);
    } finally {
      instancesRef.current.delete(transfer.key);
      cancelBusyRef.current.delete(transfer.key);
    }
  }
  function pause(transfer: Transfer) {
    void instancesRef.current.get(transfer.key)?.abort();
    instancesRef.current.delete(transfer.key);
    update(transfer.key, { state: "paused" });
  }
  return {
    transfers,
    error,
    limits,
    refresh,
    enqueue,
    pause,
    running,
    resume: proveAndResume,
    cancel: cancelTransfer
  };
}
