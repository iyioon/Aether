import { replaceSourceDerivative } from "./repository-derivatives.js";
import type { UpsertDerivativeInput } from "./repository-types.js";
import {
  ensurePrivateCacheDirectory,
  openPrivateCacheFile
} from "../security/private-cache-file.js";
import { createHash } from "node:crypto";
import { chmod, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
import { ImageDerivativeError } from "./image-cache.js";
import {
  parseRangeHeader,
  sendRangeNotSatisfiable,
  resolveAssetFile,
  type ResolvedAssetFile
} from "./media-serving.js";
import { getDerivative, updateAssetMediaMetadata } from "./repository.js";
import type { ThumbnailFile } from "./thumbnails.js";
import {
  LOCAL_MEDIA_INPUT_ARGS,
  runMediaCommand,
  withVideoProcessingSlot
} from "./video-processing.js";
export { MediaProcessingError } from "./video-processing.js";

export interface VideoPreviewFile {
  path: string;
  contentType: string;
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
const VIDEO_POSTER_CACHE_VERSION = "v3";
const VIDEO_PREVIEW_CACHE_VERSION = "v4";
const MAX_PENDING_POSTER_JOBS = 32;
const MAX_PENDING_PREVIEW_JOBS = 32;

const pendingPosterJobs = new Map<string, Promise<ThumbnailFile>>();
const pendingPreviewJobs = new Map<string, Promise<VideoPreviewFile>>();
const pendingMetadataJobs = new Map<string, Promise<VideoMetadata>>();

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

  const posterPath = posterPathFor(
    config.cacheDir,
    file.asset.id,
    videoSourceKey(file),
    size
  );
  const derivativeId = stableId(
    "derivative",
    file.asset.id,
    "poster",
    VIDEO_POSTER_CACHE_VERSION,
    String(size),
    videoSourceKey(file)
  );
  await verifyVideoSource(db, file);
  const existing = getDerivative(db, derivativeId);

  if (
    existing?.status === "ready" &&
    (await cachedVideoFileExists(posterPath, config.cacheDir))
  ) {
    return {
      path: posterPath,
      contentType: "image/jpeg"
    };
  }

  const jobKey = `${config.cacheDir}:${derivativeId}`;
  const pending = pendingPosterJobs.get(jobKey);

  if (pending) {
    return pending;
  }
  if (pendingPosterJobs.size >= MAX_PENDING_POSTER_JOBS)
    throw new ImageDerivativeError("processing_busy", 503);

  const job = withVideoProcessingSlot(async () => {
    await ensurePrivateCacheDirectory(
      config.cacheDir,
      "posters",
      file.asset.id
    );
    return generateVideoPoster({
      db,
      file,
      size,
      posterPath,
      derivativeId
    });
  }).finally(() => {
    pendingPosterJobs.delete(jobKey);
  });

  pendingPosterJobs.set(jobKey, job);
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
    throw new UnsupportedVideoPreviewError(
      "Only video previews are available."
    );
  }

  const previewSize = evenPreviewSize(size);
  const previewDurationSeconds = Math.trunc(durationSeconds);
  const previewPath = previewPathFor(
    config.cacheDir,
    file.asset.id,
    videoSourceKey(file),
    previewSize,
    previewDurationSeconds
  );
  const derivativeId = stableId(
    "derivative",
    file.asset.id,
    "preview",
    VIDEO_PREVIEW_CACHE_VERSION,
    String(previewSize),
    String(previewDurationSeconds),
    videoSourceKey(file)
  );
  await verifyVideoSource(db, file);
  const existing = getDerivative(db, derivativeId);

  if (
    existing?.status === "ready" &&
    (await cachedVideoFileExists(previewPath, config.cacheDir))
  ) {
    return {
      path: previewPath,
      contentType: "video/mp4"
    };
  }

  const jobKey = `${config.cacheDir}:${derivativeId}`;
  const pending = pendingPreviewJobs.get(jobKey);

  if (pending) {
    return pending;
  }
  if (pendingPreviewJobs.size >= MAX_PENDING_PREVIEW_JOBS)
    throw new ImageDerivativeError("processing_busy", 503);

  const job = withVideoProcessingSlot(async () => {
    await ensurePrivateCacheDirectory(
      config.cacheDir,
      "previews",
      file.asset.id
    );
    return generateVideoPreview({
      db,
      file,
      size: previewSize,
      durationSeconds: previewDurationSeconds,
      previewPath,
      derivativeId
    });
  }).finally(() => {
    pendingPreviewJobs.delete(jobKey);
  });

  pendingPreviewJobs.set(jobKey, job);
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
  const temporaryPath = `${posterPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await verifyVideoSource(db, file);
    const metadata = await cachedOrProbeVideoMetadata(file);

    await runMediaCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        ...LOCAL_MEDIA_INPUT_ARGS,
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
      ],
      POSTER_TIMEOUT_MS
    );

    await verifyVideoSource(db, file);
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, posterPath);
    await verifyVideoSource(db, file);
    updateAssetMediaMetadata(db, {
      assetId: file.asset.id,
      ...metadata
    });
    await recordVideoDerivative(db, file, {
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
    await Promise.all([
      unlink(temporaryPath).catch(() => undefined),
      unlink(posterPath).catch(() => undefined)
    ]);
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
  const temporaryPath = `${previewPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await verifyVideoSource(db, file);
    const metadata = await cachedOrProbeVideoMetadata(file);

    await runMediaCommand(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        ...LOCAL_MEDIA_INPUT_ARGS,
        "-i",
        file.sourcePath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-t",
        String(durationSeconds),
        "-vf",
        `scale=${size}:${size}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "-y",
        temporaryPath
      ],
      PREVIEW_TIMEOUT_MS
    );

    await verifyVideoSource(db, file);
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, previewPath);
    await verifyVideoSource(db, file);
    updateAssetMediaMetadata(db, {
      assetId: file.asset.id,
      ...metadata
    });
    await recordVideoDerivative(db, file, {
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
    await Promise.all([
      unlink(temporaryPath).catch(() => undefined),
      unlink(previewPath).catch(() => undefined)
    ]);
    throw error;
  }
}

export async function sendVideoPreview({
  reply,
  preview,
  rangeHeader,
  cacheDir
}: {
  reply: FastifyReply;
  preview: VideoPreviewFile;
  rangeHeader: string | undefined;
  cacheDir: string;
}): Promise<FastifyReply> {
  const handle = await openPrivateCacheFile(preview.path, cacheDir);
  const fileStat = await handle.stat().catch(async (error: unknown) => {
    await handle.close();
    throw error;
  });
  const range = parseRangeHeader(rangeHeader, fileStat.size);

  if (range === "invalid") {
    await handle.close();
    return sendRangeNotSatisfiable(reply, fileStat.size);
  }

  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "private, no-cache");
  reply.type(preview.contentType);

  const etag = `"${createHash("sha256").update(`${preview.path}:${fileStat.size}:${fileStat.mtimeMs}`).digest("hex").slice(0, 32)}"`;
  reply.header("etag", etag);
  if (
    !range &&
    reply.request.headers["if-none-match"]
      ?.split(",")
      .some(
        (candidate) =>
          candidate.trim().replace(/^W\//, "") === etag ||
          candidate.trim() === "*"
      )
  ) {
    await handle.close();
    return reply.code(304).send();
  }
  if (range) {
    reply
      .code(206)
      .header(
        "content-range",
        `bytes ${range.start}-${range.end}/${fileStat.size}`
      )
      .header("content-length", String(range.end - range.start + 1));
  } else reply.header("content-length", String(fileStat.size));
  if (reply.request.method === "HEAD") {
    await handle.close();
    return reply.send();
  }
  return reply.send(
    handle.createReadStream(
      range ? { start: range.start, end: range.end } : undefined
    )
  );
}

export async function probeVideoMetadata(
  file: ResolvedAssetFile
): Promise<VideoMetadata> {
  if (file.asset.mediaType !== "video") {
    throw new UnsupportedVideoPosterError("Only video metadata is available.");
  }

  const result = await runMediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      ...LOCAL_MEDIA_INPUT_ARGS,
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,codec_name:format=duration",
      "-of",
      "json",
      file.sourcePath
    ],
    PROBE_TIMEOUT_MS
  );
  const payload = JSON.parse(result.stdout) as ProbePayload;
  const stream = payload.streams?.[0];

  return {
    width: positiveIntegerOrNull(stream?.width),
    height: positiveIntegerOrNull(stream?.height),
    durationMs: durationMsOrNull(payload.format?.duration),
    codec: stream?.codec_name ?? null
  };
}

async function cachedOrProbeVideoMetadata(
  file: ResolvedAssetFile
): Promise<VideoMetadata> {
  const { width, height, durationMs, codec } = file.asset;

  if (
    file.asset.indexedMtimeMs === file.mtimeMs &&
    file.asset.indexedSizeBytes === file.sizeBytes &&
    width !== null &&
    height !== null &&
    durationMs !== null &&
    codec !== null
  ) {
    return { width, height, durationMs, codec };
  }

  const cacheKey = `${file.asset.id}:${file.sizeBytes}:${file.mtimeMs}`;
  const pending = pendingMetadataJobs.get(cacheKey);

  if (pending) {
    return pending;
  }

  const job = probeVideoMetadata(file).finally(() => {
    pendingMetadataJobs.delete(cacheKey);
  });
  pendingMetadataJobs.set(cacheKey, job);
  return job;
}

function posterPathFor(
  cacheDir: string,
  assetId: string,
  sourceKey: string,
  size: number
): string {
  return path.join(
    cacheDir,
    "posters",
    assetId,
    `${sourceKey}-${VIDEO_POSTER_CACHE_VERSION}-${size}.jpg`
  );
}

function previewPathFor(
  cacheDir: string,
  assetId: string,
  sourceKey: string,
  size: number,
  durationSeconds: number
): string {
  return path.join(
    cacheDir,
    "previews",
    assetId,
    `${sourceKey}-${VIDEO_PREVIEW_CACHE_VERSION}-${size}-${durationSeconds}.mp4`
  );
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

function videoSourceKey(file: ResolvedAssetFile): string {
  return stableId(
    "video-source-v1",
    file.asset.id,
    String(file.mtimeMs),
    String(file.sizeBytes),
    String(file.device ?? ""),
    String(file.inode ?? "")
  );
}

async function verifyVideoSource(
  db: AetherDatabase,
  file: ResolvedAssetFile
): Promise<void> {
  const current = await resolveAssetFile(db, file.asset.id);
  if (
    !current ||
    current.sourcePath !== file.sourcePath ||
    current.mtimeMs !== file.mtimeMs ||
    current.sizeBytes !== file.sizeBytes ||
    current.device !== file.device ||
    current.inode !== file.inode
  )
    throw new UnsupportedVideoPreviewError(
      "Video source changed during processing."
    );
}

async function cachedVideoFileExists(
  filePath: string,
  cacheDir: string
): Promise<boolean> {
  try {
    const handle = await openPrivateCacheFile(filePath, cacheDir);
    await handle.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function recordVideoDerivative(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  input: UpsertDerivativeInput
): Promise<void> {
  const obsolete = replaceSourceDerivative(db, input, videoSourceKey(file));
  const directory = path.dirname(input.path);
  const kind = path.basename(path.dirname(directory));
  const cacheDir = path.dirname(path.dirname(directory));
  await ensurePrivateCacheDirectory(cacheDir, kind, file.asset.id);
  for (const entry of obsolete) {
    if (path.dirname(entry) === directory)
      await unlink(entry).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
}
