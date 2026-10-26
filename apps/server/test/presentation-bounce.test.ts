import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBouncePlan,
  generateLosslessBounce,
  inspectBounceSource,
  videoBounceMaxDurationMs,
  VIDEO_BOUNCE_MAX_DECODED_BYTES,
  type VideoBounceProfile
} from "../src/library/presentation-bounce.js";
import { runMediaCommand } from "../src/library/video-processing.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aether-lossless-bounce-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function fixture(
  name: string,
  rate = 24,
  duration = 1,
  filters: string[] = [],
  encoder: string[] = ["-c:v", "ffv1"]
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
      `testsrc2=size=96x64:rate=${rate}:duration=${duration}`,
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
async function hashes(file: string, profile: VideoBounceProfile) {
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
      "-pix_fmt",
      profile.pixelFormat,
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
async function verifyBoth(
  file: string,
  startMs: number,
  endMs: number,
  profile: VideoBounceProfile,
  selectedHashes: string[]
) {
  const plan = await createBouncePlan(file, startMs, endMs, profile);
  for (const codec of ["hevc", "h264"] as const) {
    const output = path.join(directory, `${codec}-${startMs}.mp4`);
    await generateLosslessBounce(file, output, plan, profile, codec);
    expect(await hashes(output, profile)).toEqual(
      plan.outputSourceIndices.map((index) => selectedHashes[index])
    );
  }
  return plan;
}

describe("lossless native Bounce", () => {
  it("reserves bounded reverse memory at the actual frame rate and bit depth", () => {
    expect(videoBounceMaxDurationMs(96, 64)).toBe(10_000);
    expect(videoBounceMaxDurationMs(96, 64, 120)).toBe(5000);
    expect(videoBounceMaxDurationMs(1920, 1080, 60, 10)).toBeLessThan(
      videoBounceMaxDurationMs(1920, 1080, 60, 8)
    );
    for (const dimensions of [
      [0, 32],
      [95, 64],
      [96, 63],
      [Infinity, 64]
    ])
      expect(videoBounceMaxDurationMs(dimensions[0]!, dimensions[1]!)).toBe(0);
  });

  it("retains 60fps source frames and timing in both lossless codecs", async () => {
    const file = await fixture("sixty.mkv", 60);
    const profile = await inspectBounceSource(file);
    expect(profile).toMatchObject({
      width: 96,
      height: 64,
      bitDepth: 8,
      frameRate: 60
    });
    const original = await hashes(file, profile);
    const plan = await verifyBoth(file, 0, 1000, profile, original);
    expect(plan.sourceFrameCount).toBe(60);
    expect(plan.outputSourceIndices).toHaveLength(118);
    expect(plan.outputTimesMs[1]).toBeCloseTo(17, 2);
    expect(plan.decodedBytes).toBeLessThanOrEqual(
      VIDEO_BOUNCE_MAX_DECODED_BYTES
    );
  });

  it("includes delayed B-frames at a non-EOF range boundary", async () => {
    const file = await fixture(
      "bframes.mp4",
      24,
      5,
      [],
      ["-c:v", "libx264", "-preset", "medium", "-bf", "3"]
    );
    const profile = await inspectBounceSource(file);
    const original = await hashes(file, profile);
    const plan = await verifyBoth(
      file,
      250,
      750,
      profile,
      original.slice(6, 18)
    );
    expect(plan.sourceFrameCount).toBe(12);
    expect(plan.outputSourceIndices).toHaveLength(22);
    expect(plan.sourceTimesMs[0]).toBe(250);
    expect(plan.sourceTimesMs.at(-1)).toBeCloseTo(708.333, 3);
  });

  it("supports the 600 source-frame and 1198 output-frame boundary within command output limits", async () => {
    const file = await fixture("boundary.mkv", 60, 10);
    const profile = await inspectBounceSource(file);
    const plan = await verifyBoth(
      file,
      0,
      10_000,
      profile,
      await hashes(file, profile)
    );
    expect(plan.sourceFrameCount).toBe(600);
    expect(plan.outputSourceIndices).toHaveLength(1198);
  }, 15_000);

  it("preserves variable frame durations and partial boundary holds", async () => {
    const file = await fixture("variable.mkv", 10, 0.4, [
      "settb=1/1000000",
      "setpts='if(lt(N,2),if(lt(N,1),0,100000),if(lt(N,3),300000,700000))'"
    ]);
    const profile = await inspectBounceSource(file);
    const original = await hashes(file, profile);
    const full = await verifyBoth(file, 0, 800, profile, original);
    expect(full.sourceTimesMs).toEqual([0, 100, 300, 700]);
    expect(full.durationsMs).toEqual([100, 200, 400, 100]);
    expect(full.outputTimesMs).toEqual([0, 100, 300, 700, 800, 1200]);
    expect(full.outputDurationMs).toBe(1400);
    const partial = await verifyBoth(
      file,
      150,
      750,
      profile,
      original.slice(1)
    );
    expect(partial.sourceTimesMs).toEqual([150, 300, 700]);
    expect(partial.durationsMs).toEqual([150, 400, 50]);
    expect(partial.outputTimesMs).toEqual([0, 150, 550, 600]);
    expect(partial.outputDurationMs).toBe(1000);
  });

  it("preserves 10-bit pixels, exact SAR, SDR color and rotation without resampling", async () => {
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
    await verifyBoth(file, 0, 500, profile, await hashes(file, profile));
  });

  it("rejects HDR, odd coded geometry, and reflected display matrices explicitly", async () => {
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
    const file = await fixture("fast.mkv", 120, 6);
    const profile = await inspectBounceSource(file);
    await expect(
      createBouncePlan(file, 0, 6000, profile)
    ).rejects.toMatchObject({ code: "bounce_duration_exceeded" });
  });

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
