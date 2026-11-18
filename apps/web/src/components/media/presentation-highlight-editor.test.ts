import { describe, expect, it } from "vitest";
import type {
  PresentationValues,
  SavedHighlightValues
} from "../../api/client";
import {
  addPresentationHighlight,
  MAX_MEDIA_HIGHLIGHTS,
  removePresentationHighlight,
  renamePresentationHighlight
} from "./presentation-highlight-editor";
import {
  defaultPresentationValues,
  selectPresentationHighlight,
  setMainPresentationHighlight
} from "./presentation-model";

function collection(): PresentationValues {
  const highlights: SavedHighlightValues[] = [
    {
      ...defaultPresentationValues(),
      id: "opening",
      name: "Opening",
      highlight: { startMs: 100, endMs: 1100 },
      playbackRate: 0.75,
      fit: "cover",
      focalX: 0.2,
      focalY: 0.3,
      zoom: 1.2,
      aspectFraming: {
        Square: { fit: "cover", focalX: 0.1, focalY: 0.4, zoom: 1.5 }
      }
    },
    {
      ...defaultPresentationValues(),
      id: "ending",
      name: "Ending",
      highlight: { startMs: 6000, endMs: 8000 },
      playbackRate: 1.5,
      loopMode: "bounce",
      fit: "cover",
      focalX: 0.8,
      focalY: 0.6,
      zoom: 2,
      aspectFraming: {
        Portrait: { fit: "cover", focalX: 0.7, focalY: 0.8, zoom: 2.5 }
      },
      feedFraming: {
        portrait: { fit: "cover", focalX: 0.4, focalY: 0.2, zoom: 1.3 }
      }
    }
  ];
  return setMainPresentationHighlight(
    {
      ...defaultPresentationValues(),
      highlights,
      mainHighlightId: "opening"
    },
    "opening"
  );
}

