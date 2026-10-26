import { createHash } from "node:crypto";

export interface PresentationFraming {
  fit: "auto" | "contain" | "cover";
  focalX: number;
  focalY: number;
  zoom: number;
}

export interface PresentationValues extends PresentationFraming {
  highlight: { startMs: number; endMs: number } | null;
  aspectFraming?: Partial<
    Record<"Square" | "Portrait" | "Landscape", PresentationFraming>
  >;
  feedFraming?: Partial<Record<"portrait" | "landscape", PresentationFraming>>;
  playbackRate: number;
  loopMode: "repeat" | "bounce";
}

export interface MediaPresentation extends PresentationValues {
  revision: number;
  renditionKeys: { full: string; highlight: string; bounce: string };
}

export const PRESENTATION_PLAYBACK_RATES = [
  0.5, 0.75, 1, 1.25, 1.5, 2
] as const;

export function defaultPresentationValues(): PresentationValues {
  return {
    highlight: null,
    fit: "auto",
    focalX: 0.5,
    focalY: 0.5,
    zoom: 1,
    playbackRate: 1,
    loopMode: "repeat"
  };
}

export function getPresentationRenditionKeys(
  asset: { id: string; mtimeMs: number; sizeBytes: number },
  values: PresentationValues
): MediaPresentation["renditionKeys"] {
  const identity = [
    "presentation-v2",
    asset.id,
    asset.mtimeMs,
    asset.sizeBytes
  ];
  const key = (...variant: unknown[]) =>
    createHash("sha256")
      .update(JSON.stringify([...identity, ...variant]))
      .digest("hex")
      .slice(0, 32);
  const range = values.highlight
    ? [values.highlight.startMs, values.highlight.endMs]
    : null;
  return {
    full: key("full"),
    highlight: key("highlight", range),
    bounce: key("bounce-lossless-v3", range, values.loopMode)
  };
}

export function mediaPresentation(
  asset: { id: string; mtimeMs: number; sizeBytes: number },
  values = defaultPresentationValues(),
  revision = 0
): MediaPresentation {
  return {
    ...values,
    revision,
    renditionKeys: getPresentationRenditionKeys(asset, values)
  };
}
