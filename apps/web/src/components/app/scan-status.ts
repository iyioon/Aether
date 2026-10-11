import type { ScanJob } from "../../api/client";
import type { FolderScanState } from "../folders/folder-tree-types";

export interface ScanStatusToast {
  description: string;
  title: string;
  variant: "success" | "warning" | "error";
}

export function scanStateForJob(
  job: Pick<ScanJob, "result" | "status">
): FolderScanState {
  if (job.status === "running") {
    return "running";
  }
  if (job.status === "failed") {
    return "failed";
  }
  if (job.status === "incomplete" || job.result?.outcome === "incomplete") {
    return "incomplete";
  }
  if (job.result?.warnings?.length) {
    return "completed_with_warnings";
  }
  return "completed";
}

export function scanToastForState(
  state: FolderScanState
): ScanStatusToast | null {
  switch (state) {
    case "completed":
      return {
        description: "Your library scan finished successfully.",
        title: "Scan complete",
        variant: "success"
      };
    case "completed_with_warnings":
      return {
        description:
          "Your library was updated, but some cached previews could not be cleaned up.",
        title: "Scan complete with a warning",
        variant: "warning"
      };
    case "incomplete":
      return {
        description:
          "Some media changed or could not be read. No library changes were applied; check that your media is available, then try again.",
        title: "Scan incomplete",
        variant: "warning"
      };
    case "failed":
      return {
        description: "The library could not be refreshed. Please try again.",
        title: "Scan failed",
        variant: "error"
      };
    case "idle":
    case "starting":
    case "running":
      return null;
  }
}
