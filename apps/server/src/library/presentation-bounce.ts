import { mkdtemp, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  decodeBounceFrames,
  encodeBounceFrames,
  type BounceFrameSpool
} from "./presentation-bounce-frames.js";
import { PresentationMediaError } from "./presentation-cache.js";
import { LOCAL_MEDIA_INPUT_ARGS, runMediaCommand } from "./video-processing.js";

export const VIDEO_BOUNCE_MAX_DURATION_MS = 30_000;
export const VIDEO_BOUNCE_MAX_FRAMES = 3600;
export const VIDEO_BOUNCE_MAX_DECODED_BYTES = 256 * 1024 * 1024;
export const VIDEO_BOUNCE_MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;
export const VIDEO_BOUNCE_MAX_WORK_BYTES = 2 * 1024 * 1024 * 1024;
export const VIDEO_BOUNCE_MAX_PROCESSING_MS = 300_000;
const MICROSECONDS = 1_000_000;
let displayRotationSupport: Promise<boolean> | null = null;

function supportsDisplayRotation(): Promise<boolean> {
  // Newer releases omit advanced input flags from short help. Parsing a
  // harmless version request tests the option without opening any media.
  displayRotationSupport ??= runMediaCommand(
    "ffmpeg",
    ["-hide_banner", "-display_rotation", "0", "-version"],
    5000
  )
    .then(() => true)
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        /Unrecognized option ['"]display_rotation/.test(error.message)
      )
        return false;
      displayRotationSupport = null;
      throw error;
    });
  return displayRotationSupport;
}

export interface VideoBounceProfile {
  width: number;
  height: number;
  pixelFormat: "yuv420p" | "yuv420p10le";
  bitDepth: 8 | 10;
  sampleAspectRatio: string;
  rotation: number;
  frameRate: number;
  durationMs: number;
  startTimeSeconds: number;
  streamIndex: number;
  colorRange?: string;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  chromaLocation?: string;
}

export interface VideoBouncePlan {
  startMs: number;
  endMs: number;
  sourceTimesMs: number[];
  durationsMs: number[];
  outputTimesMs: number[];
  outputSourceIndices: number[];
  outputDurationMs: number;
  sourceFrameCount: number;
  decodedBytes: number;
  firstSourceTimeMs: number;
}

interface ProbeStream {
  index?: number;
  codec_type?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  field_order?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  start_time?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  chroma_location?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: Array<{
    rotation?: number;
    side_data_type?: string;
    displaymatrix?: string;
  }>;
  codec_name?: string;
  profile?: string;
  time_base?: string;
}
interface ProbeFrame {
  best_effort_timestamp_time?: string;
  pkt_duration_time?: string;
  duration_time?: string;
  side_data_list?: Array<{ side_data_type?: string }>;
}

function unsupported(): never {
  throw new PresentationMediaError("bounce_source_not_supported", 415);
}
function badTiming(): never {
  throw new PresentationMediaError("bounce_timing_not_supported", 422);
}
function overBudget(): never {
  throw new PresentationMediaError("bounce_duration_exceeded", 422);
}
function rational(value: string | undefined): number {
  const [numerator, denominator] = (value ?? "").split(/[/:]/).map(Number);
  return Number.isFinite(numerator) && denominator && denominator > 0
    ? numerator! / denominator
    : NaN;
}
function hdrSideData(data: ProbeStream["side_data_list"]): boolean {
  return Boolean(
    data?.some((item) =>
      /dovi|dolby|mastering display|content light|hdr/i.test(
        item.side_data_type ?? ""
      )
    )
  );
}
function canonicalMatrix(stream: ProbeStream): boolean {
  const matrix = stream.side_data_list?.find(
    (item) => item.displaymatrix
  )?.displaymatrix;
  if (!matrix) return true;
  const values = matrix
    .trim()
    .split("\n")
    .flatMap((line) =>
      (line.split(":")[1] ?? "").trim().split(/\s+/).map(Number)
    );
  return (
    values.length === 9 &&
    values.every(Number.isSafeInteger) &&
    [0, 1, 3, 4].every((index) =>
      [0, -65536, 65536].includes(values[index]!)
    ) &&
    [2, 5, 6, 7].every((index) => values[index] === 0) &&
    values[8] === 1073741824 &&
    values[0]! ** 2 + values[1]! ** 2 === 65536 ** 2 &&
    values[3]! ** 2 + values[4]! ** 2 === 65536 ** 2 &&
    values[0]! * values[3]! + values[1]! * values[4]! === 0 &&
    values[0]! * values[4]! - values[1]! * values[3]! === 65536 ** 2
  );
}
function frameBytes(width: number, height: number, bitDepth: number) {
  return width * height * 1.5 * (bitDepth > 8 ? 2 : 1);
}

