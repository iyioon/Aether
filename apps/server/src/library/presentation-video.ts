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
  getPresentationVideoBouncePlan
} from "./presentation-media.js";
import { LOCAL_MEDIA_INPUT_ARGS, runMediaCommand } from "./video-processing.js";
import {
  generateLosslessBounce,
  VIDEO_BOUNCE_MAX_OUTPUT_BYTES
} from "./presentation-bounce.js";

export const VIDEO_HIGHLIGHT_MAX_DURATION_MS = 120_000;
export type { PresentationFile } from "./presentation-cache.js";

export async function ensurePresentationVideo({
  db,
  config,
  file,
  variant,
  key,
  codec = "hevc"
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  variant: PresentationVariant;
  key: string;
  codec?: "hevc" | "h264";
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
  const bouncePlan =
    variant === "bounce"
      ? await getPresentationVideoBouncePlan(db, file, range)
      : null;
  if (durationMs > VIDEO_HIGHLIGHT_MAX_DURATION_MS)
    throw new PresentationMediaError("highlight_duration_exceeded", 422);
  return ensurePresentationDerivative(
    db,
    config,
    file,
    variant,
    key,
    variant === "bounce" && codec === "h264" ? "h264.mp4" : "mp4",
    async (temporaryPath) => {
      const seconds = durationMs / 1000;
      if (bouncePlan && capabilities.videoBounce) {
        await generateLosslessBounce(
          file.sourcePath,
          temporaryPath,
          bouncePlan,
          capabilities.videoBounce,
          codec
        );
        return "video/mp4";
      }
      const scale =
        "scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=1080:1080:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p";
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
      const expectedDuration = seconds;
      if (
        !Number.isFinite(outputDuration) ||
        Math.abs(outputDuration - expectedDuration) > 0.15
      )
        throw new PresentationMediaError("incomplete_rendition", 422);
      return "video/mp4";
    },
    variant === "bounce" ? VIDEO_BOUNCE_MAX_OUTPUT_BYTES : undefined
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
