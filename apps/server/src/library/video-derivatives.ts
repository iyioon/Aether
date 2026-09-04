import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
import {
  parseRangeHeader,
  sendRangeNotSatisfiable,
  type ByteRange,
  type ResolvedAssetFile
} from "./media-serving.js";
import {
  getDerivative,
  updateAssetMediaMetadata,
  upsertDerivative
} from "./repository.js";
import type { ThumbnailFile } from "./thumbnails.js";

export interface VideoPreviewFile {
  path: string;
  contentType: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface ProbeStream {
  width?: number;
  height?: number;
  codec_name?: string;
}

interface ProbePayload {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
  };
}

interface VideoMetadata {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  codec: string | null;
}

const POSTER_TIMEOUT_MS = 20_000;
const PREVIEW_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_PROCESS_OUTPUT_BYTES = 96 * 1024;
const MAX_VIDEO_PROCESSING_JOBS = 2;

const pendingPosterJobs = new Map<string, Promise<ThumbnailFile>>();
const pendingPreviewJobs = new Map<string, Promise<VideoPreviewFile>>();
const videoProcessingQueue: Array<() => void> = [];
let activeVideoProcessingJobs = 0;

export async function ensureVideoPoster({
  db,
  config,
  file,
  size
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  size: number;
}): Promise<ThumbnailFile> {
  if (file.asset.mediaType !== "video") {
    throw new UnsupportedVideoPosterError("Only video posters are available.");
  }

  const posterPath = posterPathFor(config.cacheDir, file.asset.id, file.mtimeMs, size);
  const derivativeId = stableId(
    "derivative",
    file.asset.id,
    "poster",
    String(size),
    String(file.mtimeMs)
  );
  const existing = getDerivative(db, derivativeId);

  if (existing?.status === "ready" && existsSync(posterPath)) {
    return {
      path: posterPath,
      contentType: "image/jpeg"
    };
  }

  const pending = pendingPosterJobs.get(derivativeId);

  if (pending) {
    return pending;
  }

  const job = withVideoProcessingSlot(async () =>
    generateVideoPoster({
      db,
      file,
      size,
      posterPath,
      derivativeId
    })
  ).finally(() => {
    pendingPosterJobs.delete(derivativeId);
  });

  pendingPosterJobs.set(derivativeId, job);
  return job;
}

export async function ensureVideoPreview({
  db,
  config,
  file,
  size,
  durationSeconds
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  size: number;
  durationSeconds: number;
}): Promise<VideoPreviewFile> {
  if (file.asset.mediaType !== "video") {
    throw new UnsupportedVideoPreviewError("Only video previews are available.");
  }

  const previewSize = evenPreviewSize(size);
  const previewDurationSeconds = Math.trunc(durationSeconds);
  const previewPath = previewPathFor(
    config.cacheDir,
    file.asset.id,
    file.mtimeMs,
    previewSize,
    previewDurationSeconds
  );
  const derivativeId = stableId(
    "derivative",
    file.asset.id,
    "preview",
    String(previewSize),
    String(previewDurationSeconds),
    String(file.mtimeMs)
  );
  const existing = getDerivative(db, derivativeId);

  if (existing?.status === "ready" && existsSync(previewPath)) {
    return {
      path: previewPath,
      contentType: "video/mp4"
    };
  }

  const pending = pendingPreviewJobs.get(derivativeId);

  if (pending) {
    return pending;
  }

  const job = withVideoProcessingSlot(async () =>
    generateVideoPreview({
      db,
      file,
      size: previewSize,
      durationSeconds: previewDurationSeconds,
      previewPath,
      derivativeId
    })
  ).finally(() => {
    pendingPreviewJobs.delete(derivativeId);
  });

  pendingPreviewJobs.set(derivativeId, job);
  return job;
}

