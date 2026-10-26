import { open } from "node:fs/promises";
import sharp from "sharp";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import type { ResolvedAssetFile } from "./media-serving.js";
import {
  presentationForFile,
  PresentationMediaError
} from "./presentation-cache.js";
import {
  LOCAL_MEDIA_INPUT_ARGS,
  runMediaCommand,
  withVideoProcessingSlot
} from "./video-processing.js";
import {
  createBouncePlan,
  inspectBounceSource,
  videoBounceMaxDurationMs,
  type VideoBouncePlan,
  type VideoBounceProfile
} from "./presentation-bounce.js";
export { videoBounceMaxDurationMs } from "./presentation-bounce.js";

export {
  PresentationMediaError,
  StalePresentationRenditionError
} from "./presentation-cache.js";
export const ANIMATION_LIMITS = {
  durationMs: 60_000,
  frames: 600,
  inputPixels: 64_000_000,
  frameSize: 2048,
  outputBytes: 64 * 1024 * 1024
} as const;

export interface PresentationMediaCapabilities {
  kind: "still" | "video" | "animation";
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  maxBounceDurationMs: number;
  bounceUnavailable?: boolean;
  bounceOverBudget?: boolean;
  bounceTimeline?: { sourceTimesMs: number[]; durationsMs: number[] };
  maxHighlightDurationMs: number;
  maxAnimationDurationMs: number;
  maxAnimationFrames: number;
  renditionKeys: { full: string; highlight: string; bounce: string };
}

export interface AnimationProbe {
  width: number;
  height: number;
  delays: number[];
  decoder: "sharp" | "ffmpeg";
  streamIndex: number;
  alphaStreamIndex: number | null;
}

interface MediaProbe {
  kind: PresentationMediaCapabilities["kind"];
  width: number;
  height: number;
  durationMs: number | null;
  hasAudio: boolean;
  animation?: AnimationProbe;
  videoBounce?: VideoBounceProfile | null;
}
interface ProbeStream {
  index: number;
  codec_type?: string;
  width?: number;
  height?: number;
  nb_frames?: string;
  sample_aspect_ratio?: string;
  pix_fmt?: string;
  side_data_list?: Array<{ rotation?: number }>;
}
interface ProbePayload {
  streams?: ProbeStream[];
  format?: { duration?: string };
}

const probes = new WeakMap<AetherDatabase, Map<string, Promise<MediaProbe>>>();
let queuedProbes = 0;
const bouncePlans = new WeakMap<
  AetherDatabase,
  Map<string, Promise<VideoBouncePlan>>
>();
let queuedBouncePlans = 0;

