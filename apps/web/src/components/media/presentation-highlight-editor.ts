import type {
  PresentationValues,
  SavedHighlightValues
} from "../../api/client";
import {
  getPresentationHighlights,
  getPresentationValues,
  presentationClamp,
  setMainPresentationHighlight
} from "./presentation-model";

export const MAX_MEDIA_HIGHLIGHTS = 20;

export function addPresentationHighlight(
  values: PresentationValues,
  durationMs: number,
  playheadMs: number,
  id: string,
  maximumDurationMs = Infinity
): PresentationValues {
  const highlights = getPresentationHighlights(values);
  if (highlights.length >= MAX_MEDIA_HIGHLIGHTS || durationMs <= 0)
    return values;
  const minimum = Math.min(durationMs, 100);
  const startMs = Math.round(
    presentationClamp(playheadMs, 0, durationMs - minimum)
  );
  const endMs = Math.min(
    durationMs,
    startMs + Math.max(minimum, Math.min(3000, maximumDurationMs))
  );
  let number = 1;
  while (
    highlights.some((highlight) => highlight.name === `Highlight ${number}`)
  )
    number += 1;
  const copied = getPresentationValues({
    ...values,
    highlights: undefined,
    mainHighlightId: undefined
  });
  const highlight: SavedHighlightValues = {
    id,
    name: `Highlight ${number}`,
    ...copied,
    highlight: { startMs, endMs }
  };
  const next = {
    ...values,
    highlights: [...highlights, highlight],
    mainHighlightId: values.mainHighlightId ?? highlights[0]?.id ?? id
  };
  return setMainPresentationHighlight(next, next.mainHighlightId);
}

export function renamePresentationHighlight(
  values: PresentationValues,
  id: string,
  name: string
): PresentationValues {
  return {
    ...values,
    highlights: getPresentationHighlights(values).map((highlight) =>
      highlight.id === id ? { ...highlight, name } : highlight
    )
  };
}

export function removePresentationHighlight(
  values: PresentationValues,
  id: string
): PresentationValues {
  const highlights = getPresentationHighlights(values).filter(
    (highlight) => highlight.id !== id
  );
  if (highlights.length === 0)
    return {
      ...values,
      highlight: null,
      playbackRate: 1,
      loopMode: "repeat",
      highlights: [],
      mainHighlightId: null
    };
  const mainHighlightId = highlights.some(
    (highlight) => highlight.id === values.mainHighlightId
  )
    ? values.mainHighlightId!
    : highlights[0]!.id;
  return setMainPresentationHighlight(
    { ...values, highlights, mainHighlightId },
    mainHighlightId
  );
}
