import { describe, expect, it } from "vitest";
import type { FileOperation } from "../../api/client";
import {
  noticeSeverity,
  operationNotice,
  OperationNotificationBuffer,
  type OperationNotice
} from "./operation-notifications";

function operation(
  id: string,
  status: FileOperation["status"] = "completed"
): FileOperation {
  return {
    id,
    type: "trash",
    status,
    items: [{ assetId: `${id}-asset`, status }],
    revision: "1"
  };
}

function notice(id: string, status?: FileOperation["status"]) {
  return operationNotice(operation(id, status))!;
}

describe("operation notifications", () => {
  it("requires an acknowledged final result and leaves uploads to their batch", () => {
    for (const status of ["queued", "running"] as const)
      expect(operationNotice(operation("pending", status))).toBeUndefined();
    expect(
      operationNotice({ ...operation("upload"), type: "add-media" })
    ).toBeUndefined();
  });

  it("deduplicates repeated polling and foreground acknowledgements after draining", () => {
    const buffer = new OperationNotificationBuffer();
    expect(buffer.enqueue(notice("one"))).toBe(true);
    expect(buffer.enqueue(notice("one"))).toBe(false);
    expect(buffer.drain().count).toBe(1);
    expect(buffer.enqueue(notice("one"))).toBe(false);
    expect(buffer.drain().count).toBe(0);
  });

  it("keeps the latest outcome for one operation while a notification is deferred", () => {
    const buffer = new OperationNotificationBuffer();
    buffer.enqueue(notice("one", "needs_attention"));
    buffer.enqueue(notice("one", "completed"));
    expect(buffer.drain()).toEqual({
      notices: [notice("one", "completed")],
      count: 1,
      severity: "success"
    });
  });

  it("allows a newly acknowledged recovery after its earlier warning was shown", () => {
    const buffer = new OperationNotificationBuffer();
    buffer.enqueue(notice("one", "needs_attention"));
    expect(buffer.drain().severity).toBe("warning");
    expect(buffer.enqueue(notice("one", "completed"))).toBe(true);
    expect(buffer.drain().count).toBe(1);
  });

  it("coalesces operation and upload batches without counting duplicate outcomes", () => {
    const buffer = new OperationNotificationBuffer();
    const upload: OperationNotice = {
      kind: "upload",
      id: "upload-batch",
      eventId: "upload-batch",
      added: 2,
      failed: 1,
      total: 3
    };
    buffer.enqueue(notice("trash"));
    buffer.enqueue(upload);
    buffer.enqueue(upload);
    const batch = buffer.drain();
    expect(batch.count).toBe(2);
    expect(batch.severity).toBe("warning");
    expect(batch.notices).toHaveLength(2);
  });

  it("bounds retained toast payloads while preserving the summary count and severity", () => {
    const buffer = new OperationNotificationBuffer(2);
    buffer.enqueue(notice("failed", "failed"));
    buffer.enqueue(notice("two"));
    buffer.enqueue(notice("three"));
    buffer.enqueue(notice("failed", "failed"));
    expect(buffer.drain()).toEqual({
      notices: [notice("two"), notice("three")],
      count: 3,
      severity: "error"
    });
    expect(buffer.drain().count).toBe(0);
  });

  it("uses warnings for reviewable outcomes and errors for confirmed failures", () => {
    expect(noticeSeverity(notice("attention", "needs_attention"))).toBe(
      "warning"
    );
    expect(noticeSeverity(notice("partial", "partial"))).toBe("warning");
    expect(noticeSeverity(notice("failed", "failed"))).toBe("error");
  });

  it("discards pending private notifications when their session is cleared", () => {
    const buffer = new OperationNotificationBuffer();
    buffer.enqueue(notice("one"));
    buffer.clear();
    expect(buffer.drain().count).toBe(0);
  });
});
