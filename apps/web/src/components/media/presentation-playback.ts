import type { AssetRecord } from "../../api/client";

export type PresentationVariant = "full" | "highlight" | "bounce";

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
  variant: PresentationVariant
) {
  const key = asset.presentation?.renditionKeys[variant];
  return key
    ? `/api/assets/${encodeURIComponent(asset.id)}/playback?variant=${variant}&v=${encodeURIComponent(key)}`
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

/** Source frame shown by the bounded 24fps video bounce rendition. */
export function sourceTimeForVideoBounce(
  time: number,
  start: number,
  end: number
) {
  const count = Math.max(1, Math.round(Math.max(0, end - start) * 24));
  const outputCount = count < 3 ? count : count * 2 - 2;
  const index = Math.max(
    0,
    Math.min(outputCount - 1, Math.floor(Math.max(0, time) * 24 + 1e-6))
  );
  const sourceIndex = index < count ? index : count * 2 - 2 - index;
  return Math.min(end, start + sourceIndex / 24);
}

export function videoBounceSeekTime(time: number, start: number, end: number) {
  const count = Math.max(1, Math.round(Math.max(0, end - start) * 24));
  return Math.max(0, Math.min((count - 1) / 24, time - start));
}
