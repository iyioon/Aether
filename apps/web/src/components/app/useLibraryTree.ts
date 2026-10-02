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
import { sleep } from "./app-helpers";

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
  const [watchStatus, setWatchStatus] = useState<LibraryWatchStatus | null>(
    null
  );
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const observedScanJobIdRef = useRef<string | null>(null);
  const scanPollAbortRef = useRef<AbortController | null>(null);

  const applyTreeResponse = useCallback((response: TreeResponse) => {
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
      const response = await getTree(signal);
      applyTreeResponse(response);
      return response;
    },
    [applyTreeResponse]
  );

  const waitForScan = useCallback(
    async (jobId: string, signal: AbortSignal) => {
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
        const job = jobs.find((entry) => entry.id === jobId);

        if (!job || job.status === "running") {
          if (job?.progress) {
            setScanProgress(job.progress);
          }
          continue;
        }

        setScanState(job.status);
        setScanProgress(null);
        return true;
      }

      return false;
    },
    []
  );

  const observeScanJob = useCallback(
    async (jobId: string) => {
      scanPollAbortRef.current?.abort();
      const controller = new AbortController();
      scanPollAbortRef.current = controller;

      try {
        const reachedTerminalState = await waitForScan(
          jobId,
          controller.signal
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

  useEffect(
    () => () => {
      scanPollAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();

    getTree(controller.signal)
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
  }, [applyTreeResponse, observeScanJob]);

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
          setScanState(latestJob.status);
          setScanProgress(null);
          const nextTree = await getTree(controller.signal);

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
  }, [applyTreeResponse, watchStatus?.enabled]);

  const handleScan = useCallback(async () => {
    setScanState("starting");
    setScanProgress(null);

    try {
      const scan = await startScan();
      observedScanJobIdRef.current = scan.jobId;
      setScanState(scan.status === "running" ? "running" : "idle");
      await observeScanJob(scan.jobId);
    } catch {
      setScanState("failed");
      setScanProgress(null);
    }
  }, [observeScanJob]);

  return {
    aiStatus,
    error,
    handleScan,
    isLoadingTree,
    scanProgress,
    scanState,
    selectedFolderId,
    setSelectedFolderId,
    tree,
    watchStatus
  };
}
