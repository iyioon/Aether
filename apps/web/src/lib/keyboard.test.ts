import { describe, expect, it } from "vitest";
import {
  feedKeyboardCommand,
  hasShortcutModifier,
  ratingAfterKeyboardAdjustment,
  viewerKeyboardCommand
} from "./keyboard";

describe("keyboard commands", () => {
  it("maps feed navigation and media controls", () => {
    expect(feedKeyboardCommand("ArrowDown")).toBe("next");
    expect(feedKeyboardCommand("PageUp")).toBe("previous");
    expect(feedKeyboardCommand("Enter")).toBe("open");
    expect(feedKeyboardCommand(" ")).toBe("toggle-playback");
    expect(feedKeyboardCommand("m")).toBeNull();
  });

  it("maps viewer navigation and media controls case-insensitively", () => {
    expect(viewerKeyboardCommand("ArrowUp")).toBe("increase-rating");
    expect(viewerKeyboardCommand("ArrowDown")).toBe("decrease-rating");
    expect(viewerKeyboardCommand("ArrowLeft")).toBe("previous");
    expect(viewerKeyboardCommand("ArrowRight")).toBe("next");
    expect(viewerKeyboardCommand(" ")).toBe("toggle-playback");
    expect(viewerKeyboardCommand("m")).toBe("toggle-sound");
    expect(viewerKeyboardCommand("M")).toBe("toggle-sound");
    expect(viewerKeyboardCommand("i")).toBe("details");
    expect(viewerKeyboardCommand("Escape")).toBeNull();
  });

  it("adjusts keyboard ratings using the same zero-as-unrated behavior", () => {
    expect(ratingAfterKeyboardAdjustment(null, 1)).toBe(1);
    expect(ratingAfterKeyboardAdjustment(4, 1)).toBe(5);
    expect(ratingAfterKeyboardAdjustment(4, -1)).toBe(3);
    expect(ratingAfterKeyboardAdjustment(1, -1)).toBeNull();
    expect(ratingAfterKeyboardAdjustment(null, -1)).toBeNull();
  });

  it("recognizes command modifiers without treating Shift as a blocker", () => {
    expect(
      hasShortcutModifier({ altKey: false, ctrlKey: false, metaKey: false })
    ).toBe(false);
    expect(
      hasShortcutModifier({ altKey: false, ctrlKey: true, metaKey: false })
    ).toBe(true);
  });
});