async function generateVideoPoster({
  db,
  file,
  size,
  posterPath,
  derivativeId
}: {
  db: AetherDatabase;
  file: ResolvedAssetFile;
  size: number;
  posterPath: string;
  derivativeId: string;
}): Promise<ThumbnailFile> {
  await mkdir(path.dirname(posterPath), { recursive: true });
  const temporaryPath = `${posterPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    const metadata = await probeVideoMetadata(file);
    const seekSeconds = posterSeekSeconds(metadata.durationMs);
    const seekArgs = seekSeconds > 0 ? ["-ss", seekSeconds.toFixed(3)] : [];

    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      ...seekArgs,
      "-i",
      file.sourcePath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
      "-c:v",
      "mjpeg",
      "-q:v",
      "3",
      "-f",
      "image2",
      "-y",
      temporaryPath
    ], POSTER_TIMEOUT_MS);

    await rename(temporaryPath, posterPath);
    updateAssetMediaMetadata(db, {
      assetId: file.asset.id,
      ...metadata
    });
    upsertDerivative(db, {
      id: derivativeId,
      assetId: file.asset.id,
      kind: "poster",
      width: size,
      height: size,
      path: posterPath,
      sourceMtimeMs: file.mtimeMs,
      status: "ready",
      error: null,
      createdAt: new Date().toISOString()
    });

    return {
      path: posterPath,
      contentType: "image/jpeg"
    };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    upsertDerivative(db, {
      id: derivativeId,
      assetId: file.asset.id,
      kind: "poster",
      width: size,
      height: size,
      path: posterPath,
      sourceMtimeMs: file.mtimeMs,
      status: "failed",
      error: errorMessage(error),
      createdAt: new Date().toISOString()
    });
    throw error;
  }
}

async function generateVideoPreview({
  db,
  file,
  size,
  durationSeconds,
  previewPath,
  derivativeId
}: {
  db: AetherDatabase;
  file: ResolvedAssetFile;
  size: number;
  durationSeconds: number;
  previewPath: string;
  derivativeId: string;
}): Promise<VideoPreviewFile> {
  await mkdir(path.dirname(previewPath), { recursive: true });
  const temporaryPath = `${previewPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    const metadata = await probeVideoMetadata(file);
    const seekSeconds = previewSeekSeconds(metadata.durationMs, durationSeconds);
    const seekArgs = seekSeconds > 0 ? ["-ss", seekSeconds.toFixed(3)] : [];

    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      ...seekArgs,
      "-i",
      file.sourcePath,
      "-map",
      "0:v:0",
      "-t",
      String(durationSeconds),
      "-vf",
      `scale=${size}:${size}:force_original_aspect_ratio=decrease,format=yuv420p`,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "-y",
      temporaryPath
    ], PREVIEW_TIMEOUT_MS);

    await rename(temporaryPath, previewPath);
    updateAssetMediaMetadata(db, {
      assetId: file.asset.id,
      ...metadata
    });
    upsertDerivative(db, {
      id: derivativeId,
      assetId: file.asset.id,
      kind: "preview",
      width: size,
      height: durationSeconds,
      path: previewPath,
      sourceMtimeMs: file.mtimeMs,
      status: "ready",
      error: null,
      createdAt: new Date().toISOString()
    });

    return {
      path: previewPath,
      contentType: "video/mp4"
    };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    upsertDerivative(db, {
      id: derivativeId,
      assetId: file.asset.id,
      kind: "preview",
      width: size,
      height: durationSeconds,
      path: previewPath,
      sourceMtimeMs: file.mtimeMs,
      status: "failed",
      error: errorMessage(error),
      createdAt: new Date().toISOString()
    });
    throw error;
  }
}

export async function sendVideoPreview({
  reply,
  preview,
  rangeHeader
}: {
  reply: FastifyReply;
  preview: VideoPreviewFile;
  rangeHeader: string | undefined;
}): Promise<FastifyReply> {
  const fileStat = await stat(preview.path);
  const range = parseRangeHeader(rangeHeader, fileStat.size);

  if (range === "invalid") {
    return sendRangeNotSatisfiable(reply, fileStat.size);
  }

  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "private, max-age=86400");
  reply.type(preview.contentType);

  if (range) {
    return sendPreviewRange(reply, preview.path, fileStat.size, range);
  }

  reply.header("content-length", String(fileStat.size));
  return reply.send(createReadStream(preview.path));
}

