import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../api/client";
import { defaultPresentationValues } from "./presentation-model";
import {
  bounceDurationExceeded,
  playbackVariant,
  presentationPlaybackUrl,
  presentationPosterUrl,
  sourceTimeForVideoBounce,
  videoBounceSeekTime,
  sourceTimeForPlayback
} from "./presentation-playback";
import { preservePresentation } from "./presentation-record";

function asset(revision = 1): AssetRecord {
  return {
    id: "asset-one",
    presentation: {
      ...defaultPresentationValues(),
      revision,
      renditionKeys: { full: "full", highlight: "highlight", bounce: "bounce" }
    }
  } as AssetRecord;
}
describe("saved playback selection", () => {
  it("requires a shorter source-size Bounce only when capabilities establish a limit", () => {
    const current = { ...asset(), durationMs: 6000 };
    expect(bounceDurationExceeded(current)).toBe(false);
    expect(bounceDurationExceeded(current, 1250)).toBe(true);
    current.presentation!.highlight = { startMs: 1000, endMs: 2250 };
    expect(bounceDurationExceeded(current, 1250)).toBe(false);
    expect(bounceDurationExceeded(current, 0)).toBe(true);
  });
  it("plays the full source unless highlight-only is selected", () => {
    const current = asset();
    current.presentation!.highlight = { startMs: 1000, endMs: 3000 };
    expect(playbackVariant(current, false)).toBe("full");
    expect(playbackVariant(current, true)).toBe("highlight");
    current.presentation!.loopMode = "bounce";
    expect(playbackVariant(current, false)).toBe("full");
    expect(playbackVariant(current, true)).toBe("bounce");
    current.presentation!.highlight = null;
    expect(playbackVariant(current, false)).toBe("bounce");
  });
  it("uses opaque version keys and only requests a highlight poster when needed", () => {
    const current = asset();
    expect(presentationPosterUrl(current, true)).toBeNull();
    current.presentation!.highlight = { startMs: 1000, endMs: 3000 };
    expect(presentationPosterUrl(current, false)).toBeNull();
    expect(presentationPosterUrl(current, true)).toContain(
      "presentation-poster?variant=highlight&v=highlight"
    );
    expect(presentationPlaybackUrl(current, "bounce")).toBe(
      "/api/assets/asset-one/playback?variant=bounce&v=bounce"
    );
  });
  it("maps rendition times to original source times in both directions", () => {
    expect(sourceTimeForPlayback(0, 3, 7, false)).toBe(3);
    expect(sourceTimeForPlayback(2, 3, 7, false)).toBe(5);
    expect(sourceTimeForPlayback(99, 3, 7, false)).toBe(7);
    expect(sourceTimeForPlayback(5, 3, 7, true)).toBe(6);
    expect(sourceTimeForPlayback(8, 3, 7, true)).toBe(3);
  });
});
describe("presentation response ordering", () => {
  it("retains newer presentation while accepting a delayed score response", () => {
    const current = asset(3);
    const incoming = { ...asset(2), score: 7 };
    const merged = preservePresentation(current, incoming);
    expect(merged.score).toBe(7);
    expect(merged.presentation).toBe(current.presentation);
    expect(preservePresentation(current, asset(4)).presentation!.revision).toBe(
      4
    );
  });
  it("accepts a reset revision and does not transfer edits between assets", () => {
    const current = asset(3);
    current.presentation!.zoom = 2;
    expect(preservePresentation(current, asset(4)).presentation!.zoom).toBe(1);
    const other = { ...asset(1), id: "other" };
    expect(preservePresentation(current, other)).toBe(other);
  });
});

describe("video bounce source clock", () => {
  it("matches the source clock through forward and reversed interior frames", () => {
    const timeline = {
      sourceTimesMs: Array.from(
        { length: 12 },
        (_, i) => 2000 + (i * 1000) / 24
      ),
      durationsMs: Array.from({ length: 12 }, () => 1000 / 24)
    };
    const sequence = Array.from({ length: 22 }, (_, index) =>
      Math.round(
        (sourceTimeForVideoBounce(index / 24, 2, 2.5, timeline) - 2) * 24
      )
    );
    expect(sequence).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
    ]);
    expect(presentationPlaybackUrl(asset(), "bounce", "h264")).toContain(
      "&codec=h264"
    );
    expect(videoBounceSeekTime(2.5, 2, 2.5, timeline)).toBeCloseTo(11 / 24);
  });
  it("handles one and two frame sections without an artificial return trip", () => {
    expect(
      sourceTimeForVideoBounce(0.5, 1, 1.04, {
        sourceTimesMs: [1000],
        durationsMs: [40]
      })
    ).toBe(1);
    expect(
      sourceTimeForVideoBounce(1 / 24, 1, 1.08, {
        sourceTimesMs: [1000, 1000 + 1000 / 24],
        durationsMs: [1000 / 24, 1000 / 24]
      })
    ).toBe(1 + 1 / 24);
  });
});

describe("variable-rate Bounce source clock", () => {
  const timeline = {
    sourceTimesMs: [2000, 2010, 2060, 2080],
    durationsMs: [10, 50, 20, 40]
  };
  it("keeps variable frame holds and reverses only interior frames", () => {
    const times = [
      0, 0.009, 0.01, 0.059, 0.06, 0.08, 0.119, 0.12, 0.139, 0.14, 0.189
    ];
    expect(
      times.map((time) => sourceTimeForVideoBounce(time, 2, 2.12, timeline))
    ).toEqual([2, 2, 2.01, 2.01, 2.06, 2.08, 2.08, 2.06, 2.06, 2.01, 2.01]);
    expect(videoBounceSeekTime(2.075, 2, 2.12, timeline)).toBe(0.06);
    expect(videoBounceSeekTime(2.12, 2, 2.12, timeline)).toBe(0.08);
    expect(videoBounceSeekTime(0, 2, 2.12, timeline)).toBe(0);
  });
  it("does not infer a frame rate before the source timeline arrives", () => {
    expect(sourceTimeForVideoBounce(99, 2, 3)).toBe(2);
    expect(videoBounceSeekTime(2.5, 2, 3)).toBe(0);
  });
});
