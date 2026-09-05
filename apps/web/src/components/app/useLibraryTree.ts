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
  const [watchStatus, setWatchStatus] = useState<LibraryWatchStatus | null>(
    null
  );
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const observedScanJobIdRef = useRef<string | null>(null);

  const applyTreeResponse = useCallback((response: TreeResponse) => {
    const knownFolderIds = new Set([
      ...response.roots.map((entry) => entry.folderId),
      ...response.folders.map((entry) => entry.id)
    ]);

    setTree(response);
    setSelectedFolderId((current) =>
      current && knownFolderIds.has(current)
        ? current
        : response.roots[0]?.folderId ?? null
    );
  }, []);

  const refreshTree = useCallback(async () => {
    const response = await getTree();
    applyTreeResponse(response);
    return response;
  }, [applyTreeResponse]);

  const waitForScan = useCallback(async (jobId: string) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(500);
      const { jobs } = await getScanJobs();
      const job = jobs.find((entry) => entry.id === jobId);

      if (!job || job.status === "running") {
        continue;
      }

      setScanState(job.status);
      return;
    }

    setScanState("running");
  }, []);

  useEffect(() => {
    let active = true;

    getTree()
      .then((nextTree) => {
        if (!active) {
          return;
        }

        applyTreeResponse(nextTree);
      })
      .catch((caught) => {
        if (active) {
          const message =
            caught instanceof ApiError ? caught.code : "Unable to load library.";
          setError(message);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingTree(false);
        }
      });

    Promise.all([
      getWatchStatus().catch(() => null),
      getScanJobs().catch(() => ({ jobs: [] })),
      getAiStatus().catch(() => null)
    ])
      .then(([nextWatchStatus, scanJobs, nextAiStatus]) => {
        if (!active) {
          return;
        }

        setWatchStatus(nextWatchStatus);
        observedScanJobIdRef.current = scanJobs.jobs[0]?.id ?? null;
        setAiStatus(nextAiStatus);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [applyTreeResponse]);

  useEffect(() => {
    if (!watchStatus?.enabled) {
      return;
    }

    let active = true;
    const pollInterval = window.setInterval(() => {
      Promise.all([getWatchStatus(), getScanJobs()])
        .then(async ([nextWatchStatus, scanJobs]) => {
          if (!active) {
            return;
          }

          setWatchStatus(nextWatchStatus);
          const latestJob = scanJobs.jobs[0];

          if (!latestJob) {
            return;
          }

          if (latestJob.status === "running") {
            setScanState((current) =>
              current === "starting" ? current : "running"
            );
            return;
          }

          if (latestJob.id !== observedScanJobIdRef.current) {
            observedScanJobIdRef.current = latestJob.id;
            setScanState(latestJob.status);
            const nextTree = await getTree();

            if (active) {
              applyTreeResponse(nextTree);
            }
          }
        })
        .catch(() => undefined);
    }, 10_000);

    return () => {
      active = false;
      window.clearInterval(pollInterval);
    };
  }, [applyTreeResponse, watchStatus?.enabled]);

  const handleScan = useCallback(async () => {
    setScanState("starting");

    try {
      const scan = await startScan();
      observedScanJobIdRef.current = scan.jobId;
      setScanState(scan.status === "running" ? "running" : "idle");
      await waitForScan(scan.jobId);
      await refreshTree();
    } catch {
      setScanState("failed");
    }
  }, [refreshTree, waitForScan]);

  return {
    aiStatus,
    error,
    handleScan,
    isLoadingTree,
    scanState,
    selectedFolderId,
    setSelectedFolderId,
    tree,
    watchStatus
  };
}
