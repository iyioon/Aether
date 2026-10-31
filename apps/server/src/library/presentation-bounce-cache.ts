import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { openPrivateCacheFile } from "../security/private-cache-file.js";
import { openAssetFile, type ResolvedAssetFile } from "./media-serving.js";
import { getDerivative } from "./repository.js";
import { stableId } from "./ids.js";
import { removePresentationDerivativeFiles } from "./derivative-cache.js";
import {
  presentationForFile,
  recordPresentationFiles,
  verifyPresentationSource
} from "./presentation-cache.js";
import {
  VIDEO_BOUNCE_MAX_DURATION_MS,
  VIDEO_BOUNCE_MAX_FRAMES,
  VIDEO_BOUNCE_MAX_OUTPUT_BYTES,
  type VideoBouncePlan
} from "./presentation-bounce.js";

const MAX_METADATA_BYTES = 256 * 1024;
const Fingerprint = z.strictObject({
  dev: z.string().regex(/^\d{1,32}$/),
  ino: z.string().regex(/^\d{1,32}$/),
  size: z.string().regex(/^\d{1,32}$/),
  mtimeNs: z.string().regex(/^\d{1,32}$/),
  ctimeNs: z.string().regex(/^\d{1,32}$/)
});
const Metadata = z.strictObject({
  version: z.literal(1),
  key: z.string().regex(/^[a-f0-9]{32}$/),
  codec: z.enum(["hevc", "h264"]),
  source: Fingerprint,
  rendition: Fingerprint,
  media: z.strictObject({
    width: z.number().int().positive().max(32768),
    height: z.number().int().positive().max(32768),
    durationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    hasAudio: z.boolean(),
    maxBounceDurationMs: z
      .number()
      .int()
      .positive()
      .max(VIDEO_BOUNCE_MAX_DURATION_MS)
  }),
  range: z.strictObject({
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive()
  }),
  timeline: z.strictObject({
    sourceTimesMs: z
      .array(z.number().finite().nonnegative())
      .min(1)
      .max(VIDEO_BOUNCE_MAX_FRAMES),
    durationsMs: z
      .array(z.number().finite().positive())
      .min(1)
      .max(VIDEO_BOUNCE_MAX_FRAMES)
  })
});
type BounceMetadata = z.infer<typeof Metadata>;
type Codec = BounceMetadata["codec"];
type SourceMedia = BounceMetadata["media"];

export function bounceCacheSuffix(codec: Codec): string {
  return codec === "h264" ? "h264.mp4" : "mp4";
}

function fingerprint(info: BigIntStats): z.infer<typeof Fingerprint> {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
    ctimeNs: String(info.ctimeNs)
  };
}
function sameFingerprint(
  left: z.infer<typeof Fingerprint>,
  right: z.infer<typeof Fingerprint>
): boolean {
  return Object.keys(left).every(
    (key) => left[key as keyof typeof left] === right[key as keyof typeof right]
  );
}
async function sourceFingerprint(file: ResolvedAssetFile) {
  const handle = await openAssetFile(file);
  try {
    return fingerprint(await handle.stat({ bigint: true }));
  } finally {
    await handle.close();
  }
}
async function renditionFingerprint(destination: string, config: AppConfig) {
  const handle = await openPrivateCacheFile(destination, config.cacheDir);
  try {
    const info = await handle.stat({ bigint: true });
    if (info.size <= 0 || info.size > BigInt(VIDEO_BOUNCE_MAX_OUTPUT_BYTES))
      return null;
    return fingerprint(info);
  } finally {
    await handle.close();
  }
}

function validTimeline(data: BounceMetadata): boolean {
  const { range, timeline, media } = data;
  const times = timeline.sourceTimesMs;
  const durations = timeline.durationsMs;
  if (
    media.width * media.height > 64_000_000 ||
    range.endMs <= range.startMs ||
    range.endMs > media.durationMs + 1 ||
    range.endMs - range.startMs > VIDEO_BOUNCE_MAX_DURATION_MS ||
    times.length !== durations.length ||
    Math.abs(times[0]! - range.startMs) > 0.001
  )
    return false;
  return times.every((time, index) => {
    const end = time + durations[index]!;
    const next = times[index + 1];
    return (
      durations[index]! >= 0.001 &&
      end <= range.endMs + 0.001 &&
      (next === undefined
        ? Math.abs(end - range.endMs) <= 1
        : next > time && Math.abs(end - next) <= 0.001)
    );
  });
}

