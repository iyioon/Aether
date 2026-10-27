import { describe, expect, it } from "vitest";
import {
  framingKeyboardCommand,
  zoomAfterKeyboardAdjustment
} from "./presentation-framing-keyboard";
import { panPresentation } from "./presentation-geometry";
import { defaultPresentationValues } from "./presentation-model";

function key(key: string, extra: Partial<KeyboardEvent> = {}) {
  return {
    key,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...extra
  };
}

describe("framing keyboard commands", () => {
  it("zooms with both key pairs and makes Shift adjustments finer", () => {
    expect(framingKeyboardCommand(key("="))).toEqual({
      type: "zoom",
      amount: 0.05
    });
    expect(framingKeyboardCommand(key("-"))).toEqual({
      type: "zoom",
      amount: -0.05
    });
    expect(framingKeyboardCommand(key("+", { shiftKey: true }))).toEqual({
      type: "zoom",
      amount: 0.01
    });
    expect(framingKeyboardCommand(key("_", { shiftKey: true }))).toEqual({
      type: "zoom",
      amount: -0.01
    });
    expect(framingKeyboardCommand(key("=", { shiftKey: true }))).toEqual({
      type: "zoom",
      amount: 0.01
    });
  });

  it("moves the framing position in the arrow direction and supports one-pixel adjustments", () => {
    const values = { ...defaultPresentationValues(), zoom: 2 };
    const source = { width: 600, height: 300 };
    const frame = { width: 300, height: 300 };
    for (const [name, axis, sign] of [
      ["ArrowRight", "focalX", 1],
      ["ArrowLeft", "focalX", -1],
      ["ArrowDown", "focalY", 1],
      ["ArrowUp", "focalY", -1]
    ] as const) {
      const command = framingKeyboardCommand(key(name));
      const fine = framingKeyboardCommand(key(name, { shiftKey: true }));
      if (command?.type !== "position" || fine?.type !== "position")
        throw new Error("Expected a position command");
      const next = panPresentation(values, source, frame, command);
      const fineNext = panPresentation(values, source, frame, fine);
      expect((next[axis] - 0.5) * sign).toBeGreaterThan(0);
      expect(Math.abs(next[axis] - 0.5)).toBeCloseTo(
        Math.abs(fineNext[axis] - 0.5) * 12
      );
    }
  });

  it("preserves browser shortcuts and composition", () => {
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "isComposing"]) {
      for (const name of ["=", "-", "ArrowLeft"])
        expect(
          framingKeyboardCommand(key(name, { [modifier]: true }))
        ).toBeNull();
    }
    for (const name of ["Tab", "Escape", " ", "Enter", "Home"])
      expect(framingKeyboardCommand(key(name))).toBeNull();
  });

  it("clamps zoom without accumulating floating-point error on repeated keys", () => {
    expect(zoomAfterKeyboardAdjustment(1, -0.05)).toBe(1);
    expect(zoomAfterKeyboardAdjustment(4, 0.05)).toBe(4);
    expect(zoomAfterKeyboardAdjustment(3.99, 0.05)).toBe(4);
    let zoom = 1;
    for (let index = 0; index < 20; index++)
      zoom = zoomAfterKeyboardAdjustment(zoom, 0.05);
    expect(zoom).toBe(2);
    expect(zoomAfterKeyboardAdjustment(zoom, -0.01)).toBe(1.99);
  });
});