function canonicalPixelFormat(
  format: string | undefined,
  range: string | undefined
): VideoBounceProfile["pixelFormat"] | null {
  if (range && !["pc", "tv", "unknown", "unspecified"].includes(range))
    return null;
  // FFmpeg's JPEG-range alias has the same planar samples as 8-bit 4:2:0.
  // Require explicit full range rather than inferring or changing sample values.
  if (format === "yuvj420p") return range === "pc" ? "yuv420p" : null;
  return format === "yuv420p" || format === "yuv420p10le" ? format : null;
}

/** Raw input, compressed block, inflated output and one queued encoder frame. */
export function videoBounceWorkingBytes(
  width: number,
  height: number,
  bitDepth: number
): number {
  return frameBytes(width, height, bitDepth) * 4;
}

export function videoBounceMaxDurationMs(
  width: number,
  height: number,
  frameRate = 24,
  bitDepth = 8
): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width % 2 ||
    height % 2 ||
    !Number.isFinite(frameRate) ||
    frameRate <= 0 ||
    (bitDepth !== 8 && bitDepth !== 10)
  )
    return 0;
  const bytes = videoBounceWorkingBytes(width, height, bitDepth);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > VIDEO_BOUNCE_MAX_DECODED_BYTES
  )
    return 0;
  const frames = VIDEO_BOUNCE_MAX_FRAMES;
  return Math.min(
    VIDEO_BOUNCE_MAX_DURATION_MS,
    Math.floor((frames / frameRate) * 1000)
  );
}

export async function inspectBounceSource(
  sourcePath: string
): Promise<VideoBounceProfile> {
  const result = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,width,height,pix_fmt,sample_aspect_ratio,field_order,avg_frame_rate,r_frame_rate,duration,start_time,color_range,color_space,color_transfer,color_primaries,chroma_location:stream_disposition=attached_pic:stream_side_data=rotation,side_data_type,displaymatrix:format=duration,start_time",
      "-of",
      "json=compact=1",
      ...LOCAL_MEDIA_INPUT_ARGS,
      sourcePath
    ],
    15_000
  );
  const payload = JSON.parse(result.stdout) as {
    streams?: ProbeStream[];
    format?: { duration?: string; start_time?: string };
  };
  const stream = payload.streams?.find(
    (item) =>
      item.codec_type === "video" && item.disposition?.attached_pic !== 1
  );
  if (!stream) unsupported();
  const width = stream.width!;
  const height = stream.height!;
  const pixelFormat = canonicalPixelFormat(stream.pix_fmt, stream.color_range);
  const transfer = stream.color_transfer;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 32768 ||
    height > 32768 ||
    width % 2 ||
    height % 2 ||
    !pixelFormat ||
    (stream.field_order &&
      !["unknown", "progressive"].includes(stream.field_order)) ||
    transfer === "smpte2084" ||
    transfer === "arib-std-b67" ||
    hdrSideData(stream.side_data_list) ||
    !canonicalMatrix(stream)
  )
    unsupported();
  const frameRate =
    rational(stream.avg_frame_rate) || rational(stream.r_frame_rate);
  const durationMs = Number(stream.duration ?? payload.format?.duration) * 1000;
  const startTimeSeconds = Number(payload.format?.start_time ?? 0);
  const streamStartTime = Number(stream.start_time ?? 0);
  const sar = stream.sample_aspect_ratio;
  const sampleAspectRatio = !sar || sar === "N/A" ? "1:1" : sar;
  const rotation =
    stream.side_data_list?.find((item) => Number.isFinite(item.rotation))
      ?.rotation ?? 0;
  if (
    !Number.isFinite(frameRate) ||
    frameRate <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(startTimeSeconds) ||
    !Number.isFinite(streamStartTime) ||
    Math.abs(startTimeSeconds) > 0.000001 ||
    Math.abs(streamStartTime) > 0.000001 ||
    !Number.isFinite(rational(sampleAspectRatio)) ||
    rational(sampleAspectRatio) <= 0 ||
    !Number.isFinite(rotation) ||
    rotation % 90 !== 0
  )
    unsupported();
  const defined = (value: string | undefined) =>
    value && !["unknown", "unspecified", "reserved"].includes(value)
      ? value
      : undefined;
  return {
    width,
    height,
    pixelFormat,
    bitDepth: pixelFormat === "yuv420p10le" ? 10 : 8,
    sampleAspectRatio,
    rotation,
    frameRate,
    durationMs,
    startTimeSeconds,
    streamIndex: stream.index ?? 0,
    colorRange: defined(stream.color_range),
    colorSpace: defined(stream.color_space),
    colorTransfer: defined(stream.color_transfer),
    colorPrimaries: defined(stream.color_primaries),
    chromaLocation: defined(stream.chroma_location)
  };
}

