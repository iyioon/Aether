import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { removePresentationDerivativeFiles } from "./derivative-cache.js";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import type { ResolvedAssetFile } from "./media-serving.js";
import {
  ANIMATION_LIMITS,
  probePresentationMedia,
  type AnimationProbe
} from "./presentation-media.js";
import {
  ensurePresentationDerivative,
  presentationForFile,
  type PresentationFile,
  presentationCacheDirectory,
  PresentationMediaError,
  recordPresentationFiles,
  requireBoundedFile,
  safeCachedFile,
  verifyPresentationSource
} from "./presentation-cache.js";
import {
  LOCAL_MEDIA_INPUT_ARGS,
  runMediaCommand,
  withVideoProcessingSlot
} from "./video-processing.js";

export interface AnimationFrame {
  startMs: number;
  durationMs: number;
  atlas: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AnimationManifest {
  kind: "animation";
  durationMs: number;
  width: number;
  height: number;
  frames: AnimationFrame[];
  atlases: Array<{ url: string; width: number; height: number }>;
}
interface CachedAnimation {
  manifest: AnimationManifest;
  atlasPaths: string[];
}
const jobsByDatabase = new WeakMap<
  AetherDatabase,
  Map<string, Promise<CachedAnimation>>
>();
let pendingJobs = 0;

export async function ensurePresentationAnimation({
  db,
  config,
  file,
  key
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  key: string;
}): Promise<CachedAnimation> {
  const media = await probePresentationMedia(db, file);
  if (!media.animation)
    throw new PresentationMediaError("animation_not_supported");
  await verifyPresentationSource(db, file, "full", key);
  const directory = await presentationCacheDirectory(config, file.asset.id);
  const manifestPath = path.join(directory, `${key}-animation.json`);
  if (await safeCachedFile(manifestPath)) {
    const cached = await readCachedAnimation(
      manifestPath,
      directory,
      key,
      file.asset.id
    );
    if (cached) return cached;
  }
  let jobs = jobsByDatabase.get(db);
  if (!jobs) {
    jobs = new Map();
    jobsByDatabase.set(db, jobs);
  }
  const existing = jobs.get(manifestPath);
  if (existing) return existing;
  if (pendingJobs >= 8)
    throw new PresentationMediaError("processing_busy", 503);
  pendingJobs += 1;
  const job = withVideoProcessingSlot(() =>
    generateAnimation(db, file, media.animation!, key, directory, manifestPath)
  ).finally(() => {
    jobs.delete(manifestPath);
    pendingJobs -= 1;
  });
  jobs.set(manifestPath, job);
  return job;
}

export async function ensurePresentationAnimationPoster({
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
  await verifyPresentationSource(db, file, variant, key);
  const presentation = presentationForFile(db, file);
  const animation = await ensurePresentationAnimation({
    db,
    config,
    file,
    key: presentation.renditionKeys.full
  });
  const time =
    variant === "highlight" ? (presentation.highlight?.startMs ?? 0) : 0;
  if (time >= animation.manifest.durationMs)
    throw new PresentationMediaError("invalid_highlight", 422);
  const frame = animation.manifest.frames.find(
    (candidate) =>
      time >= candidate.startMs &&
      time < candidate.startMs + candidate.durationMs
  );
  if (!frame) throw new PresentationMediaError("animation_frame_mismatch");
  const atlasPath = animation.atlasPaths[frame.atlas]!;
  return ensurePresentationDerivative(
    db,
    config,
    file,
    variant,
    key,
    `${size}.png`,
    async (temporaryPath) => {
      await sharp(atlasPath, { limitInputPixels: 2048 ** 2 })
        .extract({
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height
        })
        .resize({
          width: size,
          height: size,
          fit: "inside",
          withoutEnlargement: true
        })
        .timeout({ seconds: 20 })
        .png()
        .toFile(temporaryPath);
      return "image/png";
    }
  );
}

async function generateAnimation(
  db: AetherDatabase,
  file: ResolvedAssetFile,
  probe: AnimationProbe,
  key: string,
  directory: string,
  manifestPath: string
): Promise<CachedAnimation> {
  const workDirectory = await mkdtemp(path.join(directory, "work-"));
  const deadline = Date.now() + 120_000;
  const published: string[] = [];
  try {
    const images =
      probe.decoder === "sharp"
        ? await sharpFrames(file, probe, workDirectory)
        : await ffmpegFrames(file, probe, workDirectory);
    const frameCount = probe.delays.length;
    if (images.frames && images.frames.length !== frameCount)
      throw new PresentationMediaError("animation_frame_mismatch");
    const frames: AnimationFrame[] = [];
    const atlases: AnimationManifest["atlases"] = [];
    const atlasPaths: string[] = [];
    let startMs = 0;
    let outputBytes = 0;
    for (let offset = 0; offset < frameCount; offset += 16) {
      if (Date.now() >= deadline)
        throw new PresentationMediaError("processing_timeout", 503);
      const batch = images.frameStorePath
        ? await Promise.all(
            Array.from(
              { length: Math.min(16, frameCount - offset) },
              (_, index) =>
                readDecodedFrame(images.frameStorePath!, offset + index)
            )
          )
        : images.frames!.slice(offset, offset + 16);
      const columns = Math.min(4, batch.length);
      const rows = Math.ceil(batch.length / 4);
      const atlasIndex = atlases.length;
      const name = `${key}-atlas-${atlasIndex}.png`;
      const temporaryPath = path.join(workDirectory, name);
      await sharp({
        create: {
          width: images.width * columns,
          height: images.height * rows,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
        .composite(
          batch.map((input, index) => ({
            input,
            left: (index % 4) * images.width,
            top: Math.floor(index / 4) * images.height,
            ...(probe.decoder === "sharp"
              ? {
                  raw: {
                    width: images.width,
                    height: images.height,
                    channels: 4 as const
                  }
                }
              : {})
          }))
        )
        .timeout({
          seconds: Math.min(
            20,
            Math.max(1, Math.ceil((deadline - Date.now()) / 1000))
          )
        })
        .png()
        .toFile(temporaryPath);
      await requireBoundedFile(temporaryPath, ANIMATION_LIMITS.outputBytes);
      outputBytes += (await stat(temporaryPath)).size;
      if (outputBytes > ANIMATION_LIMITS.outputBytes)
        throw new PresentationMediaError("presentation_limit_exceeded", 422);
      atlasPaths.push(path.join(directory, name));
      atlases.push({
        url: `/api/assets/${encodeURIComponent(file.asset.id)}/animation/atlases/${atlasIndex}?v=${key}`,
        width: images.width * columns,
        height: images.height * rows
      });
      batch.forEach((_, index) => {
        const durationMs = probe.delays[offset + index]!;
        frames.push({
          startMs,
          durationMs,
          atlas: atlasIndex,
          x: (index % 4) * images.width,
          y: Math.floor(index / 4) * images.height,
          width: images.width,
          height: images.height
        });
        startMs += durationMs;
      });
    }
    if (Date.now() >= deadline)
      throw new PresentationMediaError("processing_timeout", 503);
    const manifest: AnimationManifest = {
      kind: "animation",
      durationMs: startMs,
      width: images.width,
      height: images.height,
      frames,
      atlases
    };
    const temporaryManifest = path.join(workDirectory, "manifest.json");
    await writeFile(temporaryManifest, JSON.stringify(manifest), {
      mode: 0o600
    });
    await verifyPresentationSource(db, file, "full", key);
    for (const destination of atlasPaths) {
      await rename(
        path.join(workDirectory, path.basename(destination)),
        destination
      );
      published.push(destination);
    }
    await rename(temporaryManifest, manifestPath);
    published.push(manifestPath);
    await verifyPresentationSource(db, file, "full", key);
    const obsolete = recordPresentationFiles(db, file, "animation", key, [
      manifestPath,
      ...atlasPaths
    ]);
    await removePresentationDerivativeFiles(
      path.dirname(path.dirname(directory)),
      obsolete
    ).catch(() => undefined);
    return { manifest, atlasPaths };
  } catch (error) {
    await Promise.all(
      published.map((destination) => rm(destination, { force: true }))
    );
    throw error;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

interface DecodedAnimation {
  frames?: string[];
  frameStorePath?: string;
  width: number;
  height: number;
}
async function sharpFrames(
  file: ResolvedAssetFile,
  probe: AnimationProbe,
  directory: string
): Promise<DecodedAnimation> {
  const frameStorePath = path.join(directory, "frames.tiff");
  // Keep composed frames on disk so atlas generation holds one batch in memory.
  const info = await sharp(file.sourcePath, {
    animated: true,
    limitInputPixels: ANIMATION_LIMITS.inputPixels
  })
    .resize({
      width: ANIMATION_LIMITS.frameSize,
      height: ANIMATION_LIMITS.frameSize,
      fit: "inside",
      withoutEnlargement: true
    })
    .ensureAlpha()
    .timeout({ seconds: 60 })
    .tiff({ compression: "none" })
    .toFile(frameStorePath);
  const height =
    info.pageHeight ?? Math.trunc(info.height / probe.delays.length);
  await requireBoundedFile(
    frameStorePath,
    ANIMATION_LIMITS.inputPixels * 4 + 2 * 1024 * 1024
  );
  if (info.height !== height * probe.delays.length)
    throw new PresentationMediaError("animation_frame_mismatch");
  return { width: info.width, height, frameStorePath };
}
async function readDecodedFrame(
  frameStorePath: string,
  index: number
): Promise<Buffer> {
  return sharp(frameStorePath, {
    page: index,
    pages: 1,
    limitInputPixels: ANIMATION_LIMITS.frameSize ** 2
  })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function ffmpegFrames(
  file: ResolvedAssetFile,
  probe: AnimationProbe,
  directory: string
): Promise<DecodedAnimation> {
  const scale = `scale=${Math.min(ANIMATION_LIMITS.frameSize, probe.width)}:${Math.min(ANIMATION_LIMITS.frameSize, probe.height)}:force_original_aspect_ratio=decrease,setsar=1,format=rgba`;
  const filterArgs =
    probe.alphaStreamIndex === null
      ? ["-map", `0:${probe.streamIndex}`, "-vf", scale]
      : [
          "-filter_complex",
          `[0:${probe.streamIndex}][0:${probe.alphaStreamIndex}]alphamerge,${scale}[frames]`,
          "-map",
          "[frames]"
        ];
  await runMediaCommand(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-threads",
      "1",
      ...LOCAL_MEDIA_INPUT_ARGS,
      "-i",
      file.sourcePath,
      ...filterArgs,
      "-frames:v",
      String(ANIMATION_LIMITS.frames + 1),
      "-fps_mode",
      "passthrough",
      "-c:v",
      "png",
      "-threads",
      "1",
      "-y",
      path.join(directory, "frame-%04d.png")
    ],
    60_000
  );
  const names = (await readdir(directory))
    .filter((name) => /^frame-\d{4}\.png$/.test(name))
    .sort();
  if (names.length !== probe.delays.length)
    throw new PresentationMediaError("animation_frame_mismatch");
  const metadata = await sharp(path.join(directory, names[0]!)).metadata();
  if (!metadata.width || !metadata.height)
    throw new PresentationMediaError("media_decode_failed");
  return {
    width: metadata.width,
    height: metadata.height,
    frames: names.map((name) => path.join(directory, name))
  };
}

async function readCachedAnimation(
  manifestPath: string,
  directory: string,
  key: string,
  assetId: string
): Promise<CachedAnimation | null> {
  try {
    if ((await stat(manifestPath)).size > 128 * 1024) return null;
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as AnimationManifest;
    if (
      manifest.kind !== "animation" ||
      !Array.isArray(manifest.frames) ||
      manifest.frames.length > ANIMATION_LIMITS.frames ||
      !Array.isArray(manifest.atlases) ||
      manifest.atlases.length !== Math.ceil(manifest.frames.length / 16)
    )
      return null;
    if (
      !Number.isSafeInteger(manifest.width) ||
      !Number.isSafeInteger(manifest.height) ||
      manifest.width < 1 ||
      manifest.height < 1 ||
      manifest.width > ANIMATION_LIMITS.frameSize ||
      manifest.height > ANIMATION_LIMITS.frameSize ||
      manifest.frames.length < 1
    )
      return null;
    let timeMs = 0;
    for (const [index, frame] of manifest.frames.entries()) {
      if (
        !Number.isSafeInteger(frame.durationMs) ||
        frame.durationMs < 1 ||
        frame.startMs !== timeMs ||
        frame.width !== manifest.width ||
        frame.height !== manifest.height ||
        frame.atlas !== Math.floor(index / 16) ||
        frame.x !== (index % 4) * manifest.width ||
        frame.y !== Math.floor((index % 16) / 4) * manifest.height
      )
        return null;
      timeMs += frame.durationMs;
    }
    if (manifest.durationMs !== timeMs || timeMs > ANIMATION_LIMITS.durationMs)
      return null;
    for (const [index, atlas] of manifest.atlases.entries()) {
      const count = Math.min(16, manifest.frames.length - index * 16);
      if (
        atlas.width !== Math.min(4, count) * manifest.width ||
        atlas.height !== Math.ceil(count / 4) * manifest.height
      )
        return null;
      atlas.url = `/api/assets/${encodeURIComponent(assetId)}/animation/atlases/${index}?v=${key}`;
    }
    const atlasPaths = manifest.atlases.map((_, index) =>
      path.join(directory, `${key}-atlas-${index}.png`)
    );
    if (!(await Promise.all(atlasPaths.map(safeCachedFile))).every(Boolean))
      return null;
    await chmod(manifestPath, 0o600);
    return { manifest, atlasPaths };
  } catch {
    return null;
  }
}
