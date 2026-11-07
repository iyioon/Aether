import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getAiStatus,
  getScanJobs,
  getTree,
  getWatchStatus,
  startScan,
  type AiStatus,
  type LibraryWatchStatus,
  type ScanProgress,
  type TreeResponse
} from "../../api/client";
import type { FolderScanState } from "../folders/folder-tree-types";
import { createUuid } from "../../lib/uuid";
import { sleep } from "./app-helpers";
import {
  scanStateForJob,
  scanToastForState,
  type ScanNotification
} from "./scan-status";

interface UseLibraryTreeOptions {
  initialFolderId: string | null;
}

export function useLibraryTree({ initialFolderId }: UseLibraryTreeOptions) {
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    initialFolderId
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [scanState, setScanState] = useState<FolderScanState>("idle");
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanNotification, setScanNotification] =
    useState<ScanNotification | null>(null);
  const [watchStatus, setWatchStatus] = useState<LibraryWatchStatus | null>(
    null
  );
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const treeRevisionRef = useRef<string | null>(null);
  const treeRequestRef = useRef(0);
  const observedScanJobIdRef = useRef<string | null>(null);
  const scanPollAbortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(true);
  const scanStartRef = useRef(false);

  const finishScan = useCallback(
    (jobId: string, state: FolderScanState, userStarted = false) => {
      setScanState(state);
      setScanProgress(null);
      const notification = scanToastForState(state);
      if (notification && (userStarted || state !== "completed")) {
        setScanNotification((previous) =>
          previous?.id === jobId ? previous : { ...notification, id: jobId }
        );
      }
    },
    []
  );

  const applyTreeResponse = useCallback((response: TreeResponse) => {
    const previous = treeRevisionRef.current;
    if (
      previous &&
      response.revision &&
      /^\d+$/.test(previous) &&
      /^\d+$/.test(response.revision) &&
      BigInt(response.revision) < BigInt(previous)
    )
      return;
    treeRevisionRef.current = response.revision ?? previous;
    const knownFolderIds = new Set([
      ...response.roots.map((entry) => entry.folderId),
      ...response.folders.map((entry) => entry.id)
    ]);

    setTree(response);
    setSelectedFolderId((current) =>
      current && knownFolderIds.has(current)
        ? current
        : (response.roots[0]?.folderId ?? null)
    );
  }, []);

  const refreshTree = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++treeRequestRef.current;
      const response = await getTree(signal);
      if (requestId !== treeRequestRef.current || signal?.aborted)
        throw new DOMException("Obsolete tree read", "AbortError");
      applyTreeResponse(response);
      setError(null);
      return response;
    },
    [applyTreeResponse]
  );

  const waitForScan = useCallback(
    async (jobId: string, signal: AbortSignal, userStarted: boolean) => {
      while (!signal.aborted) {
        await sleep(500);

        if (signal.aborted) {
          return false;
        }

        let jobs: Awaited<ReturnType<typeof getScanJobs>>["jobs"];
        try {
          ({ jobs } = await getScanJobs(signal));
        } catch {
          continue;
        }
        if (signal.aborted) return false;
        const job = jobs.find((entry) => entry.id === jobId);

        if (!job || job.status === "running") {
          if (job?.progress) {
            setScanProgress(job.progress);
          }
          continue;
        }

        finishScan(job.id, scanStateForJob(job), userStarted);
        return true;
      }

      return false;
    },
    [finishScan]
  );

  const observeScanJob = useCallback(
    async (jobId: string, userStarted = false) => {
      scanPollAbortRef.current?.abort();
      const controller = new AbortController();
      scanPollAbortRef.current = controller;

      try {
        const reachedTerminalState = await waitForScan(
          jobId,
          controller.signal,
          userStarted
        );

        if (reachedTerminalState && !controller.signal.aborted) {
          await refreshTree(controller.signal);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof ApiError
              ? caught.code
              : "Unable to refresh the library after scanning."
          );
        }
      } finally {
        if (scanPollAbortRef.current === controller) {
          scanPollAbortRef.current = null;
        }
      }
    },
    [refreshTree, waitForScan]
  );

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      scanPollAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    refreshTree(controller.signal)
      .then((nextTree) => {
        if (controller.signal.aborted) {
          return;
        }

        applyTreeResponse(nextTree);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          const message =
            caught instanceof ApiError
              ? caught.code
              : "Unable to load library.";
          setError(message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingTree(false);
        }
      });

    Promise.all([
      getWatchStatus(controller.signal).catch(() => null),
      getScanJobs(controller.signal).catch(() => ({ jobs: [] })),
      getAiStatus(controller.signal).catch(() => null)
    ])
      .then(([nextWatchStatus, scanJobs, nextAiStatus]) => {
        if (controller.signal.aborted) {
          return;
        }

        setWatchStatus(nextWatchStatus);
        const latestScanJob = scanJobs.jobs[0];
        observedScanJobIdRef.current = latestScanJob?.id ?? null;
        if (latestScanJob?.status === "running") {
          setScanState("running");
          setScanProgress(latestScanJob.progress);
          void observeScanJob(latestScanJob.id);
        }
        setAiStatus(nextAiStatus);
      })
      .catch(() => undefined);

    return () => {
      controller.abort();
    };
  }, [applyTreeResponse, observeScanJob, refreshTree]);

  useEffect(() => {
    if (!watchStatus?.enabled) {
      return;
    }

    const controller = new AbortController();
    let pollTimer: number | null = null;

    const schedulePoll = () => {
      pollTimer = window.setTimeout(() => {
        void pollWatchStatus();
      }, 10_000);
    };

    const pollWatchStatus = async () => {
      try {
        const [nextWatchStatus, scanJobs] = await Promise.all([
          getWatchStatus(controller.signal),
          getScanJobs(controller.signal)
        ]);

        if (controller.signal.aborted) {
          return;
        }

        setWatchStatus(nextWatchStatus);
        const latestJob = scanJobs.jobs[0];

        if (!latestJob) {
          return;
        }

        if (latestJob.status === "running") {
          setScanProgress(latestJob.progress);
          setScanState((current) =>
            current === "starting" ? current : "running"
          );
          return;
        }

        if (latestJob.id !== observedScanJobIdRef.current) {
          observedScanJobIdRef.current = latestJob.id;
          finishScan(latestJob.id, scanStateForJob(latestJob));
          const nextTree = await refreshTree(controller.signal);

          if (!controller.signal.aborted) {
            applyTreeResponse(nextTree);
          }
        }
      } catch {
        // A later poll retries transient watcher and job-status failures.
      } finally {
        if (!controller.signal.aborted) {
          schedulePoll();
        }
      }
    };

    schedulePoll();

    return () => {
      controller.abort();
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [applyTreeResponse, finishScan, refreshTree, watchStatus?.enabled]);

  const handleScan = useCallback(async () => {
    if (!activeRef.current || scanStartRef.current) return;
    scanStartRef.current = true;
    setScanState("starting");
    setScanProgress(null);

    try {
      const scan = await startScan();
      if (!activeRef.current) return;
      observedScanJobIdRef.current = scan.jobId;
      setScanState(scan.status === "running" ? "running" : "idle");
      await observeScanJob(scan.jobId, true);
    } catch (caught) {
      if (!activeRef.current) return;
      setScanState("failed");
      setScanProgress(null);
      if (!(caught instanceof ApiError && caught.status === 401)) {
        setScanNotification({
          id: createUuid(),
          title: "Scan could not be confirmed",
          description:
            "Check the server connection and scan status before trying again.",
          variant: "error"
        });
      }
    } finally {
      scanStartRef.current = false;
    }
  }, [observeScanJob]);

  return {
    aiStatus,
    error,
    handleScan,
    refreshTree,
    isLoadingTree,
    scanProgress,
    scanNotification,
    scanState,
    selectedFolderId,
    setSelectedFolderId,
    tree,
    watchStatus
  };
}