export async function probeVideoMetadata(
  file: ResolvedAssetFile
): Promise<VideoMetadata> {
  if (file.asset.mediaType !== "video") {
    throw new UnsupportedVideoPosterError("Only video metadata is available.");
  }

  const result = await runMediaCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,codec_name:format=duration",
    "-of",
    "json",
    file.sourcePath
  ], PROBE_TIMEOUT_MS);
  const payload = JSON.parse(result.stdout) as ProbePayload;
  const stream = payload.streams?.[0];

  return {
    width: positiveIntegerOrNull(stream?.width),
    height: positiveIntegerOrNull(stream?.height),
    durationMs: durationMsOrNull(payload.format?.duration),
    codec: stream?.codec_name ?? null
  };
}

async function runMediaCommand(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;

      if (stdoutBytes <= MAX_PROCESS_OUTPUT_BYTES) {
        stdout.push(chunk);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;

      if (stderrBytes <= MAX_PROCESS_OUTPUT_BYTES) {
        stderr.push(chunk);
      }
    });

    child.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const stdoutText = Buffer.concat(stdout).toString("utf8");
        const stderrText = Buffer.concat(stderr).toString("utf8");

        if (timedOut) {
          reject(new MediaProcessingError(`${command} timed out.`));
          return;
        }

        if (code !== 0) {
          reject(
            new MediaProcessingError(
              stderrText.trim() || `${command} exited with code ${code ?? "unknown"}.`
            )
          );
          return;
        }

        resolve({
          stdout: stdoutText,
          stderr: stderrText
        });
      });
    });

    function finish(callback: () => void) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      callback();
    }
  });
}

async function withVideoProcessingSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeVideoProcessingJobs >= MAX_VIDEO_PROCESSING_JOBS) {
    await new Promise<void>((resolve) => {
      videoProcessingQueue.push(resolve);
    });
  }

  activeVideoProcessingJobs += 1;

  try {
    return await task();
  } finally {
    activeVideoProcessingJobs -= 1;
    videoProcessingQueue.shift()?.();
  }
}

function sendPreviewRange(
  reply: FastifyReply,
  previewPath: string,
  sizeBytes: number,
  range: ByteRange
): FastifyReply {
  const chunkSize = range.end - range.start + 1;
  reply.code(206);
  reply.header("content-range", `bytes ${range.start}-${range.end}/${sizeBytes}`);
  reply.header("content-length", String(chunkSize));
  return reply.send(
    createReadStream(previewPath, {
      start: range.start,
      end: range.end
    })
  );
}

function posterPathFor(
  cacheDir: string,
  assetId: string,
  mtimeMs: number,
  size: number
): string {
  return path.join(cacheDir, "posters", assetId, `${mtimeMs}-${size}.jpg`);
}

function previewPathFor(
  cacheDir: string,
  assetId: string,
  mtimeMs: number,
  size: number,
  durationSeconds: number
): string {
  return path.join(
    cacheDir,
    "previews",
    assetId,
    `${mtimeMs}-${size}-${durationSeconds}.mp4`
  );
}

function posterSeekSeconds(durationMs: number | null): number {
  if (!durationMs || durationMs <= 3000) {
    return 0;
  }

  return Math.min(durationMs / 4000, 3);
}

function previewSeekSeconds(
  durationMs: number | null,
  durationSeconds: number
): number {
  if (!durationMs || durationMs <= (durationSeconds + 1) * 1000) {
    return 0;
  }

  return Math.min(durationMs * 0.08 / 1000, 30);
}

function evenPreviewSize(size: number): number {
  const integerSize = Math.trunc(size);
  return integerSize % 2 === 0 ? integerSize : integerSize - 1;
}

function positiveIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function durationMsOrNull(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const seconds = Number(value);

  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1000)
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Video processing failed.";
}

export class UnsupportedVideoPosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedVideoPosterError";
  }
}

export class UnsupportedVideoPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedVideoPreviewError";
  }
}

export class MediaProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProcessingError";
  }
}
