import { createHash } from "node:crypto";

export interface PresentationFraming {
  fit: "auto" | "contain" | "cover";
  focalX: number;
  focalY: number;
  zoom: number;
}

export interface PresentationPlaybackValues extends PresentationFraming {
  highlight: { startMs: number; endMs: number } | null;
  aspectFraming?: Partial<
    Record<"Square" | "Portrait" | "Landscape", PresentationFraming>
  >;
  feedFraming?: Partial<Record<"portrait" | "landscape", PresentationFraming>>;
  playbackRate: number;
  loopMode: "repeat" | "bounce";
}

export interface SavedHighlightValues extends PresentationPlaybackValues {
  id: string;
  name: string;
  highlight: { startMs: number; endMs: number };
}

export interface PresentationValues extends PresentationPlaybackValues {
  highlights?: SavedHighlightValues[];
  mainHighlightId?: string | null;
}

export type PresentationRenditionKeys = {
  full: string;
  highlight: string;
  bounce: string;
};

export interface SavedHighlight extends SavedHighlightValues {
  renditionKeys: PresentationRenditionKeys;
}

export interface MediaPresentation extends PresentationValues {
  revision: number;
  renditionKeys: PresentationRenditionKeys;
  highlights: SavedHighlight[];
  mainHighlightId: string | null;
}

export const MAX_SAVED_HIGHLIGHTS = 20;
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
    bounce: key("bounce-playback-v6", range, values.loopMode)
  };
}

export function mediaPresentation(
  asset: { id: string; mtimeMs: number; sizeBytes: number },
  values = defaultPresentationValues(),
  revision = 0
): MediaPresentation {
  const canonical = canonicalPresentationValues(values);
  return {
    ...canonical,
    revision,
    renditionKeys: getPresentationRenditionKeys(asset, canonical),
    highlights: canonical.highlights.map((highlight) => ({
      ...highlight,
      renditionKeys: getPresentationRenditionKeys(asset, highlight)
    })),
    mainHighlightId: canonical.mainHighlightId ?? null
  };
}

/** Legacy saves edit the current main highlight without discarding other ranges. */
export function canonicalPresentationValues(
  values: PresentationValues,
  previous?: PresentationValues
): PresentationValues & {
  highlights: SavedHighlightValues[];
  mainHighlightId: string | null;
} {
  let highlights = values.highlights;
  let mainHighlightId = values.mainHighlightId ?? null;
  if (highlights === undefined) {
    highlights = [...(previous?.highlights ?? [])];
    mainHighlightId = previous?.mainHighlightId ?? null;
    const mainIndex = highlights.findIndex(
      (item) => item.id === mainHighlightId
    );
    if (values.highlight) {
      const prior = highlights[mainIndex];
      const highlight: SavedHighlightValues = {
        ...highlightPlaybackValues(values),
        highlight: values.highlight,
        id: prior?.id ?? "highlight-1",
        name: prior?.name ?? "Highlight 1"
      };
      if (mainIndex >= 0) highlights[mainIndex] = highlight;
      else highlights.push(highlight);
      mainHighlightId = highlight.id;
    } else if (mainIndex >= 0) {
      highlights.splice(mainIndex, 1);
      mainHighlightId = highlights[0]?.id ?? null;
    }
  }
  highlights = highlights.map((item) => ({
    ...highlightPlaybackValues(item),
    id: item.id,
    name: item.name,
    highlight: item.highlight
  }));
  const main = highlights.find((item) => item.id === mainHighlightId);
  return {
    ...values,
    ...(values.highlights?.length === 0 ? { highlight: null } : {}),
    ...(main ? highlightPlaybackValues(main) : {}),
    highlights,
    mainHighlightId: highlights.length === 0 ? null : mainHighlightId
  };
}

export function highlightPlaybackValues(
  highlight: PresentationPlaybackValues
): PresentationPlaybackValues {
  return {
    highlight: highlight.highlight,
    fit: highlight.fit,
    focalX: highlight.focalX,
    focalY: highlight.focalY,
    zoom: highlight.zoom,
    aspectFraming: normalizedAspectFraming(highlight.aspectFraming),
    feedFraming: highlight.feedFraming ?? {},
    playbackRate: highlight.playbackRate,
    loopMode: highlight.loopMode
  };
}

export function normalizedAspectFraming(
  framing: PresentationPlaybackValues["aspectFraming"]
): PresentationPlaybackValues["aspectFraming"] {
  return Object.fromEntries(
    Object.entries(framing ?? {}).filter(
      ([, frame]) =>
        frame &&
        (frame.fit !== "auto" ||
          frame.focalX !== 0.5 ||
          frame.focalY !== 0.5 ||
          frame.zoom !== 1)
    )
  );
}

export function presentationRenditionKeys(
  asset: { id: string; mtimeMs: number; sizeBytes: number },
  values: PresentationValues
): PresentationRenditionKeys[] {
  return [values, ...(values.highlights ?? [])].map((item) =>
    getPresentationRenditionKeys(asset, item)
  );
}
