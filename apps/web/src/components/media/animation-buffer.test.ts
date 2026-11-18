import { describe, expect, it } from "vitest";
import type { AnimationManifest } from "../../api/client";
import { animationAtlasLookahead } from "./animation-buffer";
import { defaultPresentationValues } from "./presentation-model";
import { createAnimationTimeline } from "./animation-timeline";

function animation(atlases: number[], delays = atlases.map(() => 100)) {
  let durationMs = 0;
  const frames = atlases.map((atlas, index) => {
    const startMs = durationMs;
    const delay = delays[index]!;
    durationMs += delay;
    return {
      startMs,
      durationMs: delay,
      atlas,
      x: 0,
      y: 0,
      width: 10,
      height: 10
    };
  });
  const manifest: AnimationManifest = {
    kind: "animation",
    width: 10,
    height: 10,
    durationMs,
    frames,
    atlases: Array.from({ length: Math.max(...atlases) + 1 }, (_, index) => ({
      url: `atlas-${index}`,
      width: 10,
      height: 10
    }))
  };
  return manifest;
}

const defaults = defaultPresentationValues();

describe("bounded animation atlas lookahead", () => {
  it("looks beyond packed frames to prepare the nearest two distinct atlases", () => {
    const manifest = animation(
      [0, 0, 0, 0, 1, 1, 2, 3],
      Array.from({ length: 8 }, () => 50)
    );
    const timeline = createAnimationTimeline(manifest, defaults, false);
    expect(animationAtlasLookahead(manifest, timeline, 0, 1)).toEqual([1, 2]);
  });

  it("bounds fast single-frame atlases to the nearest two", () => {
    const manifest = animation(
      [0, 1, 2, 3, 4],
      Array.from({ length: 5 }, () => 20)
    );
    const timeline = createAnimationTimeline(manifest, defaults, false);
    expect(animationAtlasLookahead(manifest, timeline, 0, 1)).toEqual([1, 2]);
  });

  it("uses the remaining frame hold and a 500ms wall-clock lead at each rate", () => {
    const manifest = animation([0, 1, 2], [1000, 1000, 1000]);
    const timeline = createAnimationTimeline(manifest, defaults, false);
    expect(animationAtlasLookahead(manifest, timeline, 499, 1)).toEqual([]);
    expect(animationAtlasLookahead(manifest, timeline, 500, 1)).toEqual([1]);
    expect(animationAtlasLookahead(manifest, timeline, 749, 0.5)).toEqual([]);
    expect(animationAtlasLookahead(manifest, timeline, 750, 0.5)).toEqual([1]);
    expect(animationAtlasLookahead(manifest, timeline, 0, 2)).toEqual([1]);
    expect(animationAtlasLookahead(manifest, timeline, 1000, 1)).toEqual([]);
  });

  it("wraps repeat playback and normalizes elapsed time", () => {
    const manifest = animation([0, 1, 2], [200, 200, 200]);
    const timeline = createAnimationTimeline(manifest, defaults, false);
    for (const elapsed of [500, 1100, -100])
      expect(animationAtlasLookahead(manifest, timeline, elapsed, 1)).toEqual([
        0, 1
      ]);
    expect(animationAtlasLookahead(manifest, timeline, NaN, 1)).toEqual([1, 2]);
  });

  it("prepares atlases in the upcoming Bounce direction", () => {
    const manifest = animation([0, 1, 2, 3]);
    const timeline = createAnimationTimeline(
      manifest,
      { ...defaults, loopMode: "bounce" },
      false
    );
    expect(animationAtlasLookahead(manifest, timeline, 300, 1)).toEqual([2, 1]);
    expect(animationAtlasLookahead(manifest, timeline, 400, 1)).toEqual([1, 0]);
  });

  it("uses clipped variable holds and does not prepare outside a highlight", () => {
    const manifest = animation([0, 1, 2, 3], [200, 300, 800, 200]);
    const timeline = createAnimationTimeline(
      manifest,
      { ...defaults, highlight: { startMs: 250, endMs: 1000 } },
      true
    );
    expect(animationAtlasLookahead(manifest, timeline, 0, 1)).toEqual([2]);
    expect(animationAtlasLookahead(manifest, timeline, 700, 1)).toEqual([1]);
  });

  it("excludes the current atlas and repeated occurrences within a short cycle", () => {
    const manifest = animation([0, 1, 0, 1], [10, 10, 10, 10]);
    const timeline = createAnimationTimeline(manifest, defaults, false);
    expect(animationAtlasLookahead(manifest, timeline, 0, 1)).toEqual([1]);
    const oneAtlas = animation([0, 0, 0]);
    expect(
      animationAtlasLookahead(
        oneAtlas,
        createAnimationTimeline(oneAtlas, defaults, false),
        0,
        1
      )
    ).toEqual([]);
  });

  it("does no preparation for invalid rates or an empty timeline", () => {
    const manifest = animation([0, 1, 2]);
    const timeline = createAnimationTimeline(manifest, defaults, false);
    for (const rate of [0, -1, NaN, Infinity])
      expect(animationAtlasLookahead(manifest, timeline, 0, rate)).toEqual([]);
    expect(
      animationAtlasLookahead(
        manifest,
        { ...timeline, frames: [], endOffsets: [], durationMs: 0 },
        0,
        1
      )
    ).toEqual([]);
    expect(
      animationAtlasLookahead(manifest, timeline, 0, Number.MAX_VALUE)
    ).toEqual([1, 2]);
  });
});
