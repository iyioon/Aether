import { describe, expect, it } from "vitest";
import {
  defaultPresentationValues,
  formatPresentationTime,
  getPresentationValues,
  parsePresentationTime,
  presentationRange,
  presentationFramingForAspect,
  setPresentationFraming,
  presentationSaveOutcome,
  shouldEnableHighlightPlayback,
  presentationValidationMessage,
  presentationValuesEqual,
  updatePresentationRange
} from "./presentation-model";

describe("saved presentation drafts", () => {
  it("keeps legacy records neutral and returns independent nested drafts", () => {
    expect(getPresentationValues()).toEqual(defaultPresentationValues());
    const saved = { highlight: { startMs: 300, endMs: 2000 }, zoom: 2 };
    const draft = getPresentationValues(saved);
    draft.highlight!.startMs = 900;
    expect(saved.highlight.startMs).toBe(300);
    expect(draft).toMatchObject({ zoom: 2, focalX: 0.5, playbackRate: 1 });
  });

  it("resolves legacy automatic framing for the editor without changing saved values", () => {
    const values = { ...defaultPresentationValues(), focalX: 0.2, zoom: 2 };
    expect(
      presentationFramingForAspect(values, "Original", "contain")
    ).toMatchObject({ fit: "contain", focalX: 0.2, zoom: 2 });
    expect(
      presentationFramingForAspect(values, "Original", "cover")
    ).toMatchObject({ fit: "cover", focalX: 0.2, zoom: 2 });
    expect(
      presentationFramingForAspect(values, "Square", "cover")
    ).toMatchObject({ fit: "cover", focalX: 0.5, zoom: 1 });
    expect(values.fit).toBe("auto");
    expect(values.aspectFraming).toEqual({});
    const explicit = { ...values, fit: "contain" as const };
    expect(
      presentationFramingForAspect(explicit, "Original", "cover").fit
    ).toBe("contain");
    expect(presentationFramingForAspect(values, "Original").fit).toBe("auto");
  });

  it("retains independent drafts across aspect changes and normalizes nested saved values", () => {
    const original = { ...defaultPresentationValues(), zoom: 4 };
    const square = { fit: "cover" as const, focalX: 0.2, focalY: 0.8, zoom: 2 };
    const portrait = {
      fit: "contain" as const,
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1
    };
    const first = setPresentationFraming(original, "Square", square);
    const second = setPresentationFraming(first, "Portrait", portrait);
    expect(presentationFramingForAspect(second, "Square")).toEqual(square);
    expect(presentationFramingForAspect(second, "Portrait")).toEqual(portrait);
    expect(presentationFramingForAspect(second, "Landscape").zoom).toBe(1);
    expect(presentationFramingForAspect(second, "Original").zoom).toBe(4);
    expect(original.aspectFraming).toEqual({});
    expect(first.aspectFraming?.Portrait).toBeUndefined();
    const draft = getPresentationValues(second);
    draft.aspectFraming!.Square!.zoom = 3;
    expect(second.aspectFraming?.Square?.zoom).toBe(2);
    expect(presentationValuesEqual(second, draft)).toBe(false);
    const reset = setPresentationFraming(
      first,
      "Square",
      defaultPresentationValues()
    );
    expect(reset.aspectFraming).toEqual({});
    expect(presentationValuesEqual(reset, original)).toBe(true);
    expect(
      getPresentationValues({
        aspectFraming: { Square: { ...square, focalX: NaN, zoom: Infinity } }
      }).aspectFraming?.Square
    ).toMatchObject({ focalX: 0.5, zoom: 1 });
  });

  it("reconciles uncertain writes without overwriting a concurrent edit or restore", () => {
    const desired = { ...defaultPresentationValues(), zoom: 2 };
    const current = {
      ...desired,
      revision: 2,
      renditionKeys: { full: "f", highlight: "h", bounce: "b" }
    };
    expect(presentationSaveOutcome(undefined, desired, 0)).toBe("unchanged");
    expect(
      presentationSaveOutcome({ ...current, revision: 1 }, desired, 1)
    ).toBe("unchanged");
    expect(presentationSaveOutcome(current, desired, 1)).toBe("saved");
    expect(presentationSaveOutcome({ ...current, zoom: 3 }, desired, 1)).toBe(
      "conflict"
    );
    expect(
      presentationSaveOutcome({ ...current, revision: 0 }, desired, 1)
    ).toBe("conflict");
  });

  it("reveals the saved section when Bounce or its highlight changes explicitly", () => {
    const before = {
      ...defaultPresentationValues(),
      highlight: { startMs: 500, endMs: 2000 }
    };
    const bounce = { ...before, loopMode: "bounce" as const };
    expect(shouldEnableHighlightPlayback(before, bounce)).toBe(true);
    expect(
      shouldEnableHighlightPlayback(bounce, {
        ...bounce,
        highlight: { startMs: 600, endMs: 2000 }
      })
    ).toBe(true);
    expect(
      shouldEnableHighlightPlayback(bounce, {
        ...bounce,
        highlight: { startMs: 500, endMs: 2100 }
      })
    ).toBe(true);
    expect(
      shouldEnableHighlightPlayback({ ...bounce, highlight: null }, bounce)
    ).toBe(true);
  });

  it("preserves viewing preferences after framing, speed, Repeat or full-source edits", () => {
    const before = {
      ...defaultPresentationValues(),
      highlight: { startMs: 500, endMs: 2000 },
      loopMode: "bounce" as const
    };
    for (const saved of [
      before,
      { ...before, zoom: 2 },
      { ...before, focalX: 0.3 },
      { ...before, playbackRate: 0.5 },
      {
        ...before,
        aspectFraming: {
          Square: { fit: "cover" as const, focalX: 0.3, focalY: 0.5, zoom: 2 }
        }
      },
      { ...before, loopMode: "repeat" as const },
      { ...before, highlight: null }
    ])
      expect(shouldEnableHighlightPlayback(before, saved)).toBe(false);
    expect(
      shouldEnableHighlightPlayback(defaultPresentationValues(), {
        ...defaultPresentationValues(),
        loopMode: "bounce"
      })
    ).toBe(false);
    expect(
      shouldEnableHighlightPlayback(defaultPresentationValues(), {
        ...defaultPresentationValues(),
        highlight: { startMs: 500, endMs: 2000 }
      })
    ).toBe(false);
  });

  it("preserves neutral Feed overrides as distinct from automatic framing in uncertain writes", () => {
    const defaults = defaultPresentationValues();
    const neutral = {
      fit: "cover" as const,
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1
    };
    const values = { ...defaults, feedFraming: { portrait: neutral } };
    expect(presentationValuesEqual(defaults, values)).toBe(false);
    expect(
      presentationValuesEqual(values, {
        ...values,
        feedFraming: { portrait: { ...neutral } }
      })
    ).toBe(true);
    const copied = getPresentationValues(values);
    copied.feedFraming!.portrait!.zoom = 2;
    expect(values.feedFraming.portrait.zoom).toBe(1);
    expect(
      presentationSaveOutcome(
        {
          ...values,
          revision: 2,
          renditionKeys: { full: "f", highlight: "h", bounce: "b" }
        },
        values,
        1
      )
    ).toBe("saved");
    expect(
      presentationSaveOutcome(
        {
          ...defaults,
          revision: 2,
          renditionKeys: { full: "f", highlight: "h", bounce: "b" }
        },
        values,
        1
      )
    ).toBe("conflict");
  });

  it("compares drafts by values regardless of response key order", () => {
    const saved = {
      ...defaultPresentationValues(),
      highlight: { startMs: 100, endMs: 500 }
    };
    expect(
      presentationValuesEqual(saved, {
        ...saved,
        highlight: { endMs: 500, startMs: 100 }
      })
    ).toBe(true);
    expect(presentationValuesEqual(saved, { ...saved, zoom: 2 })).toBe(false);
    expect(presentationValuesEqual(saved, { ...saved, highlight: null })).toBe(
      false
    );
    expect(
      presentationValuesEqual(saved, {
        ...saved,
        highlight: { startMs: 101, endMs: 500 }
      })
    ).toBe(false);
  });

  it("bounds geometry and rates without carrying server-only data into writes", () => {
    expect(
      getPresentationValues({
        revision: 4,
        renditionKeys: { full: "f", highlight: "h", bounce: "b" },
        focalX: -1,
        focalY: 3,
        zoom: 10,
        playbackRate: 0.1
      })
    ).toEqual({
      ...defaultPresentationValues(),
      focalX: 0,
      focalY: 1,
      zoom: 4,
      playbackRate: 0.5
    });
  });

  it("uses full duration for an unset range and canonicalizes a full-range edit", () => {
    const defaults = defaultPresentationValues();
    expect(presentationRange(defaults, 5000)).toEqual([0, 5000]);
    expect(
      updatePresentationRange(defaults, -100, 9000, 5000).highlight
    ).toBeNull();
    expect(updatePresentationRange(defaults, 200, 800, 5000).highlight).toEqual(
      { startMs: 200, endMs: 800 }
    );
  });

  it("prevents crossed or zero-length ranges and supports clips shorter than 100ms", () => {
    const defaults = defaultPresentationValues();
    expect(
      updatePresentationRange(defaults, 1500, 200, 2000).highlight
    ).toEqual({ startMs: 1500, endMs: 1600 });
    expect(
      updatePresentationRange(defaults, 5000, 5000, 2000).highlight
    ).toEqual({ startMs: 1900, endMs: 2000 });
    expect(updatePresentationRange(defaults, 30, 30, 50).highlight).toBeNull();
    for (const duration of [0, -1, NaN, Infinity]) {
      expect(
        updatePresentationRange(defaults, 0, 20, duration).highlight
      ).toBeNull();
    }
  });

  it("rejects invalid selections and enforces separate highlight and bounce budgets", () => {
    const defaults = defaultPresentationValues();
    expect(
      presentationValidationMessage(defaults, 300000, 10000, 120000)
    ).toBeNull();
    expect(
      presentationValidationMessage(
        { ...defaults, highlight: { startMs: 0, endMs: 150000 } },
        300000,
        10000,
        120000
      )
    ).toContain("120 seconds");
    expect(
      presentationValidationMessage(
        { ...defaults, loopMode: "bounce" },
        300000,
        10000
      )
    ).toContain("10 seconds");
    expect(
      presentationValidationMessage(
        { ...defaults, loopMode: "bounce" },
        1000,
        0
      )
    ).toBe("Bounce is unavailable for this file. Choose Repeat instead.");
    expect(
      presentationValidationMessage(
        {
          ...defaults,
          loopMode: "bounce",
          highlight: { startMs: 20000, endMs: 30000 }
        },
        300000,
        10000
      )
    ).toBeNull();
    expect(
      presentationValidationMessage(
        { ...defaults, loopMode: "bounce" },
        50,
        10000
      )
    ).toBeNull();
    for (const highlight of [
      { startMs: -1, endMs: 1000 },
      { startMs: 0, endMs: 5001 },
      { startMs: 1000, endMs: 1000 },
      { startMs: 0, endMs: NaN }
    ]) {
      expect(
        presentationValidationMessage({ ...defaults, highlight }, 5000, 10000)
      ).not.toBeNull();
    }
  });
});

describe("source timestamp fields", () => {
  it.each([
    ["0:00.000", 0],
    ["1:02.345", 62345],
    ["100:00.001", 6000001],
    ["62.345", 62345],
    [" 1.5 ", 1500],
    [".5", null],
    ["1:60.000", null],
    ["1:02:03", null],
    ["-1", null],
    ["Infinity", null],
    ["2.5555", null],
    ["1e3", null],
    ["", null]
  ])("parses %s as %s", (text, expected) => {
    expect(parsePresentationTime(text)).toBe(expected);
  });

  it("round-trips precise source times, including long clips, and bounds invalid output", () => {
    for (const value of [0, 1, 59, 999, 60000, 62345, 6000001]) {
      expect(parsePresentationTime(formatPresentationTime(value))).toBe(value);
    }
    expect(formatPresentationTime(1000.6)).toBe("0:01.001");
    expect(formatPresentationTime(-100)).toBe("0:00.000");
    expect(formatPresentationTime(NaN)).toBe("0:00.000");
  });
});
