import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import type { ResolvedAssetFile } from "./media-serving.js";
import {
  ensurePresentationDerivative,
  presentationForFile,
  PresentationMediaError,
  verifyPresentationSource,
  type PresentationFile,
  type PresentationVariant
} from "./presentation-cache.js";
import {
  probePresentationMedia,
  VIDEO_BOUNCE_MAX_DURATION_MS
} from "./presentation-media.js";
import { LOCAL_MEDIA_INPUT_ARGS, runMediaCommand } from "./video-processing.js";

export const VIDEO_HIGHLIGHT_MAX_DURATION_MS = 120_000;
export type { PresentationFile } from "./presentation-cache.js";
let reversing = false;
const reverseQueue: Array<() => void> = [];

export async function ensurePresentationVideo({
  db,
  config,
  file,
  variant,
  key
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  variant: PresentationVariant;
  key: string;
}): Promise<PresentationFile> {
  const capabilities = await probePresentationMedia(db, file);
  if (capabilities.kind !== "video")
    throw new PresentationMediaError("playback_not_supported");
  await verifyPresentationSource(db, file, variant, key);
  const presentation = presentationForFile(db, file);
  if (
    variant === "full" ||
    (variant === "highlight" && !presentation.highlight)
  )
    return {
      path: file.sourcePath,
      contentType: file.asset.mimeType ?? "video/mp4"
    };
  const range = presentation.highlight ?? {
    startMs: 0,
    endMs: capabilities.durationMs!
  };
  const durationMs = range.endMs - range.startMs;
  if (range.endMs > capabilities.durationMs! + 100 || durationMs <= 0)
    throw new PresentationMediaError("invalid_highlight", 422);
  if (variant === "bounce" && durationMs > VIDEO_BOUNCE_MAX_DURATION_MS)
    throw new PresentationMediaError("bounce_duration_exceeded", 422);
  if (durationMs > VIDEO_HIGHLIGHT_MAX_DURATION_MS)
    throw new PresentationMediaError("highlight_duration_exceeded", 422);
  return ensurePresentationDerivative(
    db,
    config,
    file,
    variant,
    key,
    "mp4",
    async (temporaryPath) => {
      const seconds = durationMs / 1000;
      const scale = `scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=${variant === "bounce" ? 480 : 1080}:${variant === "bounce" ? 480 : 1080}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
      const sourceArgs = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-threads",
        "1",
        ...LOCAL_MEDIA_INPUT_ARGS,
        "-ss",
        String(range.startMs / 1000),
        "-i",
        file.sourcePath,
        "-t",
        String(seconds)
      ];
      const encodingArgs = [
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-movflags",
        "+faststart",
        "-fs",
        String(128 * 1024 * 1024),
        "-f",
        "mp4",
        "-y",
        temporaryPath
      ];
      if (variant === "bounce") {
        const frameCount = Math.max(1, Math.round(seconds * 24));
        const forward = `[0:v:0]trim=duration=${seconds},${scale},fps=24,trim=end_frame=${frameCount},setpts=PTS-STARTPTS`;
        const filter =
          frameCount < 3
            ? `${forward}[out]`
            : `${forward},split=2[forward][reverse];[reverse]reverse,trim=start_frame=1:end_frame=${frameCount - 1},setpts=PTS-STARTPTS[backward];[forward][backward]concat=n=2:v=1:a=0[out]`;
        await withReverseSlot(() =>
          runMediaCommand(
            "ffmpeg",
            [
              ...sourceArgs.slice(0, -2),
              "-filter_complex",
              filter,
              "-map",
              "[out]",
              "-an",
              ...encodingArgs
            ],
            90_000
          )
        );
      } else {
        await runMediaCommand(
          "ffmpeg",
          [
            ...sourceArgs,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            scale,
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ac",
            "2",
            ...encodingArgs
          ],
          120_000
        );
      }
      const outputProbe = JSON.parse(
        (
          await runMediaCommand(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_entries",
              "format=duration",
              "-of",
              "json",
              temporaryPath
            ],
            10_000
          )
        ).stdout
      ) as { format?: { duration?: string } };
      const outputDuration = Number(outputProbe.format?.duration);
      const expectedDuration =
        variant === "bounce"
          ? (Math.round(seconds * 24) < 3
              ? Math.max(1, Math.round(seconds * 24))
              : Math.round(seconds * 24) * 2 - 2) / 24
          : seconds;
      if (
        !Number.isFinite(outputDuration) ||
        Math.abs(outputDuration - expectedDuration) > 0.15
      )
        throw new PresentationMediaError("incomplete_rendition", 422);
      return "video/mp4";
    }
  );
}

export async function ensurePresentationPoster({
  db,
  config,
  file,
  variant,
  key,
  size
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  variant: "full" | "highlight";
  key: string;
  size: number;
}): Promise<PresentationFile> {
  const media = await probePresentationMedia(db, file);
  if (media.kind !== "video")
    throw new PresentationMediaError("poster_not_supported");
  await verifyPresentationSource(db, file, variant, key);
  const presentation = presentationForFile(db, file);
  const startMs =
    variant === "highlight" ? (presentation.highlight?.startMs ?? 0) : 0;
  return ensurePresentationDerivative(
    db,
    config,
    file,
    variant,
    key,
    `${size}.jpg`,
    async (temporaryPath) => {
      await runMediaCommand(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-threads",
          "1",
          ...LOCAL_MEDIA_INPUT_ARGS,
          "-ss",
          String(startMs / 1000),
          "-i",
          file.sourcePath,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          `scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=${size}:${size}:force_original_aspect_ratio=decrease`,
          "-c:v",
          "mjpeg",
          "-q:v",
          "3",
          "-f",
          "image2",
          "-y",
          temporaryPath
        ],
        20_000
      );
      return "image/jpeg";
    }
  );
}

async function withReverseSlot<T>(task: () => Promise<T>): Promise<T> {
  if (reversing)
    await new Promise<void>((resolve) => reverseQueue.push(resolve));
  reversing = true;
  try {
    return await task();
  } finally {
    const next = reverseQueue.shift();
    if (next) next();
    else reversing = false;
  }
}
