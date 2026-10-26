import { describe, expect, it } from "vitest";
import { videoBounceMaxDurationMs } from "../src/library/presentation-media.js";

describe("source-resolution bounce budget", () => {
  it("retains short low-resolution loops and reduces the reverse interval for larger sources", () => {
    expect(videoBounceMaxDurationMs(480, 480)).toBe(10_000);
    expect(videoBounceMaxDurationMs(1280, 720)).toBe(4041);
    expect(videoBounceMaxDurationMs(1920, 1080)).toBe(1791);
    expect(videoBounceMaxDurationMs(3840, 2160)).toBe(416);
  });
  it("accounts for source rate and bit depth and rejects unsupported dimensions", () => {
    expect(videoBounceMaxDurationMs(1279, 719)).toBe(0);
    expect(videoBounceMaxDurationMs(1280, 720, 60)).toBe(1616);
    expect(videoBounceMaxDurationMs(1280, 720, 24, 10)).toBe(2000);
    expect(videoBounceMaxDurationMs(0, 1080)).toBe(0);
    expect(videoBounceMaxDurationMs(-2, -2)).toBe(0);
    expect(videoBounceMaxDurationMs(Infinity, 1080)).toBe(0);
    expect(videoBounceMaxDurationMs(NaN, 1080)).toBe(0);
  });
});
