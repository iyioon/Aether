import { describe, expect, it, vi } from "vitest";
import type { AetherDatabase } from "../src/db/database.js";
import { withPresentationLifecycle } from "../src/library/presentation-cache.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("presentation lifecycle admission", () => {
  it("serializes eight admitted operations and rejects excess work before it starts", async () => {
    const db = {} as AetherDatabase;
    const held = gate();
    const order: number[] = [];
    const tasks = Array.from({ length: 8 }, (_, index) =>
      withPresentationLifecycle(db, async () => {
        order.push(index);
        if (index === 0) await held.promise;
      })
    );
    const excess = vi.fn(async () => undefined);
    try {
      await expect(withPresentationLifecycle(db, excess)).rejects.toMatchObject(
        { code: "processing_busy", status: 503 }
      );
      expect(excess).not.toHaveBeenCalled();
      expect(order).toEqual([0]);
    } finally {
      held.release();
    }
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(
      withPresentationLifecycle(db, async () => "available")
    ).resolves.toBe("available");
  });

  it("releases rejected work and does not serialize unrelated databases", async () => {
    const db = {} as AetherDatabase;
    const held = gate();
    const failure = withPresentationLifecycle(db, async () => {
      await held.promise;
      throw new Error("failed publication");
    });
    const rejected = expect(failure).rejects.toThrow("failed publication");
    const following = withPresentationLifecycle(db, async () => "next");
    await expect(
      withPresentationLifecycle({} as AetherDatabase, async () => "independent")
    ).resolves.toBe("independent");
    held.release();
    await rejected;
    await expect(following).resolves.toBe("next");
  });
});
