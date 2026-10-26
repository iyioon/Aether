import type {
  AssetRecord,
  PresentationMediaCapabilities
} from "../../api/client";

type BounceTimeline = PresentationMediaCapabilities["bounceTimeline"];
export type BounceCodec = "hevc" | "h264";

export type PresentationVariant = "full" | "highlight" | "bounce";

export function bounceDurationExceeded(asset: AssetRecord, maximumMs?: number) {
  if (maximumMs === undefined) return false;
  const range = asset.presentation?.highlight;
  const duration = range ? range.endMs - range.startMs : asset.durationMs;
  return duration === null || duration === undefined || duration > maximumMs;
}

export function playbackVariant(
  asset: AssetRecord,
  highlightsOnly: boolean
): PresentationVariant {
  const presentation = asset.presentation;
  if (!presentation) return "full";
  if (
    presentation.loopMode === "bounce" &&
    (!presentation.highlight || highlightsOnly)
  )
    return "bounce";
  return highlightsOnly && presentation.highlight ? "highlight" : "full";
}

export function presentationPlaybackUrl(
  asset: AssetRecord,
  variant: PresentationVariant,
  codec?: BounceCodec
) {
  const key = asset.presentation?.renditionKeys[variant];
  return key
    ? `/api/assets/${encodeURIComponent(asset.id)}/playback?variant=${variant}&v=${encodeURIComponent(key)}${variant === "bounce" && codec ? `&codec=${codec}` : ""}`
    : "";
}

export function presentationPosterUrl(
  asset: AssetRecord,
  highlightsOnly: boolean,
  size = 640
) {
  const variant =
    highlightsOnly && asset.presentation?.highlight ? "highlight" : "full";
  const key = asset.presentation?.renditionKeys[variant];
  return variant === "highlight" && key
    ? `/api/assets/${encodeURIComponent(asset.id)}/presentation-poster?variant=highlight&v=${encodeURIComponent(key)}&size=${size}`
    : null;
}

export function sourceTimeForPlayback(
  time: number,
  start: number,
  end: number,
  bounce: boolean
) {
  const length = Math.max(0, end - start);
  const local = Math.max(0, time);
  return (
    start +
    Math.min(
      length,
      bounce && local > length ? Math.max(0, length * 2 - local) : local
    )
  );
}

export function sourceTimeForVideoBounce(
  time: number,
  start: number,
  end: number,
  timeline?: BounceTimeline
) {
  const count = timeline?.sourceTimesMs.length ?? 0;
  if (!timeline || count === 0) return start;
  const outputCount = count < 3 ? count : count * 2 - 2;
  let elapsed = 0;
  for (let index = 0; index < outputCount; index++) {
    const sourceIndex = index < count ? index : count * 2 - 2 - index;
    const duration = timeline.durationsMs[sourceIndex] ?? 0;
    if (
      Math.max(0, time) * 1000 < elapsed + duration - 1e-6 ||
      index === outputCount - 1
    )
      return Math.max(
        start,
        Math.min(end, timeline.sourceTimesMs[sourceIndex]! / 1000)
      );
    elapsed += duration;
  }
  return start;
}

export function videoBounceSeekTime(
  time: number,
  start: number,
  end: number,
  timeline?: BounceTimeline
) {
  if (!timeline?.sourceTimesMs.length) return 0;
  const target = Math.max(start, Math.min(end, time)) * 1000;
  let elapsed = 0;
  for (let index = 0; index < timeline.sourceTimesMs.length - 1; index++) {
    if (target < timeline.sourceTimesMs[index + 1]!) break;
    elapsed += timeline.durationsMs[index] ?? 0;
  }
  return elapsed / 1000;
}
