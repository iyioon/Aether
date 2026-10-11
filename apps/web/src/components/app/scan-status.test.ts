import { describe, expect, it } from "vitest";
import type { ScanResult } from "../../api/client";
import { scanStateForJob, scanToastForState } from "./scan-status";

describe("scan job presentation state", () => {
  it("treats only a clean reconciled scan as a normal completion", () => {
    expect(scanStateForJob({ status: "completed", result: scanResult() })).toBe(
      "completed"
    );
  });

  it("keeps cache-cleanup warnings distinct from a failed scan", () => {
    expect(
      scanStateForJob({
        status: "completed",
        result: scanResult({
          warnings: ["derivative_cache_cleanup_failed"]
        })
      })
    ).toBe("completed_with_warnings");
  });

  it("never presents an incomplete scan as successful", () => {
    expect(scanStateForJob({ status: "incomplete", result: null })).toBe(
      "incomplete"
    );
    expect(
      scanStateForJob({
        status: "completed",
        result: scanResult({
          outcome: "incomplete",
          incompleteReason: "source_changed_or_unavailable",
          errors: 1
        })
      })
    ).toBe("incomplete");
  });

  it("preserves running and failed job states", () => {
    expect(scanStateForJob({ status: "running", result: null })).toBe(
      "running"
    );
    expect(scanStateForJob({ status: "failed", result: null })).toBe("failed");
  });
});

describe("scan status notifications", () => {
  it("uses success only for a clean completion", () => {
    expect(scanToastForState("completed")).toMatchObject({
      title: "Scan complete",
      variant: "success"
    });
    expect(scanToastForState("completed_with_warnings")).toMatchObject({
      title: "Scan complete with a warning",
      variant: "warning"
    });
  });

  it("explains that an incomplete scan applied no library changes", () => {
    const notification = scanToastForState("incomplete");

    expect(notification).toMatchObject({
      title: "Scan incomplete",
      variant: "warning"
    });
    expect(notification?.description).toContain(
      "No library changes were applied"
    );
    expect(notification?.variant).not.toBe("success");
  });

  it("uses an error notification for a failed scan", () => {
    expect(scanToastForState("failed")).toMatchObject({
      title: "Scan failed",
      variant: "error"
    });
  });

  it("does not notify for nonterminal states", () => {
    expect(scanToastForState("idle")).toBeNull();
    expect(scanToastForState("starting")).toBeNull();
    expect(scanToastForState("running")).toBeNull();
  });
});

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    outcome: "completed",
    incompleteReason: null,
    warnings: [],
    roots: 1,
    folders: 2,
    assets: 3,
    skipped: 0,
    errors: 0,
    removedAssets: 0,
    removedFolders: 0,
    startedAt: "2026-10-11T00:00:00.000Z",
    finishedAt: "2026-10-11T00:00:01.000Z",
    ...overrides
  };
}