export async function createBouncePlan(
  sourcePath: string,
  startMs: number,
  endMs: number,
  profile: VideoBounceProfile
): Promise<VideoBouncePlan> {
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs > profile.durationMs + 1
  )
    badTiming();
  if (
    endMs - startMs > VIDEO_BOUNCE_MAX_DURATION_MS ||
    videoBounceWorkingBytes(profile.width, profile.height, profile.bitDepth) >
      VIDEO_BOUNCE_MAX_DECODED_BYTES
  )
    overBudget();
  const originUs = Math.round(profile.startTimeSeconds * MICROSECONDS);
  const startUs = Math.round(startMs * 1000);
  const endUs = Math.min(
    Math.round(endMs * 1000),
    Math.round(profile.durationMs * 1000)
  );
  let payload: { frames?: ProbeFrame[] };
  const interval = `${Math.max(0, profile.startTimeSeconds + startMs / 1000 - 1)}%${profile.startTimeSeconds + endMs / 1000 + 2}`;
  try {
    const result = await runMediaCommand(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        String(profile.streamIndex),
        "-read_intervals",
        interval,
        "-show_frames",
        "-show_entries",
        "frame=best_effort_timestamp_time,pkt_duration_time,duration_time:frame_side_data=side_data_type",
        "-of",
        "json=compact=1",
        ...LOCAL_MEDIA_INPUT_ARGS,
        sourcePath
      ],
      20_000,
      1024 * 1024
    );
    payload = JSON.parse(result.stdout) as { frames?: ProbeFrame[] };
  } catch {
    badTiming();
  }
  const frames = payload.frames ?? [];
  if (frames.some((frame) => hdrSideData(frame.side_data_list))) unsupported();
  const timestamps = frames.map(
    (frame) =>
      Math.round(Number(frame.best_effort_timestamp_time) * MICROSECONDS) -
      originUs
  );
  if (
    !timestamps.length ||
    timestamps.some(
      (time, index) =>
        !Number.isSafeInteger(time) ||
        (index > 0 && time <= timestamps[index - 1]!)
    )
  )
    badTiming();
  if (startUs === 0 && timestamps[0] !== 0) badTiming();
  if (!timestamps.some((time) => time >= endUs)) {
    const last = frames.at(-1)!;
    const duration =
      Number(last.duration_time ?? last.pkt_duration_time) * MICROSECONDS;
    const lastEnd = timestamps.at(-1)! + duration;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      lastEnd < endUs - 1000 ||
      Math.abs(lastEnd - profile.durationMs * 1000) > 1000
    )
      badTiming();
  }
  const selected: Array<{
    sourceUs: number;
    startUs: number;
    durationUs: number;
  }> = [];
  for (let index = 0; index < timestamps.length; index++) {
    const time = timestamps[index]!;
    const next = timestamps[index + 1] ?? Math.round(profile.durationMs * 1000);
    if (time >= endUs || next <= startUs) continue;
    const clippedStart = Math.max(time, startUs);
    const clippedEnd = Math.min(next, endUs);
    if (clippedEnd > clippedStart)
      selected.push({
        sourceUs: time,
        startUs: clippedStart,
        durationUs: clippedEnd - clippedStart
      });
  }
  if (
    !selected.length ||
    selected[0]!.startUs !== startUs ||
    selected.at(-1)!.startUs + selected.at(-1)!.durationUs !== endUs
  )
    badTiming();
  const decodedBytes = videoBounceWorkingBytes(
    profile.width,
    profile.height,
    profile.bitDepth
  );
  if (
    selected.length > VIDEO_BOUNCE_MAX_FRAMES ||
    decodedBytes > VIDEO_BOUNCE_MAX_DECODED_BYTES
  )
    overBudget();
  await validateSourceFrames(sourcePath, interval, profile);
  const outputSourceIndices = selected.map((_frame, index) => index);
  for (let index = selected.length - 2; index >= 1; index--)
    outputSourceIndices.push(index);
  let elapsedUs = 0;
  const outputTimesMs = outputSourceIndices.map((index) => {
    const time = elapsedUs / 1000;
    elapsedUs += selected[index]!.durationUs;
    return time;
  });
  return {
    startMs,
    endMs: endUs / 1000,
    sourceTimesMs: selected.map((frame) => frame.startUs / 1000),
    durationsMs: selected.map((frame) => frame.durationUs / 1000),
    outputTimesMs,
    outputSourceIndices,
    outputDurationMs: elapsedUs / 1000,
    sourceFrameCount: selected.length,
    decodedBytes,
    firstSourceTimeMs: selected[0]!.sourceUs / 1000
  };
}

