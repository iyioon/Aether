import { describe, expect, it } from "vitest";
import type { FileOperation } from "../../api/client";
import { activityItemsLabel, activityProgressLabel } from "./activity-model";

function operation(patch: Partial<FileOperation> = {}): FileOperation {
  return {
    id: "operation",
    type: "rename-media",
    status: "completed",
    revision: "1",
    items: [{ name: "holiday.jpg", status: "completed" }],
    ...patch
  };
}

describe("Activity descriptions", () => {
  it("identifies a single completed operation without repeating its status", () => {
    expect(activityItemsLabel(operation())).toBe("holiday.jpg");
    expect(activityProgressLabel(operation())).toBeNull();
  });

  it("uses the authoritative batch total when only some items are returned", () => {
    const batch = operation({
      summary: { total: 20, completed: 18, failed: 1, cancelled: 1 }
    });
    expect(activityItemsLabel(batch)).toBe("holiday.jpg and 19 more");
    expect(activityProgressLabel(batch)).toBe(
      "18 of 20 completed · 1 failed · 1 cancelled"
    );
  });

  it("distinguishes incomplete outcomes when there is no summary", () => {
    const batch = operation({
      status: "needs_attention",
      items: [
        { name: "first.jpg", status: "completed" },
        { name: "second.jpg", status: "failed" },
        { name: "third.jpg", status: "needs_attention" }
      ]
    });
    expect(activityProgressLabel(batch)).toBe(
      "1 of 3 completed · 1 failed · 1 needs attention"
    );
  });

  it("does not invent a filename for aggregate operations", () => {
    expect(
      activityItemsLabel(operation({ type: "empty-trash", items: [] }))
    ).toBeNull();
  });
});
