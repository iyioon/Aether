import { z } from "zod";
import {
  MAX_SAVED_HIGHLIGHTS,
  PRESENTATION_PLAYBACK_RATES,
  highlightPlaybackValues,
  type SavedHighlightValues
} from "./presentation.js";

const Framing = z
  .object({
    fit: z.enum(["auto", "contain", "cover"]),
    focalX: z.number().min(0).max(1),
    focalY: z.number().min(0).max(1),
    zoom: z.number().min(1).max(4)
  })
  .strict();

const PlaybackValues = z
  .object({
    highlight: z
      .object({
        startMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        endMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
      })
      .strict()
      .nullable(),
    ...Framing.shape,
    aspectFraming: z
      .object({
        Square: Framing.optional(),
        Portrait: Framing.optional(),
        Landscape: Framing.optional()
      })
      .strict()
      .optional(),
    feedFraming: z
      .object({
        portrait: Framing.extend({ fit: z.literal("cover") }).optional(),
        landscape: Framing.extend({ fit: z.literal("cover") }).optional()
      })
      .strict()
      .optional(),
    playbackRate: z
      .number()
      .refine((value) =>
        PRESENTATION_PLAYBACK_RATES.some((rate) => rate === value)
      ),
    loopMode: z.enum(["repeat", "bounce"])
  })
  .strict();

const SavedHighlight = PlaybackValues.extend({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\p{Cc}]*$/u),
  highlight: PlaybackValues.shape.highlight.unwrap()
}).strict();

export const PresentationBody = PlaybackValues.extend({
  expectedRevision: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
  highlights: z.array(SavedHighlight).max(MAX_SAVED_HIGHLIGHTS).optional(),
  mainHighlightId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .nullable()
    .optional()
})
  .strict()
  .superRefine(validateCollection);

function validateCollection(
  values: {
    highlights?: SavedHighlightValues[];
    mainHighlightId?: string | null;
  },
  context: z.RefinementCtx
): void {
  if (values.highlights === undefined) {
    if (values.mainHighlightId !== undefined)
      context.addIssue({
        code: "custom",
        message: "Highlights are required with a main highlight."
      });
    return;
  }
  const ids = new Set(values.highlights.map((highlight) => highlight.id));
  if (
    ids.size !== values.highlights.length ||
    (values.highlights.length === 0
      ? values.mainHighlightId !== null
      : !values.mainHighlightId || !ids.has(values.mainHighlightId))
  )
    context.addIssue({
      code: "custom",
      message: "Choose one main highlight from the saved highlights."
    });
}

const StoredPresentation = PlaybackValues.extend({
  highlights: z.array(SavedHighlight).max(MAX_SAVED_HIGHLIGHTS),
  mainHighlightId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .nullable()
})
  .strict()
  .superRefine(validateCollection)
  .superRefine((values, context) => {
    const main = values.highlights.find(
      (highlight) => highlight.id === values.mainHighlightId
    );
    if (
      (values.highlights.length === 0 && values.highlight !== null) ||
      (main &&
        JSON.stringify(highlightPlaybackValues(values)) !==
          JSON.stringify(highlightPlaybackValues(main)))
    )
      context.addIssue({
        code: "custom",
        message: "The main highlight projection is inconsistent."
      });
    if (
      [values, ...values.highlights].some(
        (item) =>
          item.highlight && item.highlight.endMs <= item.highlight.startMs
      )
    )
      context.addIssue({
        code: "custom",
        message: "The highlight range is invalid."
      });
  });

/** Startup and restore validate persisted data with the same bounds as API saves. */
export function validStoredPresentation(values: unknown): boolean {
  return StoredPresentation.safeParse(values).success;
}
