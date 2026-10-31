import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBouncePlan,
  type VideoBounceProfile
} from "../src/library/presentation-bounce.js";
import * as processing from "../src/library/video-processing.js";

const profile: VideoBounceProfile = {
  width: 64,
  height: 48,
  pixelFormat: "yuv420p",
  bitDepth: 8,
  sampleAspectRatio: "1:1",
  rotation: 0,
  frameRate: 10,
  durationMs: 1000,
  startTimeSeconds: 0,
  streamIndex: 0,
  colorRange: "tv",
  colorSpace: "bt709",
  colorTransfer: "bt709",
  colorPrimaries: "bt709",
  chromaLocation: "left"
};

function frame(
  time: number,
  duration = 0.1,
  changes: Record<string, string> = {}
) {
  return Object.entries({
    best_effort_timestamp_time: String(time),
    duration_time: String(duration),
    width: "64",
    height: "48",
    pix_fmt: "yuv420p",
    interlaced_frame: "0",
    color_range: "tv",
    color_space: "bt709",
    color_transfer: "bt709",
    color_primaries: "bt709",
    chroma_location: "left",
    ...changes
  })
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function stream(write: (consume: (chunk: Buffer) => void) => void) {
  return vi
    .spyOn(processing, "runMediaCommand")
    .mockImplementation(async (command, args, timeout, _limit, consume) => {
      expect(command).toBe("ffprobe");
      expect(args).toContain("-show_frames");
      expect(args).toContain("compact=p=0");
      expect(timeout).toBe(20_000);
      expect(consume).toBeTypeOf("function");
      write(consume!);
      return { stdout: "", stderr: "" };
    });
}

afterEach(() => vi.restoreAllMocks());

describe("bounded Bounce frame probing", () => {
  it("parses split records and a final unterminated line without changing partial VFR holds", async () => {
    const output = [frame(0, 0.1), frame(0.1, 0.2), frame(0.3, 0.7)].join("\n");
    const command = stream((consume) => {
      for (const byte of Buffer.from(output)) consume(Buffer.from([byte]));
    });
    const plan = await createBouncePlan("disposable.mp4", 150, 750, profile);
    expect(plan.sourceTimesMs).toEqual([150, 300]);
    expect(plan.durationsMs).toEqual([150, 450]);
    expect(plan.firstSourceTimeMs).toBe(100);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("discards a long decoded prefix while retaining the preceding boundary frame", async () => {
    stream((consume) => {
      for (let index = 0; index <= 10_002; index++)
        consume(Buffer.from(`${frame(index / 10)}\n`));
    });
    const plan = await createBouncePlan(
      "disposable.mp4",
      1_000_025,
      1_000_075,
      { ...profile, durationMs: 2_000_000 }
    );
    expect(plan.sourceFrameCount).toBe(1);
    expect(plan.sourceTimesMs).toEqual([1_000_025]);
    expect(plan.durationsMs).toEqual([50]);
    expect(plan.firstSourceTimeMs).toBe(1_000_000);
  });

  it.each<Record<string, string>>([
    { width: "128" },
    { height: "96" },
    { pix_fmt: "yuv444p" },
    { interlaced_frame: "1" },
    { color_range: "pc" },
    { color_space: "bt2020nc" },
    { color_transfer: "smpte2084" },
    { color_primaries: "bt2020" },
    { chroma_location: "center" },
    {
      "side_datum/mastering_display_metadata:side_data_type":
        "Mastering display metadata"
    }
  ])("rejects unsupported decoded-frame metadata %j", async (changes) => {
    stream((consume) =>
      consume(Buffer.from(`${frame(0, 0.1, changes)}\n${frame(0.1)}\n`))
    );
    await expect(
      createBouncePlan("disposable.mp4", 0, 100, profile)
    ).rejects.toMatchObject({
      code: "bounce_source_not_supported",
      status: 415
    });
  });

  it("still rejects HDR side data in a discarded preroll frame", async () => {
    stream((consume) =>
      consume(
        Buffer.from(
          `${frame(0)}\nside_data_type=HDR Dynamic Metadata SMPTE2094-40\n${frame(0.1)}\n${frame(0.3)}\n`
        )
      )
    );
    await expect(
      createBouncePlan("disposable.mp4", 150, 250, profile)
    ).rejects.toMatchObject({
      code: "bounce_source_not_supported",
      status: 415
    });
  });

  it.each([
    "oversized",
    "invalid timestamp",
    "duplicate timestamp",
    "missing timestamp"
  ])("rejects %s records", async (kind) => {
    stream((consume) =>
      consume(
        Buffer.from(
          kind === "oversized"
            ? "x".repeat(8193)
            : kind === "invalid timestamp"
              ? `${frame(NaN)}\n`
              : kind === "missing timestamp"
                ? "width=64|height=48\n"
                : `${frame(0)}\n${frame(0)}\n`
        )
      )
    );
    await expect(
      createBouncePlan("disposable.mp4", 0, 100, profile)
    ).rejects.toMatchObject({
      code: "bounce_timing_not_supported",
      status: 422
    });
  });

  it("stops retaining frames once the selected-frame budget is exceeded", async () => {
    stream((consume) => {
      for (let index = 0; index < 4001; index++)
        consume(Buffer.from(`${frame(index / 1000, 0.001)}\n`));
    });
    await expect(
      createBouncePlan("disposable.mp4", 0, 4000, {
        ...profile,
        frameRate: 1000,
        durationMs: 5000
      })
    ).rejects.toMatchObject({ code: "bounce_duration_exceeded", status: 422 });
  });
});