function lookupExpression(
  values: number[],
  start = 0,
  end = values.length
): string {
  if (end - start === 1) return String(values[start]);
  const middle = Math.floor((start + end) / 2);
  return `if(lt(N,${middle}),${lookupExpression(values, start, middle)},${lookupExpression(values, middle, end)})`;
}

async function validateSourceFrames(
  sourcePath: string,
  interval: string,
  profile: VideoBounceProfile
) {
  for (const fields of [
    "width,height,pix_fmt,interlaced_frame,color_range",
    "color_range,color_space,color_transfer,color_primaries,chroma_location"
  ]) {
    let output: string;
    try {
      output = (
        await runMediaCommand(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            String(profile.streamIndex),
            "-read_intervals",
            interval,
            "-show_frames",
            "-show_entries",
            `frame=${fields}`,
            "-of",
            "compact=p=0",
            ...LOCAL_MEDIA_INPUT_ARGS,
            sourcePath
          ],
          20_000,
          1024 * 1024
        )
      ).stdout;
    } catch {
      badTiming();
    }
    const records = output
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) =>
        Object.fromEntries(
          line.split("|").map((field) => {
            const separator = field.indexOf("=");
            return [field.slice(0, separator), field.slice(separator + 1)];
          })
        )
      );
    if (!records.length) badTiming();
    for (const frame of records) {
      if (fields.startsWith("width")) {
        if (!("width" in frame)) continue;
        if (
          Number(frame.width) !== profile.width ||
          Number(frame.height) !== profile.height ||
          canonicalPixelFormat(frame.pix_fmt, frame.color_range) !==
            profile.pixelFormat ||
          (profile.colorRange && frame.color_range !== profile.colorRange) ||
          frame.interlaced_frame !== "0"
        )
          unsupported();
      } else {
        for (const [key, expected] of [
          ["color_range", profile.colorRange],
          ["color_space", profile.colorSpace],
          ["color_transfer", profile.colorTransfer],
          ["color_primaries", profile.colorPrimaries],
          ["chroma_location", profile.chromaLocation]
        ]) {
          const value = frame[key!];
          if (
            value &&
            !["unknown", "unspecified", "reserved"].includes(value) &&
            value !== expected
          )
            unsupported();
        }
      }
    }
  }
}

