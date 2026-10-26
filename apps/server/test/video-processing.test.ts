import { describe, expect, it } from "vitest";
import {
  runMediaCommand,
  withVideoProcessingSlot
} from "../src/library/video-processing.js";

describe("bounded media processing", () => {
  it("reserves at most two slots while queued jobs and failures settle", async () => {
    let running = 0;
    let peak = 0;
    const settled = await Promise.allSettled(
      Array.from({ length: 24 }, (_, index) =>
        withVideoProcessingSlot(async () => {
          running += 1;
          peak = Math.max(peak, running);
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 1));
            if (index % 7 === 0) throw new Error("Fixture failure");
            return index;
          } finally {
            running -= 1;
          }
        })
      )
    );
    expect(peak).toBe(2);
    expect(running).toBe(0);
    expect(
      settled.filter((result) => result.status === "rejected")
    ).toHaveLength(4);
    await expect(
      withVideoProcessingSlot(async () => "available")
    ).resolves.toBe("available");
  });

  it("kills commands that exceed bounded stdout instead of parsing truncated metadata", async () => {
    await expect(
      runMediaCommand(
        process.execPath,
        [
          "-e",
          "require('node:fs').writeSync(1,'x'.repeat(128 * 1024));setTimeout(()=>{},1000)"
        ],
        2000
      )
    ).rejects.toThrow("exceeded its output limit");
  });

  it("kills stalled commands and returns no partial success", async () => {
    await expect(
      runMediaCommand(process.execPath, ["-e", "setTimeout(()=>{},1000)"], 25)
    ).rejects.toThrow("timed out");
  });
});
