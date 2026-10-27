import { describe, expect, it } from "vitest";
import { videoBounceMaxDurationMs } from "../src/library/presentation-media.js";

describe("streaming bounce budget", () => {
  it("offers thirty-second sections at normal source resolutions", () => {
    for (const [width, height] of [
      [480, 480],
      [1280, 720],
      [1920, 1080],
      [3840, 2160]
    ])
      expect(videoBounceMaxDurationMs(width!, height!)).toBe(30_000);
  });
  it("bounds high frame rates and single-frame work while rejecting unsupported dimensions", () => {
    expect(videoBounceMaxDurationMs(1279, 719)).toBe(0);
    expect(videoBounceMaxDurationMs(1280, 720, 60)).toBe(30_000);
    expect(videoBounceMaxDurationMs(3840, 2160, 120, 10)).toBe(30_000);
    expect(videoBounceMaxDurationMs(1920, 1080, 240)).toBe(15_000);
    expect(videoBounceMaxDurationMs(7680, 4320, 24, 8)).toBe(30_000);
    expect(videoBounceMaxDurationMs(7680, 4320, 24, 10)).toBe(0);
    expect(videoBounceMaxDurationMs(0, 1080)).toBe(0);
    expect(videoBounceMaxDurationMs(-2, -2)).toBe(0);
    expect(videoBounceMaxDurationMs(Infinity, 1080)).toBe(0);
    expect(videoBounceMaxDurationMs(NaN, 1080)).toBe(0);
  });
});
