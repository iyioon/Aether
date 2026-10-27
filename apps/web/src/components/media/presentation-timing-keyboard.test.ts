import { describe, expect, it } from "vitest";
import {
  isModifiedPresentationTimingKey,
  presentationTimingKeyTarget
} from "./presentation-timing-keyboard";

describe("presentation timeline keyboard controls", () => {
  it.each([
    ["ArrowRight", 600],
    ["ArrowUp", 600],
    ["ArrowLeft", 400],
    ["ArrowDown", 400]
  ])("moves %s by one tenth of a second", (key, expected) => {
    expect(presentationTimingKeyTarget({ key }, 500, 0, 2000)).toBe(expected);
  });

  it.each([
    ["ArrowRight", 501],
    ["ArrowUp", 501],
    ["ArrowLeft", 499],
    ["ArrowDown", 499]
  ])("uses a one millisecond fine step for Shift+%s", (key, expected) => {
    expect(
      presentationTimingKeyTarget({ key, shiftKey: true }, 500, 0, 2000)
    ).toBe(expected);
  });

  it("moves page keys by one second independently of Shift", () => {
    for (const shiftKey of [false, true]) {
      expect(
        presentationTimingKeyTarget({ key: "PageUp", shiftKey }, 1500, 0, 3000)
      ).toBe(2500);
      expect(
        presentationTimingKeyTarget(
          { key: "PageDown", shiftKey },
          1500,
          0,
          3000
        )
      ).toBe(500);
    }
  });

  it("uses the focused boundary's legal limits for Home and End", () => {
    expect(presentationTimingKeyTarget({ key: "Home" }, 400, 200, 900)).toBe(
      200
    );
    expect(presentationTimingKeyTarget({ key: "End" }, 400, 200, 900)).toBe(
      900
    );
    expect(
      presentationTimingKeyTarget({ key: "End", shiftKey: true }, 400, 200, 900)
    ).toBe(900);
  });

  it("clamps repeated steps at each legal boundary without crossing it", () => {
    // The start thumb cannot cross an end at 1000ms with a 100ms minimum gap.
    let start = 850;
    for (let index = 0; index < 5; index++)
      start = presentationTimingKeyTarget(
        { key: "ArrowRight" },
        start,
        0,
        900
      )!;
    expect(start).toBe(900);
    // The end thumb cannot cross a start at 200ms with the same minimum gap.
    let end = 350;
    for (let index = 0; index < 5; index++)
      end = presentationTimingKeyTarget({ key: "ArrowLeft" }, end, 300, 1000)!;
    expect(end).toBe(300);
    expect(presentationTimingKeyTarget({ key: "PageDown" }, 50, 0, 1000)).toBe(
      0
    );
    expect(presentationTimingKeyTarget({ key: "PageUp" }, 950, 0, 1000)).toBe(
      1000
    );
  });

  it.each(["ctrlKey", "metaKey", "altKey", "isComposing"] as const)(
    "leaves %s shortcuts and composition untouched",
    (modifier) => {
      for (const key of ["ArrowRight", "ArrowLeft", "PageUp", "Home", "End"])
        expect(
          presentationTimingKeyTarget({ key, [modifier]: true }, 500, 0, 1000)
        ).toBeNull();
    }
  );

  it("leaves unrelated keys and focus navigation untouched", () => {
    for (const key of ["Tab", "Escape", "Enter", " ", "a", "Process"])
      expect(presentationTimingKeyTarget({ key }, 500, 0, 1000)).toBeNull();
  });

  it("blocks only modified timing keys from Radix fallback without handling normal focus keys", () => {
    for (const key of [
      "ArrowRight",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End"
    ]) {
      expect(isModifiedPresentationTimingKey({ key })).toBe(false);
      expect(isModifiedPresentationTimingKey({ key, shiftKey: true })).toBe(
        false
      );
      for (const modifier of [
        "ctrlKey",
        "metaKey",
        "altKey",
        "isComposing"
      ] as const)
        expect(isModifiedPresentationTimingKey({ key, [modifier]: true })).toBe(
          true
        );
    }
    for (const key of ["Tab", "Escape", "Enter", "a", "Process"])
      expect(
        isModifiedPresentationTimingKey({
          key,
          ctrlKey: true,
          isComposing: true
        })
      ).toBe(false);
  });

  it("preserves fractional playback time when applying an exact millisecond delta", () => {
    expect(
      presentationTimingKeyTarget(
        { key: "ArrowRight", shiftKey: true },
        333.25,
        0,
        1000
      )
    ).toBe(334.25);
    expect(
      presentationTimingKeyTarget({ key: "ArrowLeft" }, 333.25, 0, 1000)
    ).toBe(233.25);
  });

  it("rejects invalid timing while allowing a single legal position", () => {
    for (const [current, minimum, maximum] of [
      [NaN, 0, 1000],
      [500, -1, 1000],
      [500, 1000, 0],
      [500, 0, Infinity],
      [500, NaN, 1000]
    ])
      expect(
        presentationTimingKeyTarget(
          { key: "ArrowRight" },
          current!,
          minimum!,
          maximum!
        )
      ).toBeNull();
    expect(presentationTimingKeyTarget({ key: "End" }, 0, 0, 0)).toBe(0);
  });
});
