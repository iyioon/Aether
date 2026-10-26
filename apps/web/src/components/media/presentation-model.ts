import type { MediaPresentation, PresentationValues } from "../../api/client";

export const PRESENTATION_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const MIN_HIGHLIGHT_DURATION_MS = 100;
export const MAX_PRESENTATION_ZOOM = 4;

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

export function presentationClamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : minimum;
}

export function getPresentationValues(
  presentation?: Partial<MediaPresentation> | null
): PresentationValues {
  const defaults = defaultPresentationValues();
  if (!presentation) {
    return defaults;
  }
  return {
    highlight: presentation.highlight ? { ...presentation.highlight } : null,
    fit:
      presentation.fit === "contain" || presentation.fit === "cover"
        ? presentation.fit
        : "auto",
    focalX: presentationClamp(presentation.focalX ?? 0.5, 0, 1),
    focalY: presentationClamp(presentation.focalY ?? 0.5, 0, 1),
    zoom: presentationClamp(presentation.zoom ?? 1, 1, MAX_PRESENTATION_ZOOM),
    playbackRate: presentationClamp(presentation.playbackRate ?? 1, 0.5, 2),
    loopMode: presentation.loopMode === "bounce" ? "bounce" : "repeat"
  };
}

export function presentationRange(
  values: Pick<PresentationValues, "highlight">,
  durationMs: number
): [number, number] {
  return values.highlight
    ? [values.highlight.startMs, values.highlight.endMs]
    : [0, durationMs];
}

export function updatePresentationRange(
  values: PresentationValues,
  startMs: number,
  endMs: number,
  durationMs: number
): PresentationValues {
  const duration = Number.isFinite(durationMs)
    ? Math.max(0, Math.round(durationMs))
    : 0;
  const minimum = Math.min(duration, MIN_HIGHLIGHT_DURATION_MS);
  const start = Math.round(
    presentationClamp(startMs, 0, Math.max(0, duration - minimum))
  );
  const end = Math.round(presentationClamp(endMs, start + minimum, duration));
  return {
    ...values,
    highlight:
      start === 0 && end === duration ? null : { startMs: start, endMs: end }
  };
}

export function presentationValidationMessage(
  values: PresentationValues,
  durationMs: number,
  maxBounceDurationMs: number,
  maxHighlightDurationMs = Infinity
): string | null {
  const [start, end] = presentationRange(values, durationMs);
  if (
    values.highlight &&
    (!Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > durationMs ||
      end - start < Math.min(durationMs, MIN_HIGHLIGHT_DURATION_MS))
  ) {
    return "Choose a valid start and end within the media.";
  }
  if (values.highlight && end - start > maxHighlightDurationMs) {
    return `Choose a highlight of ${maxHighlightDurationMs / 1000} seconds or less.`;
  }
  if (
    values.loopMode === "bounce" &&
    (!Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      maxBounceDurationMs <= 0 ||
      end - start > maxBounceDurationMs)
  ) {
    return `Bounce needs a section of ${Math.max(0, maxBounceDurationMs / 1000)} seconds or less.`;
  }
  return null;
}

export function formatPresentationTime(timeMs: number): string {
  const milliseconds = Number.isFinite(timeMs)
    ? Math.max(0, Math.round(timeMs))
    : 0;
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const fraction = String(milliseconds % 1000).padStart(3, "0");
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}.${fraction}`;
}

export function parsePresentationTime(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+:)?\d+(?:\.\d{1,3})?$/.test(text)) {
    return null;
  }
  const parts = text.split(":");
  const seconds = Number(parts.at(-1));
  if (parts.length === 2 && seconds >= 60) {
    return null;
  }
  const result = Math.round(
    ((parts.length === 2 ? Number(parts[0]) * 60 : 0) + seconds) * 1000
  );
  return Number.isSafeInteger(result) ? result : null;
}

export function presentationValuesEqual(
  left: PresentationValues,
  right: PresentationValues
): boolean {
  return (
    left.fit === right.fit &&
    left.focalX === right.focalX &&
    left.focalY === right.focalY &&
    left.zoom === right.zoom &&
    left.playbackRate === right.playbackRate &&
    left.loopMode === right.loopMode &&
    ((left.highlight === null && right.highlight === null) ||
      (left.highlight !== null &&
        right.highlight !== null &&
        left.highlight.startMs === right.highlight.startMs &&
        left.highlight.endMs === right.highlight.endMs))
  );
}

export function presentationSaveOutcome(
  current: MediaPresentation | undefined,
  desired: PresentationValues,
  expectedRevision: number
): "saved" | "unchanged" | "conflict" {
  const revision = current?.revision ?? 0;
  if (revision === expectedRevision) return "unchanged";
  return revision > expectedRevision &&
    presentationValuesEqual(getPresentationValues(current), desired)
    ? "saved"
    : "conflict";
}