describe("highlight draft editing", () => {
  it("copies the selected section's settings into an independent highlight while retaining main", () => {
    const original = collection();
    const selected = selectPresentationHighlight(original, "ending");
    const added = addPresentationHighlight(selected, 10_000, 6500, "new");
    const next = added.highlights!.at(-1)!;

    expect(added.highlights).toHaveLength(3);
    expect(added.mainHighlightId).toBe("opening");
    expect(added.highlight).toEqual({ startMs: 100, endMs: 1100 });
    expect(added.playbackRate).toBe(0.75);
    expect(next).toMatchObject({
      id: "new",
      name: "Highlight 1",
      highlight: { startMs: 6500, endMs: 9500 },
      playbackRate: 1.5,
      loopMode: "bounce",
      focalX: 0.8,
      zoom: 2,
      aspectFraming: selected.aspectFraming,
      feedFraming: selected.feedFraming
    });
    next.highlight.startMs = 7000;
    next.aspectFraming!.Portrait!.zoom = 3;
    next.feedFraming!.portrait!.focalX = 0.9;
    expect(original.highlights).toHaveLength(2);
    expect(original.highlights![1]!.highlight).toEqual({
      startMs: 6000,
      endMs: 8000
    });
    expect(original.highlights![1]!.aspectFraming!.Portrait!.zoom).toBe(2.5);
    expect(original.highlights![1]!.feedFraming!.portrait!.focalX).toBe(0.4);
    expect(added.highlights![1]!.aspectFraming!.Portrait!.zoom).toBe(2.5);
  });

  it("makes a first highlight main and finds an unused default name", () => {
    const first = addPresentationHighlight(
      defaultPresentationValues(),
      10_000,
      500,
      "first"
    );
    expect(first.mainHighlightId).toBe("first");
    expect(first.highlight).toEqual({ startMs: 500, endMs: 3500 });
    expect(first.highlights![0]!.name).toBe("Highlight 1");
    const thirdName = renamePresentationHighlight(
      addPresentationHighlight(first, 10_000, 4000, "second"),
      "second",
      "Highlight 3"
    );
    const next = addPresentationHighlight(thirdName, 10_000, 7000, "third");
    expect(next.highlights!.map((highlight) => highlight.name)).toEqual([
      "Highlight 1",
      "Highlight 3",
      "Highlight 2"
    ]);
    expect(next.mainHighlightId).toBe("first");
  });

  it("keeps the collection unchanged when its limit is reached or timing is unavailable", () => {
    let values = defaultPresentationValues();
    for (let index = 0; index < MAX_MEDIA_HIGHLIGHTS; index++)
      values = addPresentationHighlight(
        values,
        10_000,
        index * 100,
        `id-${index}`
      );
    expect(values.highlights).toHaveLength(20);
    expect(addPresentationHighlight(values, 10_000, 0, "over-limit")).toBe(
      values
    );
    const empty = defaultPresentationValues();
    expect(addPresentationHighlight(empty, 0, 0, "unavailable")).toBe(empty);
    expect(addPresentationHighlight(empty, -1, 0, "unavailable")).toBe(empty);
  });

  it.each([
    { duration: 50, playhead: 1000, maximum: 3000, expected: [0, 50] },
    { duration: 1000, playhead: -100, maximum: 3000, expected: [0, 1000] },
    { duration: 6000, playhead: 9999, maximum: 3000, expected: [5900, 6000] },
    { duration: 6000, playhead: 500, maximum: 1200, expected: [500, 1700] },
    { duration: 6000, playhead: 500, maximum: 30_000, expected: [500, 3500] }
  ])(
    "bounds a new section to the source and processing limit: $duration/$playhead/$maximum",
    ({ duration, playhead, maximum, expected }) => {
      const added = addPresentationHighlight(
        defaultPresentationValues(),
        duration,
        playhead,
        "new",
        maximum
      );
      expect(added.highlights![0]!.highlight).toEqual({
        startMs: expected[0],
        endMs: expected[1]
      });
    }
  );

  it("renames only the requested draft without changing its ID or settings", () => {
    const original = collection();
    const renamed = renamePresentationHighlight(original, "ending", "Finale");
    expect(original.highlights![1]!.name).toBe("Ending");
    expect(renamed.highlights![1]).toEqual({
      ...original.highlights![1],
      name: "Finale"
    });
    expect(renamed.highlights![0]).toEqual(original.highlights![0]);
    expect(renamed.mainHighlightId).toBe("opening");
    expect(renamed.highlight).toEqual(original.highlight);
  });

  it("promotes the first remaining highlight with its own playback and framing when main is removed", () => {
    const original = collection();
    const next = removePresentationHighlight(original, "opening");
    expect(next.highlights).toEqual([original.highlights![1]]);
    expect(next.mainHighlightId).toBe("ending");
    expect(next).toMatchObject({
      highlight: { startMs: 6000, endMs: 8000 },
      playbackRate: 1.5,
      loopMode: "bounce",
      focalX: 0.8,
      zoom: 2,
      aspectFraming: original.highlights![1]!.aspectFraming
    });
    expect(original.mainHighlightId).toBe("opening");
    expect(original.highlights).toHaveLength(2);
  });

  it("retains main when removing another highlight", () => {
    const original = collection();
    const next = removePresentationHighlight(original, "ending");
    expect(next.highlights).toEqual([original.highlights![0]]);
    expect(next.mainHighlightId).toBe("opening");
    expect(next.highlight).toEqual(original.highlight);
    expect(next.playbackRate).toBe(original.playbackRate);
  });

  it("clears temporal edits after the last removal while retaining framing", () => {
    const original = removePresentationHighlight(collection(), "opening");
    const cleared = removePresentationHighlight(original, "ending");
    expect(cleared).toEqual({
      ...original,
      highlights: [],
      mainHighlightId: null,
      highlight: null,
      playbackRate: 1,
      loopMode: "repeat"
    });
    expect(cleared.aspectFraming).toEqual(original.aspectFraming);
    expect(cleared.feedFraming).toEqual(original.feedFraming);
    expect(cleared.zoom).toBe(2);
  });
});