export interface VideoBounceGenerationOptions {
  signal?: AbortSignal;
  maxWorkBytes?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

function lowerLimit(value: number | undefined, maximum: number): number {
  const limit = value ?? maximum;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > maximum)
    throw new PresentationMediaError("presentation_limit_exceeded", 422);
  return limit;
}

export async function generateLosslessBounce(
  sourcePath: string,
  outputPath: string,
  plan: VideoBouncePlan,
  profile: VideoBounceProfile,
  codec: "hevc" | "h264" = "hevc",
  options: VideoBounceGenerationOptions = {}
): Promise<void> {
  const count = plan.sourceFrameCount;
  const bytes = frameBytes(profile.width, profile.height, profile.bitDepth);
  if (
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    count > VIDEO_BOUNCE_MAX_FRAMES ||
    plan.endMs - plan.startMs > VIDEO_BOUNCE_MAX_DURATION_MS ||
    videoBounceWorkingBytes(profile.width, profile.height, profile.bitDepth) >
      VIDEO_BOUNCE_MAX_DECODED_BYTES
  )
    overBudget();
  const maxWorkBytes = lowerLimit(
    options.maxWorkBytes,
    VIDEO_BOUNCE_MAX_WORK_BYTES
  );
  const maxOutputBytes = lowerLimit(
    options.maxOutputBytes,
    VIDEO_BOUNCE_MAX_OUTPUT_BYTES
  );
  const timeoutMs = lowerLimit(
    options.timeoutMs,
    VIDEO_BOUNCE_MAX_PROCESSING_MS
  );
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const deadline = performance.now() + timeoutMs;
  const remainingMs = () => Math.max(0, deadline - performance.now());
  const scope = { signal: controller.signal, remainingMs };
  const check = () => {
    if (controller.signal.aborted)
      throw new PresentationMediaError(
        "presentation_processing_cancelled",
        499
      );
    if (!remainingMs())
      throw new PresentationMediaError("presentation_limit_exceeded", 422);
  };
  let workDirectory: string | undefined;
  let spool: BounceFrameSpool | undefined;
  let succeeded = false;
  try {
    check();
    const disk = await statfs(path.dirname(outputPath));
    const reservedBytes =
      Math.min(maxWorkBytes, count * bytes + count * 1024) +
      Math.min(maxOutputBytes, plan.outputSourceIndices.length * bytes);
    if (disk.bavail * disk.bsize < reservedBytes + 1024 * 1024)
      throw new PresentationMediaError("presentation_limit_exceeded", 422);
    workDirectory = await mkdtemp(
      path.join(path.dirname(outputPath), ".bounce-work-")
    );
    const filterPath = path.join(workDirectory, "timeline.filter");
    const firstTime = profile.startTimeSeconds + plan.firstSourceTimeMs / 1000;
    const endTime = profile.startTimeSeconds + plan.endMs / 1000;
    // Only the source decoder sees source timestamps. The spool keeps exact
    // planar samples; the independently verified timeline supplies output PTS.
    spool = await decodeBounceFrames(
      path.join(workDirectory, "frames.deflate"),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-threads",
        "1",
        "-copyts",
        "-noautorotate",
        ...LOCAL_MEDIA_INPUT_ARGS,
        "-ss",
        String(Math.max(0, plan.firstSourceTimeMs / 1000 - 0.1)),
        "-t",
        String((plan.endMs - plan.firstSourceTimeMs) / 1000 + 0.2),
        "-i",
        sourcePath,
        "-filter_threads",
        "1",
        "-vf",
        `select='gte(t,${firstTime - 0.000001})*lt(t,${endTime - 0.0000005})',trim=end_frame=${count}${profile.colorRange === "pc" ? `,scale=in_range=pc:out_range=pc,format=${profile.pixelFormat}` : ""}`,
        "-map",
        `0:${profile.streamIndex}`,
        "-an",
        "-frames:v",
        String(count),
        "-fps_mode",
        "passthrough",
        "-pix_fmt",
        profile.pixelFormat,
        "-threads",
        "1",
        "-f",
        "rawvideo",
        "pipe:1"
      ],
      bytes,
      count,
      maxWorkBytes,
      scope
    );
    check();
    const frameColor = [
      ["range", profile.colorRange],
      ["color_primaries", profile.colorPrimaries],
      ["color_trc", profile.colorTransfer],
      ["colorspace", profile.colorSpace]
    ]
      .flatMap(([option, value]) => (value ? [`${option}=${value}`] : []))
      .join(":");
    const filter = `[0:v]${frameColor ? `setparams=${frameColor},` : ""}setsar=${profile.sampleAspectRatio.replace(":", "/")}:max=65535,settb=1/1000000,setpts='${lookupExpression(plan.outputTimesMs.map((time) => Math.round(time * 1000)))}'[out]`;
    await writeFile(filterPath, filter, { flag: "wx", mode: 0o600 });
    const encodedPath = profile.rotation
      ? path.join(workDirectory, "encoded.mp4")
      : outputPath;
    const colorArgs = [
      ["-color_range", profile.colorRange],
      ["-colorspace", profile.colorSpace],
      ["-color_trc", profile.colorTransfer],
      ["-color_primaries", profile.colorPrimaries],
      ["-chroma_sample_location", profile.chromaLocation]
    ].flatMap(([option, value]) => (value ? [option!, value] : []));
    // MP4 obtains every interior sample duration from adjacent PTS. The final
    // duration alone needs an explicit packet value, keeping BSF argv bounded.
    const lastDuration = Math.round(
      plan.durationsMs[plan.outputSourceIndices.at(-1)!]! * 1000
    );
    try {
      await encodeBounceFrames(
        spool,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-threads",
          "1",
          "-f",
          "rawvideo",
          "-pixel_format",
          profile.pixelFormat,
          "-video_size",
          `${profile.width}x${profile.height}`,
          "-framerate",
          String(profile.frameRate),
          "-i",
          "pipe:0",
          "-filter_complex_threads",
          "1",
          "-filter_complex_script",
          filterPath,
          "-map",
          "[out]",
          "-an",
          "-c:v",
          codec === "hevc" ? "libx265" : "libx264",
          ...(codec === "hevc"
            ? [
                "-x265-params",
                "lossless=1:pools=1:frame-threads=1:log-level=error:bframes=0:rc-lookahead=0:ref=1",
                "-tag:v",
                "hvc1"
              ]
            : [
                "-qp",
                "0",
                "-x264-params",
                "bframes=0:rc-lookahead=0:sync-lookahead=0:ref=1"
              ]),
          "-preset",
          codec === "hevc" ? "ultrafast" : "veryfast",
          "-tune",
          "zerolatency",
          "-threads",
          "1",
          "-bf",
          "0",
          "-pix_fmt",
          profile.pixelFormat,
          ...colorArgs,
          "-fps_mode",
          "passthrough",
          "-enc_time_base",
          "1:1000000",
          "-bsf:v",
          `setts=duration=${lastDuration}:time_base=1/1000000${codec === "h264" && profile.colorRange ? `,h264_metadata=video_full_range_flag=${profile.colorRange === "pc" ? 1 : 0}` : ""}`,
          "-video_track_timescale",
          "1000000",
          "-movflags",
          "+faststart",
          "-fs",
          String(maxOutputBytes),
          "-f",
          "mp4",
          "-y",
          encodedPath
        ],
        plan.outputSourceIndices,
        bytes,
        scope
      );
    } catch (error) {
      const written = await stat(encodedPath).catch(() => null);
      if (
        !controller.signal.aborted &&
        written &&
        written.size >= maxOutputBytes
      )
        throw new PresentationMediaError("presentation_limit_exceeded", 422);
      throw error;
    }
    // Reverse playback no longer needs the spool. Release it before the
    // optional rotation remux so total transient storage stays within 3 GiB.
    await spool.handle.close();
    spool = undefined;
    await rm(path.join(workDirectory, "frames.deflate"), { force: true });
    check();
    if (profile.rotation) {
      const useDisplayRotation = await supportsDisplayRotation();
      check();
      await runMediaCommand(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-noautorotate",
          ...(useDisplayRotation
            ? ["-display_rotation:v:0", String(profile.rotation)]
            : []),
          ...LOCAL_MEDIA_INPUT_ARGS,
          "-i",
          encodedPath,
          "-map",
          "0:v:0",
          "-c",
          "copy",
          // Older FFmpeg releases lack the input display-matrix override.
          ...(!useDisplayRotation
            ? ["-metadata:s:v:0", `rotate=${profile.rotation}`]
            : []),
          "-video_track_timescale",
          "1000000",
          "-movflags",
          "+faststart",
          "-fs",
          String(maxOutputBytes),
          "-f",
          "mp4",
          "-y",
          outputPath
        ],
        Math.min(20_000, remainingMs())
      );
    }
    check();
    const size = (await stat(outputPath)).size;
    if (size <= 0 || size > maxOutputBytes)
      throw new PresentationMediaError("presentation_limit_exceeded", 422);
    await validateOutput(
      outputPath,
      plan,
      profile,
      codec,
      Math.min(15_000, remainingMs())
    );
    check();
    succeeded = true;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    try {
      await spool?.handle.close();
    } finally {
      try {
        if (workDirectory)
          await rm(workDirectory, { recursive: true, force: true });
      } finally {
        if (!succeeded) await rm(outputPath, { force: true });
      }
    }
  }
}

