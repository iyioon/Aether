import { describe, expect, it } from "vitest";
import { mkdtemp, open, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { descriptorPath } from "../src/security/descriptor-filesystem.js";
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

  it("streams large output without retaining it in the command result", async () => {
    let bytes = 0;
    const result = await runMediaCommand(
      process.execPath,
      ["-e", "require('node:fs').writeSync(1,Buffer.alloc(2*1024*1024,120))"],
      2000,
      undefined,
      (chunk) => {
        bytes += chunk.length;
      }
    );
    expect(bytes).toBe(2 * 1024 * 1024);
    expect(result.stdout).toBe("");
  });

  it("kills and reaps a child when its bounded output consumer rejects data", async () => {
    const failure = new Error("invalid bounded frame record");
    let pid = 0;
    await expect(
      runMediaCommand(
        process.execPath,
        [
          "-e",
          "require('node:fs').writeSync(1,String(process.pid));setInterval(()=>{},1000)"
        ],
        2000,
        undefined,
        (chunk) => {
          pid = Number(chunk.toString("utf8"));
          throw failure;
        }
      )
    ).rejects.toBe(failure);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("allows a bounded metadata stdout override without raising the default or exceeding one MiB", async () => {
    const result = await runMediaCommand(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(128*1024))"],
      2000,
      256 * 1024
    );
    expect(result.stdout.length).toBe(128 * 1024);
    await expect(
      runMediaCommand(process.execPath, [], 2000, 2 * 1024 * 1024)
    ).rejects.toThrow("Invalid media command output limit");
  });

  it.skipIf(!["linux", "darwin"].includes(process.platform))(
    "passes a pinned file to a child after its original pathname is replaced",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "aether-media-fd-"));
      const filename = path.join(directory, "source");
      await writeFile(filename, "verified source");
      const handle = await open(filename, "r");
      try {
        await unlink(filename);
        await writeFile(filename, "replacement");
        await handle.read(Buffer.alloc(3), 0, 3, null);
        const result = await runMediaCommand(
          process.execPath,
          [
            "-e",
            "process.stdout.write(require('node:fs').readFileSync(process.argv[1]))",
            descriptorPath({ fd: 3 })
          ],
          2000,
          undefined,
          undefined,
          handle.fd
        );
        expect(result.stdout).toBe("verified source");
        expect((await handle.stat()).isFile()).toBe(true);
      } finally {
        await handle.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid inherited descriptor (%s)",
    async (descriptor) => {
      await expect(
        runMediaCommand(
          process.execPath,
          [],
          2000,
          undefined,
          undefined,
          descriptor
        )
      ).rejects.toThrow("Invalid media input descriptor");
    }
  );
});
