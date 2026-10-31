import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bounceFrames from "../src/library/presentation-bounce-frames.js";
import {
  createBouncePlan,
  generateVideoBounce,
  inspectBounceSource,
  videoBounceEncoding,
  videoBounceFrameRate,
  videoBounceMaxDurationMs,
  videoBounceWorkingBytes,
  VIDEO_BOUNCE_MAX_DECODED_BYTES,
  VIDEO_BOUNCE_MAX_FRAMES,
  type VideoBounceProfile
} from "../src/library/presentation-bounce.js";
import { PresentationMediaError } from "../src/library/presentation-cache.js";
import { runMediaCommand } from "../src/library/video-processing.js";
import * as videoProcessing from "../src/library/video-processing.js";

let directory: string;
let sampleSequence = 0;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aether-video-bounce-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function installedFfmpeg() {
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(entry, "ffmpeg");
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false
      )
    )
      return candidate;
  }
  throw new Error("The media fixture requires an installed FFmpeg.");
}

async function fixture(
  name: string,
  rate = 24,
  duration = 1,
  filters: string[] = [],
  encoder: string[] = ["-c:v", "ffv1"],
  size = "96x64"
) {
  const file = path.join(directory, name);
  await runMediaCommand(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-threads",
      "1",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${size}:rate=${rate}:duration=${duration}`,
      ...(filters.length ? ["-vf", filters.join(",")] : []),
      "-fps_mode",
      "passthrough",
      ...encoder,
      "-threads",
      "1",
      "-y",
      file
    ],
    15_000
  );
  return file;
}
// Hash the native decoded samples; forcing a pixel format can hide range loss.
async function hashes(file: string) {
  const digestFile = `${file}.framemd5`;
  await runMediaCommand(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      "-noautorotate",
      "-i",
      file,
      "-map",
      "0:v:0",
      "-fps_mode",
      "passthrough",
      "-f",
      "framemd5",
      "-y",
      digestFile
    ],
    15_000
  );
  return (await readFile(digestFile, "utf8"))
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1)!.trim());
}

async function decodedFrames(
  file: string,
  profile: VideoBounceProfile,
  {
    plan,
    indices,
    fullResolution = false
  }: {
    plan?: Awaited<ReturnType<typeof createBouncePlan>>;
    indices?: number[];
    fullResolution?: boolean;
  } = {}
) {
  const raw = path.join(directory, `samples-${sampleSequence++}.yuv`);
  const range = profile.colorRange === "pc" ? "pc" : "tv";
  const filters = [
    ...(plan
      ? [
          `select='gte(t,${plan.firstSourceTimeMs / 1000 - 0.000001})*lt(t,${plan.endMs / 1000 - 0.0000005})'`
        ]
      : []),
    ...(indices
      ? [`select='${indices.map((index) => `eq(n,${index})`).join("+")}'`]
      : []),
    fullResolution
      ? `scale=in_range=${range}:out_range=${range}`
      : `scale=16:16:flags=area:in_range=${range}:out_range=${range}`,
    "format=yuv420p16le"
  ];
  try {
    await runMediaCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-threads",
        "1",
        "-noautorotate",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-filter_threads",
        "1",
        "-vf",
        filters.join(","),
        "-fps_mode",
        "passthrough",
        "-threads",
        "1",
        "-f",
        "rawvideo",
        "-y",
        raw
      ],
      20_000
    );
    const bytes = await readFile(raw);
    const frameBytes = fullResolution
      ? profile.width * profile.height * 3
      : 16 * 16 * 3;
    expect(bytes.length % frameBytes).toBe(0);
    return Array.from({ length: bytes.length / frameBytes }, (_, index) =>
      bytes.subarray(index * frameBytes, (index + 1) * frameBytes)
    );
  } finally {
    await rm(raw, { force: true });
  }
}

function frameFidelity(actual: Buffer, expected: Buffer) {
  expect(actual.length).toBe(expected.length);
  let absolute = 0;
  let squared = 0;
  for (let index = 0; index < actual.length; index += 2) {
    const difference =
      actual.readUInt16LE(index) - expected.readUInt16LE(index);
    absolute += Math.abs(difference);
    squared += difference ** 2;
  }
  const samples = actual.length / 2;
  return {
    normalizedMae: absolute / samples / 65535,
    psnr:
      squared === 0
        ? Infinity
        : 10 * Math.log10(65535 ** 2 / (squared / samples))
  };
}

async function verifyBoth(
  file: string,
  startMs: number,
  endMs: number,
  profile: VideoBounceProfile,
  selectedHashes: string[],
  observeOutput?: (output: string, codec: "hevc" | "h264") => Promise<void>,
  minimumPsnr = 30
) {
  const plan = await createBouncePlan(file, startMs, endMs, profile);
  expect(plan.sourceFrameCount).toBe(selectedHashes.length);
  const sourceIndices = selectedHashes.map((_hash, index) => index);
  expect(plan.outputSourceIndices).toEqual([
    ...sourceIndices,
    ...sourceIndices.slice(1, -1).reverse()
  ]);
  const reference = await decodedFrames(file, profile, { plan });
  expect(reference).toHaveLength(selectedHashes.length);
  const outputSamples = Array.from(
    new Set([0, plan.sourceFrameCount - 1, plan.outputSourceIndices.length - 1])
  ).sort((left, right) => left - right);
  const sourceSamples = Array.from(
    new Set(outputSamples.map((index) => plan.outputSourceIndices[index]!))
  ).sort((left, right) => left - right);
  const fullReference = await decodedFrames(file, profile, {
    plan,
    indices: sourceSamples,
    fullResolution: true
  });
  for (const codec of ["hevc", "h264"] as const) {
    const output = path.join(directory, `${codec}-${startMs}.mp4`);
    await generateVideoBounce(file, output, plan, profile, codec);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".bounce-work-")
      )
    ).toEqual([]);
    const actual = await decodedFrames(output, profile);
    expect(actual).toHaveLength(plan.outputSourceIndices.length);
    for (const [index, frame] of actual.entries())
      expect(
        frameFidelity(frame, reference[plan.outputSourceIndices[index]!]!)
          .normalizedMae
      ).toBeLessThan(0.02);
    const fullActual = await decodedFrames(output, profile, {
      indices: outputSamples,
      fullResolution: true
    });
    expect(fullActual).toHaveLength(outputSamples.length);
    for (const [index, frame] of fullActual.entries()) {
      const sourceIndex = plan.outputSourceIndices[outputSamples[index]!]!;
      const fidelity = frameFidelity(
        frame,
        fullReference[sourceSamples.indexOf(sourceIndex)]!
      );
      expect(fidelity.normalizedMae).toBeLessThan(0.025);
      expect(fidelity.psnr, `${codec} full-resolution PSNR`).toBeGreaterThan(
        minimumPsnr
      );
    }
    await observeOutput?.(output, codec);
  }
  return plan;
}

async function packetTimeline(file: string) {
  const result = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_packets",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      file
    ],
    15_000,
    1024 * 1024
  );
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [time, duration] = line.split(",").map(Number);
      return { timeMs: time! * 1000, durationMs: duration! * 1000 };
    });
}

async function verifyPlaybackLevel(file: string, codec: "hevc" | "h264") {
  const result = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=level",
      "-of",
      "json",
      file
    ],
    5000
  );
  const { streams } = JSON.parse(result.stdout) as {
    streams: Array<{ level: number }>;
  };
  expect(streams[0]!.level).toBeGreaterThan(0);
  expect(streams[0]!.level).toBeLessThanOrEqual(codec === "hevc" ? 153 : 42);
}

describe("original-resolution video Bounce", () => {
  it.each([
    [[0, 100, 116.667, 133.334], 0, 5, 1000 / 16.667],
    [[99.999, 100], 0, 10, 10],
    [[99.999], 0, 10, 10],
    [[100, 200, 300], 100, 120, 10]
  ] as const)(
    "uses original selected cadence for %j without clipped-boundary FPS spikes",
    (times, firstSourceTimeMs, sourceFrameRate, expected) => {
      expect(
        videoBounceFrameRate(
          { sourceTimesMs: [...times], firstSourceTimeMs },
          sourceFrameRate
        )
      ).toBeCloseTo(expected, 8);
    }
  );

  it.each([
    [96, 64, 24, 2_000_000, 2_000_000],
    [1920, 1080, 30, 12_000_000, 16_000_000],
    [1920, 1080, 60, 24_000_000, 32_000_000],
    [3840, 2160, 30, 24_000_000, 32_000_000],
    [3840, 2160, 60, 48_000_000, 64_000_000],
    [3840, 2160, 240, 96_000_000, 96_000_000]
  ])(
    "bounds the playback rate envelope for %ix%i at %ifps",
    (width, height, frameRate, hevcRate, h264Rate) => {
      const profile = { width, height, frameRate, bitDepth: 10 as const };
      expect(videoBounceEncoding(profile, "hevc")).toEqual({
        pixelFormat: "yuv420p10le",
        profile: "main10",
        maximumRate: hevcRate,
        bufferSize: hevcRate! * 2
      });
      expect(videoBounceEncoding(profile, "h264")).toEqual({
        pixelFormat: "yuv420p",
        profile: "high",
        maximumRate: h264Rate,
        bufferSize: h264Rate! * 2
      });
      expect(
        videoBounceEncoding({ ...profile, bitDepth: 8 }, "hevc")
      ).toMatchObject({ pixelFormat: "yuv420p", profile: "main" });
    }
  );

  it.each([
    { width: 95 },
    { height: 0 },
    { frameRate: 0 },
    { frameRate: Infinity }
  ])("rejects an invalid playback envelope %j", (invalid) => {
    expect(() =>
      videoBounceEncoding(
        { width: 96, height: 64, frameRate: 24, bitDepth: 8, ...invalid },
        "hevc"
      )
    ).toThrow(PresentationMediaError);
  });

  it("keeps distinctly colored frames in forward and reverse order", async () => {
    const file = await fixture("ordered.mkv", 4, 1, [
      "geq=lum='32+48*N':cb='64+16*N':cr='192-16*N'"
    ]);
    const profile = await inspectBounceSource(file);
    const plan = await verifyBoth(file, 0, 1000, profile, await hashes(file));
    expect(plan.outputSourceIndices).toEqual([0, 1, 2, 3, 2, 1]);
  });

  it("sizes playback for a dense highlight in a low-average-rate recording", async () => {
    const file = await fixture(
      "variable-density.mp4",
      60,
      1,
      ["settb=1/1000000", "setpts='if(eq(N,0),0,20000000+(N-1)*1000000/60)'"],
      [
        "-c:v",
        "libx264",
        "-bf",
        "0",
        "-enc_time_base",
        "1/1000000",
        "-bsf:v",
        "setts=duration=16667"
      ],
      "1280x720"
    );
    const profile = await inspectBounceSource(file);
    expect(profile.frameRate).toBeLessThan(5);
    const original = await hashes(file);
    const plan = await createBouncePlan(file, 20_000, 20_500, profile);
    await verifyBoth(
      file,
      20_000,
      20_500,
      profile,
      original.slice(1, 31),
      async (output, codec) => {
        const result = await runMediaCommand(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=level,r_frame_rate",
            "-of",
            "json",
            output
          ],
          5000
        );
        const { streams } = JSON.parse(result.stdout) as {
          streams: Array<{ level: number; r_frame_rate: string }>;
        };
        expect(streams[0]!.level).toBeGreaterThanOrEqual(
          codec === "hevc" ? 120 : 32
        );
        const [numerator, denominator] = streams[0]!.r_frame_rate
          .split("/")
          .map(Number);
        expect(numerator! / denominator!).toBeCloseTo(60, 1);
        const packets = await packetTimeline(output);
        packets.forEach((packet, index) => {
          expect(packet.timeMs).toBeCloseTo(plan.outputTimesMs[index]!, 3);
        });
      }
    );
    expect(videoBounceFrameRate(plan, profile.frameRate)).toBeCloseTo(60, 1);
  }, 30_000);

  it("keeps high-detail 1080p output within its playback envelope with high decoded fidelity", async () => {
    const file = await fixture(
      "detail.mkv",
      30,
      1,
      ["noise=alls=8:allf=t"],
      ["-c:v", "ffv1"],
      "1920x1080"
    );
    const source = await readFile(file);
    const profile = await inspectBounceSource(file);
    const plan = await createBouncePlan(file, 0, 1000, profile);
    await verifyBoth(
      file,
      0,
      1000,
      profile,
      await hashes(file),
      async (output, codec) => {
        const encoding = videoBounceEncoding(profile, codec);
        const bytes = (await stat(output)).size;
        const envelope =
          (encoding.maximumRate * (plan.outputDurationMs / 1000) +
            encoding.bufferSize) /
            8 +
          64 * 1024;
        expect(bytes).toBeLessThan(envelope);
      },
      34
    );
    expect((await readFile(file)).equals(source)).toBe(true);
  }, 60_000);

  it.each([
    ["hevc", "libx265", "bounce_hevc_encoder_unavailable"],
    ["h264", "libx264", "bounce_h264_encoder_unavailable"]
  ] as const)(
    "sanitizes a missing %s encoder and cleans its decoded work",
    async (codec, encoder, code) => {
      const file = await fixture("dependency.mkv");
      const source = await readFile(file);
      const profile = await inspectBounceSource(file);
      const plan = await createBouncePlan(file, 0, 500, profile);
      const realFfmpeg = await installedFfmpeg();
      const tools = path.join(directory, "tools");
      await mkdir(tools);
      await writeFile(
        path.join(tools, "ffmpeg"),
        `#!/bin/sh
for argument do
  if [ "$argument" = "${encoder}" ]; then
    printf '%s\\n' "Unknown encoder '${encoder}'" '/private/source.mov' >&2
    exit 1
  fi
done
exec "$AETHER_TEST_FFMPEG" "$@"
`,
        { mode: 0o700 }
      );
      vi.stubEnv("AETHER_TEST_FFMPEG", realFfmpeg);
      vi.stubEnv("PATH", `${tools}${path.delimiter}${process.env.PATH ?? ""}`);
      const output = path.join(directory, "dependency.mp4");
      await expect(
        generateVideoBounce(file, output, plan, profile, codec)
      ).rejects.toMatchObject({
        code,
        status: 503,
        message: code
      });
      expect(
        (await readdir(directory)).filter((name) =>
          name.startsWith(".bounce-work-")
        )
      ).toEqual([]);
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(file)).toEqual(source);
    }
  );

  it("reports an unavailable FFmpeg without retaining private work or changing the source", async () => {
    const file = await fixture("missing-tool.mkv");
    const source = await readFile(file);
    const profile = await inspectBounceSource(file);
    const plan = await createBouncePlan(file, 0, 500, profile);
    const tools = path.join(directory, "empty-tools");
    await mkdir(tools);
    vi.stubEnv("PATH", tools);
    const output = path.join(directory, "missing-tool.mp4");
    await expect(
      generateVideoBounce(file, output, plan, profile)
    ).rejects.toMatchObject({
      code: "media_tool_unavailable",
      status: 503,
      message: "media_tool_unavailable"
    });
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".bounce-work-")
      )
    ).toEqual([]);
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(file)).toEqual(source);
  });

  it("accepts a thirty-second section and rejects a longer requested range", async () => {
    const file = await fixture("thirty-seconds.mkv", 1, 31);
    const profile = await inspectBounceSource(file);
    const plan = await verifyBoth(
      file,
      0,
      30_000,
      profile,
      (await hashes(file)).slice(0, 30)
    );
    expect(plan.sourceFrameCount).toBe(30);
    expect(plan.outputDurationMs).toBe(58_000);
    await expect(
      createBouncePlan(file, 0, 30_001, profile)
    ).rejects.toMatchObject({ code: "bounce_duration_exceeded", status: 422 });
  });
  it("bounds peak frame memory independently of section duration", () => {
    expect(videoBounceMaxDurationMs(96, 64)).toBe(30_000);
    expect(videoBounceMaxDurationMs(96, 64, 120)).toBe(30_000);
    expect(videoBounceMaxDurationMs(96, 64, 240)).toBe(15_000);
    expect(videoBounceMaxDurationMs(3840, 2160, 60, 8)).toBe(30_000);
    expect(videoBounceMaxDurationMs(3840, 2160, 60, 10)).toBe(30_000);
    expect(videoBounceWorkingBytes(3840, 2160, 10)).toBe(3840 * 2160 * 3 * 4);
    expect(videoBounceMaxDurationMs(7680, 4320, 24, 10)).toBe(0);
    for (const dimensions of [
      [0, 32],
      [95, 64],
      [96, 63],
      [Infinity, 64]
    ])
      expect(videoBounceMaxDurationMs(dimensions[0]!, dimensions[1]!)).toBe(0);
  });

  for (const [size, duration, expectedFrames] of [
    ["1920x1080", 4, 96],
    ["3840x2160", 1, 24]
  ] as const) {
    it(`retains ${size} resolution and high visual fidelity across disk-backed boundaries beyond the old complete-section memory budget`, async () => {
      const file = await fixture(
        `large-${size}.mkv`,
        24,
        duration,
        [],
        ["-c:v", "ffv1"],
        size
      );
      const profile = await inspectBounceSource(file);
      const original = await hashes(file);
      expect(original).toHaveLength(expectedFrames);
      expect(
        expectedFrames * profile.width * profile.height * 1.5
      ).toBeGreaterThan(256 * 1024 * 1024);
      const plan = await verifyBoth(
        file,
        0,
        duration * 1000,
        profile,
        original
      );
      expect(plan.sourceFrameCount).toBe(expectedFrames);
      expect(plan.outputSourceIndices).toHaveLength(expectedFrames * 2 - 2);
      expect(plan.decodedBytes).toBe(
        videoBounceWorkingBytes(profile.width, profile.height, profile.bitDepth)
      );
      expect(plan.decodedBytes).toBeLessThanOrEqual(
        VIDEO_BOUNCE_MAX_DECODED_BYTES
      );
      expect(profile).toMatchObject({
        width: Number(size.split("x")[0]),
        height: Number(size.split("x")[1])
      });
    }, 60_000);
  }

  it("retains 60fps source frames and timing in both playback codecs", async () => {
    const file = await fixture("sixty.mkv", 60);
    const profile = await inspectBounceSource(file);
    expect(profile).toMatchObject({
      width: 96,
      height: 64,
      bitDepth: 8,
      frameRate: 60
    });
    const original = await hashes(file);
    const plan = await verifyBoth(file, 0, 1000, profile, original);
    expect(plan.sourceFrameCount).toBe(60);
    expect(plan.outputSourceIndices).toHaveLength(118);
    expect(plan.outputTimesMs[1]).toBeCloseTo(17, 2);
    expect(plan.decodedBytes).toBeLessThanOrEqual(
      VIDEO_BOUNCE_MAX_DECODED_BYTES
    );
  });

  for (const fullRange of [false, true]) {
    it(`includes delayed B-frames at a non-EOF range boundary${fullRange ? " in full-range MOV" : ""}`, async () => {
      const file = await fixture(
        fullRange ? "full-range.MOV" : "bframes.mp4",
        24,
        5,
        [],
        [
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-bf",
          "3",
          ...(fullRange ? ["-color_range", "pc"] : [])
        ]
      );
      const profile = await inspectBounceSource(file);
      if (fullRange)
        expect(profile).toMatchObject({
          pixelFormat: "yuv420p",
          bitDepth: 8,
          colorRange: "pc"
        });
      const original = await hashes(file);
      const plan = await verifyBoth(
        file,
        250,
        750,
        profile,
        original.slice(6, 18),
        async (output) => {
          if (fullRange) {
            const result = await inspectBounceSource(output);
            expect(result).toMatchObject({
              pixelFormat: "yuv420p",
              bitDepth: 8,
              colorRange: "pc"
            });
          }
        }
      );
      expect(plan.sourceFrameCount).toBe(12);
      expect(plan.outputSourceIndices).toHaveLength(22);
      expect(plan.sourceTimesMs[0]).toBe(250);
      expect(plan.sourceTimesMs.at(-1)).toBeCloseTo(708.333, 3);
    });
  }

  it("supports the 600 source-frame and 1198 output-frame boundary within command output limits", async () => {
    const file = await fixture("boundary.mkv", 60, 10);
    const profile = await inspectBounceSource(file);
    const plan = await verifyBoth(
      file,
      0,
      10_000,
      profile,
      await hashes(file),
      verifyPlaybackLevel
    );
    expect(plan.sourceFrameCount).toBe(600);
    expect(plan.outputSourceIndices).toHaveLength(1198);
  }, 15_000);

  it("preserves all 3600 source frames and 7198 output packet times without oversized arguments", async () => {
    const file = await fixture(
      "maximum-frames.mkv",
      120,
      30,
      [],
      ["-c:v", "ffv1"],
      "48x32"
    );
    const profile = await inspectBounceSource(file);
    const plan = await createBouncePlan(file, 0, 30_000, profile);
    expect(plan.sourceFrameCount).toBe(VIDEO_BOUNCE_MAX_FRAMES);
    expect(plan.outputSourceIndices).toHaveLength(7198);
    await verifyBoth(
      file,
      0,
      30_000,
      profile,
      await hashes(file),
      async (output) => {
        const packets = await packetTimeline(output);
        expect(packets).toHaveLength(7198);
        packets.forEach((packet, index) => {
          expect(packet.timeMs).toBeCloseTo(plan.outputTimesMs[index]!, 3);
          expect(packet.durationMs).toBeCloseTo(
            plan.durationsMs[plan.outputSourceIndices[index]!]!,
            3
          );
        });
      }
    );
  }, 30_000);

  for (const fullRange of [false, true]) {
    it(`preserves variable frame durations and partial boundary holds${fullRange ? " in full-range MOV" : ""}`, async () => {
      // Explicit MP4 sample durations keep the final 100 ms hold unambiguous.
      const file = await fixture(
        fullRange ? "variable-full-range.mov" : "variable.mp4",
        10,
        0.4,
        [
          "settb=1/1000000",
          "setpts='if(lt(N,2),if(lt(N,1),0,100000),if(lt(N,3),300000,700000))'"
        ],
        [
          "-c:v",
          "libx264",
          "-bf",
          "0",
          "-enc_time_base",
          "1/1000000",
          "-bsf:v",
          "setts=duration=100000",
          ...(fullRange ? ["-color_range", "pc"] : [])
        ]
      );
      const profile = await inspectBounceSource(file);
      expect(profile.durationMs).toBe(800);
      const original = await hashes(file);
      const full = await verifyBoth(
        file,
        0,
        800,
        profile,
        original,
        async (output, codec) => {
          await verifyPlaybackLevel(output, codec);
          expect(await packetTimeline(output)).toEqual([
            { timeMs: 0, durationMs: 100 },
            { timeMs: 100, durationMs: 200 },
            { timeMs: 300, durationMs: 400 },
            { timeMs: 700, durationMs: 100 },
            { timeMs: 800, durationMs: 400 },
            { timeMs: 1200, durationMs: 200 }
          ]);
        }
      );
      expect(full.sourceTimesMs).toEqual([0, 100, 300, 700]);
      expect(full.durationsMs).toEqual([100, 200, 400, 100]);
      expect(full.outputTimesMs).toEqual([0, 100, 300, 700, 800, 1200]);
      expect(full.outputDurationMs).toBe(1400);
      const partial = await verifyBoth(
        file,
        150,
        750,
        profile,
        original.slice(1),
        async (output, codec) => {
          await verifyPlaybackLevel(output, codec);
          expect(await packetTimeline(output)).toEqual([
            { timeMs: 0, durationMs: 150 },
            { timeMs: 150, durationMs: 400 },
            { timeMs: 550, durationMs: 50 },
            { timeMs: 600, durationMs: 400 }
          ]);
        }
      );
      expect(partial.sourceTimesMs).toEqual([150, 300, 700]);
      expect(partial.durationsMs).toEqual([150, 400, 50]);
      expect(partial.outputTimesMs).toEqual([0, 150, 550, 600]);
      expect(partial.outputDurationMs).toBe(1000);
    });
  }

  for (const [format, range] of [
    ["yuvj420p", "tv"],
    ["yuvj420p", "unknown"],
    ["yuvj420p", undefined],
    ["yuvj420p", "invalid"],
    ["yuv420p", "invalid"]
  ] as const) {
    it(`rejects contradictory or invalid source range ${format}/${range ?? "missing"}`, async () => {
      const file = await fixture(
        "range.mov",
        24,
        0.5,
        [],
        ["-c:v", "libx264", "-color_range", "pc"]
      );
      const result = await runMediaCommand(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        10_000
      );
      const metadata = JSON.parse(result.stdout) as {
        streams: Array<Record<string, unknown>>;
      };
      metadata.streams[0] = {
        ...metadata.streams[0],
        pix_fmt: format,
        color_range: range
      };
      vi.spyOn(videoProcessing, "runMediaCommand").mockResolvedValueOnce({
        ...result,
        stdout: JSON.stringify(metadata)
      });
      await expect(inspectBounceSource(file)).rejects.toMatchObject({
        code: "bounce_source_not_supported",
        status: 415
      });
    });
  }

  it("rejects a contradictory full-range frame before decoding a section", async () => {
    const file = await fixture(
      "frame-range.mov",
      24,
      0.5,
      [],
      ["-c:v", "libx264", "-color_range", "pc"]
    );
    const profile = await inspectBounceSource(file);
    // A stream declaration must agree with actual decoded full-range samples.
    await expect(
      createBouncePlan(file, 0, 500, { ...profile, colorRange: "tv" })
    ).rejects.toMatchObject({
      code: "bounce_source_not_supported",
      status: 415
    });
  });

  it("rejects a changed output range and removes the incomplete full-range rendition", async () => {
    const file = await fixture(
      "output-range.mov",
      24,
      0.5,
      [],
      ["-c:v", "libx264", "-color_range", "pc"]
    );
    const profile = await inspectBounceSource(file);
    const plan = await createBouncePlan(file, 0, 500, profile);
    const output = path.join(directory, "wrong-range.mp4");
    const originalRun = videoProcessing.runMediaCommand;
    vi.spyOn(videoProcessing, "runMediaCommand").mockImplementation(
      async (command, args, ...limits) => {
        const result = await originalRun(command, args, ...limits);
        if (command !== "ffprobe" || !args.includes("-show_packets"))
          return result;
        const metadata = JSON.parse(result.stdout) as {
          streams: Array<Record<string, unknown>>;
        };
        metadata.streams[0] = { ...metadata.streams[0], color_range: "tv" };
        return { ...result, stdout: JSON.stringify(metadata) };
      }
    );
    await expect(
      generateVideoBounce(file, output, plan, profile)
    ).rejects.toMatchObject({ code: "incomplete_rendition", status: 422 });
    expect(await readdir(directory)).toEqual(["output-range.mov"]);
  });

  it.each([
    ["hevc", 255],
    ["h264", 99],
    ["hevc", -99],
    ["h264", -99]
  ] as const)(
    "rejects unsupported %s playback level %i and removes the rendition",
    async (codec, level) => {
      const file = await fixture("output-level.mkv", 24, 0.5);
      const profile = await inspectBounceSource(file);
      const plan = await createBouncePlan(file, 0, 500, profile);
      const output = path.join(directory, "wrong-level.mp4");
      const originalRun = videoProcessing.runMediaCommand;
      vi.spyOn(videoProcessing, "runMediaCommand").mockImplementation(
        async (command, args, ...limits) => {
          const result = await originalRun(command, args, ...limits);
          if (command !== "ffprobe" || !args.includes("-show_packets"))
            return result;
          const metadata = JSON.parse(result.stdout) as {
            streams: Array<Record<string, unknown>>;
          };
          metadata.streams[0] = { ...metadata.streams[0], level };
          return { ...result, stdout: JSON.stringify(metadata) };
        }
      );
      await expect(
        generateVideoBounce(file, output, plan, profile, codec)
      ).rejects.toMatchObject({ code: "incomplete_rendition", status: 422 });
      expect(await readdir(directory)).toEqual(["output-level.mkv"]);
    }
  );

  it("retains original dimensions, exact SAR, SDR color and rotation across 10-bit HEVC and 8-bit H264", async () => {
    const original = await fixture(
      "ten-bit.mp4",
      24,
      0.5,
      [
        "format=yuv420p10le",
        "setsar=121/120:max=65535",
        "setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709"
      ],
      [
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-x265-params",
        "lossless=1:pools=1:frame-threads=1:log-level=error"
      ]
    );
    const file = path.join(directory, "rotated.mov");
    await runMediaCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        original,
        "-c",
        "copy",
        "-metadata:s:v:0",
        "rotate=90",
        "-y",
        file
      ],
      10_000
    );
    const rotatedBytes = await readFile(file);
    const header = rotatedBytes.indexOf(Buffer.from("tkhd"));
    const matrix = header + (rotatedBytes[header + 4] === 1 ? 56 : 44);
    [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824].forEach((value, index) =>
      rotatedBytes.writeInt32BE(value, matrix + index * 4)
    );
    await writeFile(file, rotatedBytes);
    const profile = await inspectBounceSource(file);
    expect(profile).toMatchObject({
      width: 96,
      height: 64,
      bitDepth: 10,
      sampleAspectRatio: "121:120",
      rotation: -90,
      colorTransfer: "bt709"
    });
    await verifyBoth(file, 0, 500, profile, await hashes(file));
  });

  it("keeps full-range SDR appearance and transfer metadata with 10-bit HEVC and compatible H264", async () => {
    const file = await fixture(
      "full-range-ten-bit.mov",
      24,
      0.5,
      [
        "format=yuv420p10le",
        "setparams=range=pc:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709"
      ],
      [
        "-c:v",
        "libx265",
        "-color_range",
        "pc",
        "-x265-params",
        "lossless=1:pools=1:frame-threads=1:log-level=error"
      ]
    );
    const profile = await inspectBounceSource(file);
    expect(profile).toMatchObject({
      pixelFormat: "yuv420p10le",
      bitDepth: 10,
      colorRange: "pc",
      colorTransfer: "iec61966-2-1"
    });
    await verifyBoth(file, 0, 500, profile, await hashes(file));
  });

  it("rejects HDR, odd coded geometry, and reflected or sheared display matrices explicitly", async () => {
    const hdr = await fixture("hdr.mkv", 24, 0.2, [
      "format=yuv420p10le",
      "setparams=range=limited:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc"
    ]);
    await expect(inspectBounceSource(hdr)).rejects.toMatchObject({
      code: "bounce_source_not_supported",
      status: 415
    });
    const odd = await fixture("odd.mkv", 24, 0.2, ["crop=95:63:exact=1"]);
    await expect(inspectBounceSource(odd)).rejects.toMatchObject({
      code: "bounce_source_not_supported"
    });
    const original = await fixture(
      "base.mp4",
      24,
      0.5,
      [],
      ["-c:v", "libx264"]
    );
    const reflected = path.join(directory, "reflected.mov");
    await runMediaCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        original,
        "-c",
        "copy",
        "-metadata:s:v:0",
        "rotate=90",
        "-y",
        reflected
      ],
      10_000
    );
    const bytes = await readFile(reflected);
    const header = bytes.indexOf(Buffer.from("tkhd"));
    expect(header).toBeGreaterThan(0);
    const matrix = header + (bytes[header + 4] === 1 ? 56 : 44);
    bytes.writeInt32BE(-65536, matrix);
    bytes.writeInt32BE(0, matrix + 4);
    bytes.writeInt32BE(0, matrix + 12);
    bytes.writeInt32BE(65536, matrix + 16);
    await writeFile(reflected, bytes);
    await expect(inspectBounceSource(reflected)).rejects.toMatchObject({
      code: "bounce_source_not_supported"
    });
    const sheared = path.join(directory, "sheared.mov");
    [65536, 0, 0, 65536, 65536, 0, 0, 0, 1073741824].forEach((value, index) =>
      bytes.writeInt32BE(value, matrix + index * 4)
    );
    await writeFile(sheared, bytes);
    await expect(inspectBounceSource(sheared)).rejects.toMatchObject({
      code: "bounce_source_not_supported"
    });
  });

  it("rejects interlacing and excessive actual frame counts", async () => {
    const interlaced = await fixture("interlaced.mkv", 24, 0.5, [
      "setfield=tff"
    ]);
    await expect(
      (async () => {
        const profile = await inspectBounceSource(interlaced);
        return createBouncePlan(interlaced, 0, 500, profile);
      })()
    ).rejects.toMatchObject({ code: "bounce_source_not_supported" });
    const file = await fixture(
      "fast.mp4",
      121,
      30,
      [],
      [
        "-c:v",
        "libx264",
        "-bf",
        "0",
        "-enc_time_base",
        "1:1000000",
        "-video_track_timescale",
        "1000000"
      ],
      "48x32"
    );
    const profile = await inspectBounceSource(file);
    // A nominal rate can understate the actual selected frame count.
    await expect(
      createBouncePlan(file, 0, 29_900, { ...profile, frameRate: 120 })
    ).rejects.toMatchObject({ code: "bounce_duration_exceeded" });
  });

  for (const [name, options] of [
    ["compressed spool budget", { maxWorkBytes: 1 }],
    ["encoded output budget", { maxOutputBytes: 1 }],
    ["processing deadline", { timeoutMs: 1 }]
  ] as const) {
    it(`removes its private work and incomplete output after exceeding the ${name}`, async () => {
      const file = await fixture("bounded.mkv", 24, 0.5);
      const profile = await inspectBounceSource(file);
      const original = await readFile(file);
      const plan = await createBouncePlan(file, 0, 500, profile);
      const output = path.join(directory, "bounded.mp4");
      await expect(
        generateVideoBounce(file, output, plan, profile, "hevc", options)
      ).rejects.toMatchObject({
        code: "presentation_limit_exceeded",
        status: 422
      });
      expect(await readdir(directory)).toEqual(["bounded.mkv"]);
      expect(await readFile(file)).toEqual(original);
    });
  }

  it("keeps its processing deadline when the system clock moves backward", async () => {
    const file = await fixture("clock.mkv", 24, 0.5);
    const profile = await inspectBounceSource(file);
    const plan = await createBouncePlan(file, 0, 500, profile);
    const wallClock = Date.now();
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(wallClock)
      .mockReturnValue(wallClock - 3_600_000);
    try {
      await expect(
        generateVideoBounce(
          file,
          path.join(directory, "clock.mp4"),
          plan,
          profile,
          "hevc",
          { timeoutMs: 1 }
        )
      ).rejects.toMatchObject({ code: "presentation_limit_exceeded" });
      expect(await readdir(directory)).toEqual(["clock.mkv"]);
    } finally {
      clock.mockRestore();
    }
  });

  it("cleans up when the source decoder fails after planning", async () => {
    const file = await fixture("broken.mkv", 24, 0.5);
    const profile = await inspectBounceSource(file);
    const plan = await createBouncePlan(file, 0, 500, profile);
    await writeFile(file, "invalid disposable source");
    await expect(
      generateVideoBounce(
        file,
        path.join(directory, "broken.mp4"),
        plan,
        profile
      )
    ).rejects.toMatchObject({
      code: "presentation_processing_failed",
      status: 422
    });
    expect(await readdir(directory)).toEqual(["broken.mkv"]);
  });

  it("removes a completed frame spool and partial output when the encoder fails", async () => {
    const file = await fixture("encoder-failure.mkv", 24, 0.5);
    const profile = await inspectBounceSource(file);
    const original = await readFile(file);
    const plan = await createBouncePlan(file, 0, 500, profile);
    const output = path.join(directory, "encoder-failure.mp4");
    const encode = vi
      .spyOn(bounceFrames, "encodeBounceFrames")
      .mockImplementationOnce(async () => {
        const work = (await readdir(directory)).filter((name) =>
          name.startsWith(".bounce-work-")
        );
        expect(work).toHaveLength(1);
        expect(
          (await stat(path.join(directory, work[0]!, "frames.deflate"))).size
        ).toBeGreaterThan(0);
        await writeFile(output, "incomplete encoded output");
        throw new PresentationMediaError("presentation_processing_failed", 422);
      });
    await expect(
      generateVideoBounce(file, output, plan, profile)
    ).rejects.toMatchObject({
      code: "presentation_processing_failed",
      status: 422
    });
    expect(encode).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toEqual(["encoder-failure.mkv"]);
    expect(await readFile(file)).toEqual(original);
  });

  it("cancels an active encoder and removes output and compressed frame work", async () => {
    const file = await fixture(
      "cancel.mkv",
      24,
      2,
      [],
      ["-c:v", "ffv1"],
      "960x540"
    );
    const profile = await inspectBounceSource(file);
    const original = await readFile(file);
    const plan = await createBouncePlan(file, 0, 2000, profile);
    const output = path.join(directory, "cancel.mp4");
    const controller = new AbortController();
    let encoderStarted = false;
    const monitor = setInterval(() => {
      void stat(output).then(
        () => {
          encoderStarted = true;
          controller.abort();
        },
        () => undefined
      );
    }, 5);
    try {
      await expect(
        generateVideoBounce(file, output, plan, profile, "hevc", {
          signal: controller.signal
        })
      ).rejects.toMatchObject({
        code: "presentation_processing_cancelled",
        status: 499
      });
      expect(encoderStarted).toBe(true);
      expect(await readdir(directory)).toEqual(["cancel.mkv"]);
      expect(await readFile(file)).toEqual(original);
    } finally {
      clearInterval(monitor);
      controller.abort();
    }
  }, 15_000);

  it("rejects nonzero timestamp origins rather than shifting browser source times", async () => {
    const file = await fixture(
      "offset.mp4",
      24,
      0.5,
      [],
      ["-c:v", "libx264", "-output_ts_offset", "5"]
    );
    await expect(inspectBounceSource(file)).rejects.toMatchObject({
      code: "bounce_source_not_supported",
      status: 415
    });
  });
});