async function validateOutput(
  outputPath: string,
  plan: VideoBouncePlan,
  profile: VideoBounceProfile,
  codec: "hevc" | "h264",
  timeoutMs: number
) {
  const result = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_packets",
      "-show_entries",
      "stream=codec_name,profile,time_base,width,height,pix_fmt,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,chroma_location:stream_side_data=rotation:packet=pts_time,duration_time",
      "-of",
      "json=compact=1",
      ...LOCAL_MEDIA_INPUT_ARGS,
      outputPath
    ],
    timeoutMs,
    1024 * 1024
  );
  const output = JSON.parse(result.stdout) as {
    streams?: ProbeStream[];
    packets?: Array<{ pts_time?: string; duration_time?: string }>;
  };
  const stream = output.streams?.[0];
  const packets = output.packets ?? [];
  if (
    !stream ||
    stream.width !== profile.width ||
    stream.height !== profile.height ||
    canonicalPixelFormat(stream.pix_fmt, stream.color_range) !==
      profile.pixelFormat ||
    stream.codec_name !== codec ||
    stream.profile !==
      (codec === "h264"
        ? "High 4:4:4 Predictive"
        : profile.bitDepth === 10
          ? "Main 10"
          : "Main") ||
    stream.time_base !== "1/1000000" ||
    rational(stream.sample_aspect_ratio) !==
      rational(profile.sampleAspectRatio) ||
    packets.length !== plan.outputTimesMs.length ||
    Math.abs(
      (stream.side_data_list?.find((item) => Number.isFinite(item.rotation))
        ?.rotation ?? 0) - profile.rotation
    ) %
      360 >
      0.001
  )
    throw new PresentationMediaError("incomplete_rendition", 422);
  for (let index = 0; index < packets.length; index++) {
    const packet = packets[index]!;
    const expectedDuration =
      plan.durationsMs[plan.outputSourceIndices[index]!]!;
    const ptsMs = Number(packet.pts_time) * 1000;
    const durationMs = Number(packet.duration_time) * 1000;
    if (
      !Number.isFinite(ptsMs) ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      Math.abs(ptsMs - plan.outputTimesMs[index]!) > 0.002 ||
      Math.abs(durationMs - expectedDuration) > 0.002
    )
      throw new PresentationMediaError("incomplete_rendition", 422);
  }
  for (const [source, actual] of [
    [profile.colorRange, stream.color_range],
    [profile.colorSpace, stream.color_space],
    [profile.colorTransfer, stream.color_transfer],
    [profile.colorPrimaries, stream.color_primaries],
    [profile.chromaLocation, stream.chroma_location]
  ])
    if (source && actual !== source)
      throw new PresentationMediaError("incomplete_rendition", 422);
}