export async function getPresentationVideoBouncePlan(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  range: { startMs: number; endMs: number }
): Promise<VideoBouncePlan> {
  const media = await probePresentationMedia(db, file);
  if (!media.videoBounce)
    throw new PresentationMediaError("bounce_source_not_supported");
  let cache = bouncePlans.get(db);
  if (!cache) {
    cache = new Map();
    bouncePlans.set(db, cache);
  }
  const key = `${file.asset.id}:${file.mtimeMs}:${file.sizeBytes}:${range.startMs}:${range.endMs}`;
  const existing = cache.get(key);
  if (existing) return existing;
  if (queuedBouncePlans >= 8)
    throw new PresentationMediaError("processing_busy", 503);
  queuedBouncePlans++;
  const profile = media.videoBounce;
  const job = withVideoProcessingSlot(() =>
    createBouncePlan(file.sourcePath, range.startMs, range.endMs, profile)
  ).finally(() => {
    queuedBouncePlans--;
  });
  cache.set(key, job);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  try {
    return await job;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export async function getPresentationMediaCapabilities({
  db,
  config,
  file
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
}): Promise<PresentationMediaCapabilities> {
  void config;
  const media = await probePresentationMedia(db, file);
  const presentation = presentationForFile(db, file);
  let bounceTimeline: PresentationMediaCapabilities["bounceTimeline"];
  const maxBounceDurationMs =
    media.kind === "video"
      ? media.videoBounce
        ? videoBounceMaxDurationMs(
            media.videoBounce.width,
            media.videoBounce.height,
            media.videoBounce.frameRate,
            media.videoBounce.bitDepth
          )
        : 0
      : ANIMATION_LIMITS.durationMs;
  let bounceUnavailable = media.kind === "video" && !media.videoBounce;
  let bounceOverBudget = false;
  if (
    media.kind === "video" &&
    media.videoBounce &&
    presentation.loopMode === "bounce"
  ) {
    const range = presentation.highlight ?? {
      startMs: 0,
      endMs: media.durationMs!
    };
    if (range.endMs - range.startMs <= maxBounceDurationMs) {
      try {
        const plan = await getPresentationVideoBouncePlan(db, file, range);
        bounceTimeline = {
          sourceTimesMs: plan.sourceTimesMs,
          durationsMs: plan.durationsMs
        };
      } catch (error) {
        if (!(error instanceof PresentationMediaError)) throw error;
        if (error.code === "bounce_duration_exceeded") bounceOverBudget = true;
        else if (
          error.code === "bounce_timing_not_supported" ||
          error.code === "bounce_source_not_supported"
        )
          bounceUnavailable = true;
        else throw error;
      }
    }
  }
  return {
    kind: media.kind,
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    hasAudio: media.hasAudio,
    maxBounceDurationMs: bounceUnavailable ? 0 : maxBounceDurationMs,
    ...(bounceUnavailable ? { bounceUnavailable: true } : {}),
    ...(bounceOverBudget ? { bounceOverBudget: true } : {}),
    ...(bounceTimeline ? { bounceTimeline } : {}),
    maxHighlightDurationMs:
      media.kind === "video" ? 120_000 : ANIMATION_LIMITS.durationMs,
    maxAnimationDurationMs: ANIMATION_LIMITS.durationMs,
    maxAnimationFrames: ANIMATION_LIMITS.frames,
    renditionKeys: presentation.renditionKeys
  };
}

export async function probePresentationMedia(
  db: AetherDatabase,
  file: ResolvedAssetFile
): Promise<MediaProbe> {
  let cache = probes.get(db);
  if (!cache) {
    cache = new Map();
    probes.set(db, cache);
  }
  const key = `${file.asset.id}:${file.mtimeMs}:${file.sizeBytes}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  if (queuedProbes >= 16)
    throw new PresentationMediaError("processing_busy", 503);
  queuedProbes += 1;
  const job = withVideoProcessingSlot(async () => {
    try {
      return await inspectMedia(file);
    } catch (error) {
      if (error instanceof PresentationMediaError) throw error;
      throw new PresentationMediaError("media_decode_failed");
    }
  }).finally(() => {
    queuedProbes -= 1;
  });
  cache.set(key, job);
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  try {
    return await job;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function inspectMedia(file: ResolvedAssetFile): Promise<MediaProbe> {
  if (file.asset.mediaType === "video") {
    const data = await ffprobe(file.sourcePath);
    const video = data.streams?.find((stream) => stream.codec_type === "video");
    if (!video?.width || !video.height)
      throw new PresentationMediaError("media_decode_failed");
    if (
      !Number.isSafeInteger(video.width) ||
      !Number.isSafeInteger(video.height) ||
      video.width <= 0 ||
      video.height <= 0 ||
      video.width > 32768 ||
      video.height > 32768 ||
      video.width * video.height > ANIMATION_LIMITS.inputPixels
    )
      throw new PresentationMediaError("presentation_limit_exceeded", 422);
    const [numerator = 1, denominator = 1] = (
      video.sample_aspect_ratio ?? "1:1"
    )
      .split(":")
      .map(Number);
    const sar = numerator > 0 && denominator > 0 ? numerator / denominator : 1;
    const rotation =
      video.side_data_list?.find((side) => Number.isFinite(side.rotation))
        ?.rotation ?? 0;
    const rotated = Math.abs(rotation % 180) === 90;
    const width = Math.round(video.width * sar);
    if (
      !Number.isSafeInteger(width) ||
      width <= 0 ||
      width > 32768 ||
      width * video.height > ANIMATION_LIMITS.inputPixels
    )
      throw new PresentationMediaError("presentation_limit_exceeded", 422);
    const durationMs = Math.round(Number(data.format?.duration) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0)
      throw new PresentationMediaError("media_duration_unavailable");
    let videoBounce: VideoBounceProfile | null = null;
    try {
      videoBounce = await inspectBounceSource(file.sourcePath);
    } catch (error) {
      if (
        !(error instanceof PresentationMediaError) ||
        error.code !== "bounce_source_not_supported"
      )
        throw error;
    }
    return {
      kind: "video",
      width: rotated ? video.height : width,
      height: rotated ? width : video.height,
      durationMs,
      videoBounce,
      hasAudio: Boolean(
        data.streams?.some((stream) => stream.codec_type === "audio")
      )
    };
  }
  const mime = file.asset.mimeType;
  if (
    mime === "image/avif" ||
    (mime === "image/png" && (await hasPngAnimation(file.sourcePath)))
  ) {
    return inspectFfmpegAnimation(file);
  }
  const metadata = await sharp(file.sourcePath, {
    animated: true,
    limitInputPixels: ANIMATION_LIMITS.inputPixels
  }).metadata();
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (!width || !height)
    throw new PresentationMediaError("media_decode_failed");
  const pages = metadata.pages ?? 1;
  if (pages <= 1)
    return {
      kind: "still",
      width: metadata.autoOrient.width,
      height: metadata.autoOrient.height,
      durationMs: null,
      hasAudio: false
    };
  const delays = Array.from({ length: pages }, (_, index) =>
    normalizedDelay(metadata.delay?.[index] ?? 100)
  );
  const animation: AnimationProbe = {
    width,
    height,
    delays,
    decoder: "sharp",
    streamIndex: 0,
    alphaStreamIndex: null
  };
  validateAnimation(animation);
  return {
    kind: "animation",
    width,
    height,
    durationMs: delays.reduce((total, delay) => total + delay, 0),
    hasAudio: false,
    animation
  };
}

async function inspectFfmpegAnimation(
  file: ResolvedAssetFile
): Promise<MediaProbe> {
  const payload = await ffprobe(file.sourcePath);
  const streams = (payload.streams ?? []).filter(
    (stream) => stream.codec_type === "video" && stream.width && stream.height
  );
  const ordered = [...streams].sort(
    (left, right) => Number(right.nb_frames ?? 1) - Number(left.nb_frames ?? 1)
  );
  const stream = ordered.find(
    (candidate) => !candidate.pix_fmt?.startsWith("gray")
  );
  if (
    !stream?.width ||
    !stream.height ||
    stream.width * stream.height > ANIMATION_LIMITS.inputPixels
  )
    throw new PresentationMediaError("presentation_limit_exceeded", 422);
  const result = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      String(stream.index),
      "-read_intervals",
      "%+61",
      "-show_frames",
      "-show_entries",
      "frame=best_effort_timestamp_time,pkt_duration_time,duration_time",
      "-of",
      "json",
      ...LOCAL_MEDIA_INPUT_ARGS,
      file.sourcePath
    ],
    15_000
  );
  const frames =
    (
      JSON.parse(result.stdout) as {
        frames?: Array<{
          best_effort_timestamp_time?: string;
          pkt_duration_time?: string;
          duration_time?: string;
        }>;
      }
    ).frames ?? [];
  if (!frames.length) throw new PresentationMediaError("media_decode_failed");
  if (frames.length === 1) {
    if (
      file.asset.mimeType === "image/png" ||
      (await hasAvifAnimation(file.sourcePath))
    )
      throw new PresentationMediaError("media_decode_failed");
    return {
      kind: "still",
      width: stream.width,
      height: stream.height,
      durationMs: null,
      hasAudio: false
    };
  }
  const delays = frames.map((frame, index) => {
    const explicit = Number(frame.duration_time ?? frame.pkt_duration_time);
    const next = frames[index + 1];
    const difference = next
      ? Number(next.best_effort_timestamp_time) -
        Number(frame.best_effort_timestamp_time)
      : NaN;
    const fallback =
      index > 0
        ? Number(frame.best_effort_timestamp_time) -
          Number(frames[index - 1]?.best_effort_timestamp_time)
        : NaN;
    return normalizedDelay(
      Math.round(
        (explicit > 0
          ? explicit
          : difference > 0
            ? difference
            : fallback > 0
              ? fallback
              : 0.1) * 1000
      )
    );
  });
  const alpha = ordered.find(
    (candidate) =>
      candidate.pix_fmt?.startsWith("gray") &&
      candidate.nb_frames === stream.nb_frames
  );
  const animation: AnimationProbe = {
    width: stream.width,
    height: stream.height,
    delays,
    decoder: "ffmpeg",
    streamIndex: stream.index,
    alphaStreamIndex: alpha?.index ?? null
  };
  validateAnimation(animation);
  return {
    kind: "animation",
    width: stream.width,
    height: stream.height,
    durationMs: delays.reduce((total, delay) => total + delay, 0),
    hasAudio: false,
    animation
  };
}

function validateAnimation(animation: AnimationProbe): void {
  if (
    animation.width > ANIMATION_LIMITS.frameSize ||
    animation.height > ANIMATION_LIMITS.frameSize ||
    animation.delays.length > ANIMATION_LIMITS.frames ||
    animation.width * animation.height * animation.delays.length >
      ANIMATION_LIMITS.inputPixels ||
    animation.delays.reduce((total, delay) => total + delay, 0) >
      ANIMATION_LIMITS.durationMs
  )
    throw new PresentationMediaError("presentation_limit_exceeded", 422);
}
function normalizedDelay(delay: number): number {
  return Number.isFinite(delay) && delay > 0
    ? Math.max(1, Math.round(delay))
    : 100;
}
async function ffprobe(sourcePath: string): Promise<ProbePayload> {
  const result = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,width,height,nb_frames,pix_fmt,sample_aspect_ratio:stream_side_data=rotation:format=duration",
      "-of",
      "json",
      ...LOCAL_MEDIA_INPUT_ARGS,
      sourcePath
    ],
    10_000
  );
  return JSON.parse(result.stdout) as ProbePayload;
}
async function hasPngAnimation(sourcePath: string): Promise<boolean> {
  const handle = await open(sourcePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await handle.read(buffer);
    let offset = 8;
    while (offset + 12 <= bytesRead) {
      const length = buffer.readUInt32BE(offset);
      const kind = buffer.toString("ascii", offset + 4, offset + 8);
      if (kind === "acTL") return true;
      if (kind === "IDAT" || kind === "IEND") return false;
      offset += 12 + length;
    }
    return false;
  } finally {
    await handle.close();
  }
}

async function hasAvifAnimation(sourcePath: string): Promise<boolean> {
  const handle = await open(sourcePath, "r");
  try {
    const buffer = Buffer.alloc(128);
    const { bytesRead } = await handle.read(buffer);
    return buffer.subarray(0, bytesRead).includes(Buffer.from("avis"));
  } finally {
    await handle.close();
  }
}