/** Optional metadata is used only for the exact registered source and rendition. */
export async function readBounceCache(
  db: AetherDatabase,
  config: AppConfig,
  file: ResolvedAssetFile,
  key: string,
  codec: Codec
): Promise<{ validFile: boolean; metadata: BounceMetadata | null }> {
  const fallback = { validFile: true, metadata: null };
  if (
    !/^[a-zA-Z0-9_-]{1,256}$/.test(file.asset.id) ||
    !/^[a-f0-9]{32}$/.test(key)
  )
    return { validFile: false, metadata: null };
  const suffix = bounceCacheSuffix(codec);
  const variant = `bounce-${suffix}`;
  const destination = path.join(
    config.cacheDir,
    "presentations",
    file.asset.id,
    `${key}-${suffix}`
  );
  const metadataPath = `${destination}.json`;
  const registered = (index: number, expectedPath: string) => {
    const entry = getDerivative(
      db,
      stableId("derivative", file.asset.id, variant, key, String(index))
    );
    return (
      entry?.status === "ready" &&
      entry.assetId === file.asset.id &&
      entry.kind === `presentation:${variant}:${key}:${index}` &&
      entry.sourceMtimeMs === file.mtimeMs &&
      entry.path === expectedPath
    );
  };
  if (!registered(0, destination)) return { validFile: false, metadata: null };
  if (!registered(1, metadataPath)) return fallback;
  let data: BounceMetadata;
  let matchedMetadata = false;
  try {
    const handle = await openPrivateCacheFile(metadataPath, config.cacheDir);
    try {
      const before = await handle.stat({ bigint: true });
      if (before.size <= 0 || before.size > BigInt(MAX_METADATA_BYTES))
        return fallback;
      const buffer = Buffer.alloc(Number(before.size) + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length
        );
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (
        length !== Number(before.size) ||
        !sameFingerprint(
          fingerprint(before),
          fingerprint(await handle.stat({ bigint: true }))
        )
      )
        return fallback;
      const parsed = Metadata.safeParse(
        JSON.parse(buffer.subarray(0, length).toString("utf8"))
      );
      if (!parsed.success || !validTimeline(parsed.data)) return fallback;
      data = parsed.data;
    } finally {
      await handle.close();
    }
    const presentation = presentationForFile(db, file);
    const range = presentation.highlight ?? {
      startMs: 0,
      endMs: data.media.durationMs
    };
    if (
      data.key !== key ||
      data.codec !== codec ||
      presentation.renditionKeys.bounce !== key ||
      data.range.startMs !== range.startMs ||
      data.range.endMs !== range.endMs
    )
      return fallback;
    matchedMetadata = true;
    const rendition = await renditionFingerprint(destination, config);
    if (
      !rendition ||
      !sameFingerprint(data.rendition, rendition) ||
      !sameFingerprint(data.source, await sourceFingerprint(file))
    )
      return { validFile: false, metadata: null };
    await verifyPresentationSource(db, file, "bounce", key);
    return { validFile: true, metadata: data };
  } catch {
    return matchedMetadata ? { validFile: false, metadata: null } : fallback;
  }
}

/** Published alongside the MP4 and registered by its existing shared cache job. */
export async function publishBounceCache(
  config: AppConfig,
  file: ResolvedAssetFile,
  destination: string,
  key: string,
  codec: Codec,
  media: SourceMedia,
  range: BounceMetadata["range"],
  plan: VideoBouncePlan
): Promise<string[]> {
  const metadataPath = `${destination}.json`;
  const temporaryPath = `${metadataPath}.${randomUUID()}.tmp`;
  try {
    const rendition = await renditionFingerprint(destination, config);
    if (!rendition) return [];
    const data: BounceMetadata = {
      version: 1,
      key,
      codec,
      source: await sourceFingerprint(file),
      rendition,
      media,
      range,
      timeline: {
        sourceTimesMs: plan.sourceTimesMs,
        durationsMs: plan.durationsMs
      }
    };
    if (!Metadata.safeParse(data).success || !validTimeline(data)) return [];
    const content = JSON.stringify(data);
    if (Buffer.byteLength(content) > MAX_METADATA_BYTES) return [];
    await writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, metadataPath);
    return [metadataPath];
  } catch {
    return [];
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/** Older ready renditions acquire optional metadata after their normal analysis. */
export async function backfillBounceCache(
  db: AetherDatabase,
  config: AppConfig,
  file: ResolvedAssetFile,
  key: string,
  media: SourceMedia,
  range: BounceMetadata["range"],
  plan: VideoBouncePlan
): Promise<void> {
  for (const codec of ["hevc", "h264"] as const) {
    const suffix = bounceCacheSuffix(codec);
    const variant = `bounce-${suffix}`;
    const id = (index: number) =>
      stableId("derivative", file.asset.id, variant, key, String(index));
    if (getDerivative(db, id(1))) continue;
    const entry = getDerivative(db, id(0));
    const destination = path.join(
      config.cacheDir,
      "presentations",
      file.asset.id,
      `${key}-${suffix}`
    );
    if (
      !entry ||
      entry.path !== destination ||
      entry.status !== "ready" ||
      entry.sourceMtimeMs !== file.mtimeMs ||
      entry.kind !== `presentation:${variant}:${key}:0`
    )
      continue;
    let companions: string[] = [];
    try {
      await verifyPresentationSource(db, file, "bounce", key);
      companions = await publishBounceCache(
        config,
        file,
        destination,
        key,
        codec,
        media,
        range,
        plan
      );
      if (!companions.length) continue;
      await verifyPresentationSource(db, file, "bounce", key);
      const obsolete = recordPresentationFiles(db, file, variant, key, [
        destination,
        ...companions
      ]);
      await removePresentationDerivativeFiles(config.cacheDir, obsolete).catch(
        () => undefined
      );
    } catch {
      await Promise.all(companions.map((entry) => rm(entry, { force: true })));
    }
  }
}
