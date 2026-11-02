import type { FileOperation } from "../../api/client";
import { isOperationTerminal } from "./management-model";

export type OperationNotice =
  | {
      kind: "operation";
      id: string;
      eventId: string;
      operation: FileOperation;
    }
  | {
      kind: "upload";
      id: string;
      eventId: string;
      added: number;
      failed: number;
      total: number;
    };

type NoticeSeverity = "success" | "warning" | "error";

export function operationNotice(
  operation: FileOperation
): OperationNotice | undefined {
  if (!isOperationTerminal(operation) || operation.type === "add-media") return;
  return {
    kind: "operation",
    id: operation.id,
    eventId: `${operation.id}:${operation.status}:${operation.summary?.completed ?? ""}:${operation.summary?.failed ?? ""}:${operation.summary?.needsAttention ?? ""}:${operation.items.map((item) => `${item.status}:${item.errorCode ?? ""}`).join("|")}`,
    operation
  };
}

export function noticeSeverity(notice: OperationNotice): NoticeSeverity {
  if (notice.kind === "upload") return notice.failed ? "warning" : "success";
  if (notice.operation.status === "failed") return "error";
  if (
    notice.operation.status === "partial" ||
    notice.operation.status === "needs_attention"
  )
    return "warning";
  return "success";
}

function strongestSeverity(
  left: NoticeSeverity,
  right: NoticeSeverity
): NoticeSeverity {
  if (left === "error" || right === "error") return "error";
  return left === "warning" || right === "warning" ? "warning" : "success";
}

// Keep only bounded toast payloads; Activity owns the complete result history.
export class OperationNotificationBuffer {
  private readonly notified = new Set<string>();
  private readonly pending = new Map<string, OperationNotice>();
  private overflow = 0;
  private overflowSeverity: NoticeSeverity = "success";

  constructor(private readonly limit = 100) {}

  enqueue(notice: OperationNotice): boolean {
    if (this.notified.has(notice.eventId)) return false;
    this.notified.add(notice.eventId);
    this.pending.set(notice.id, notice);
    if (this.pending.size > this.limit) {
      const oldest = this.pending.entries().next().value;
      if (oldest) {
        this.pending.delete(oldest[0]);
        this.overflow++;
        this.overflowSeverity = strongestSeverity(
          this.overflowSeverity,
          noticeSeverity(oldest[1])
        );
      }
    }
    return true;
  }

  drain() {
    const notices = [...this.pending.values()];
    const count = notices.length + this.overflow;
    const severity = notices.reduce(
      (current, notice) => strongestSeverity(current, noticeSeverity(notice)),
      this.overflowSeverity
    );
    this.pending.clear();
    this.overflow = 0;
    this.overflowSeverity = "success";
    return { notices, count, severity };
  }

  clear() {
    this.notified.clear();
    this.pending.clear();
    this.overflow = 0;
    this.overflowSeverity = "success";
  }
}
