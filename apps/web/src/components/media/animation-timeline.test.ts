import { describe, expect, it } from "vitest";
import type { AnimationManifest } from "../../api/client";
import { defaultPresentationValues } from "./presentation-model";
import {
  animationSourceFrame,
  animationTimelineFrame,
  animationTimelinePosition,
  animationTimelineTime,
  createAnimationTimeline
} from "./animation-timeline";

const manifest: AnimationManifest = {
  kind: "animation",
  width: 10,
  height: 10,
  durationMs: 1000,
  atlases: [],
  frames: [
    {
      startMs: 0,
      durationMs: 100,
      atlas: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10
    },
    {
      startMs: 100,
      durationMs: 200,
      atlas: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10
    },
    {
      startMs: 300,
      durationMs: 400,
      atlas: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10
    },
    {
      startMs: 700,
      durationMs: 300,
      atlas: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10
    }
  ]
};
const defaults = defaultPresentationValues();

describe("controlled animation source timing", () => {
  it("uses variable delays, exact boundaries and repeat wraparound", () => {
    const timeline = createAnimationTimeline(manifest, defaults, false);
    expect(timeline.durationMs).toBe(1000);
    expect(
      [0, 99, 100, 299, 300, 699, 700, 999, 1000, 1100].map(
        (time) => animationTimelineFrame(timeline, time).frameIndex
      )
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0, 1]);
    expect(animationTimelineTime(timeline, 150)).toBe(150);
    expect(animationTimelineTime(timeline, NaN)).toBe(0);
    expect(animationTimelineFrame(timeline, -1).frameIndex).toBe(3);
  });

  it("clips boundary frame delays to the exact source highlight", () => {
    const values = { ...defaults, highlight: { startMs: 50, endMs: 800 } };
    const timeline = createAnimationTimeline(manifest, values, true);
    expect(timeline.frames.map((frame) => frame.durationMs)).toEqual([
      50, 200, 400, 100
    ]);
    expect(timeline.durationMs).toBe(750);
    expect(animationTimelineTime(timeline, 0)).toBe(50);
    expect(animationTimelineTime(timeline, 25)).toBe(75);
    expect(animationTimelineTime(timeline, 749)).toBe(799);
    expect(animationTimelineTime(timeline, 750)).toBe(50);
    expect(createAnimationTimeline(manifest, values, false).durationMs).toBe(
      1000
    );
  });

  it("bounces through interior frames with no duplicate endpoints", () => {
    const timeline = createAnimationTimeline(
      manifest,
      { ...defaults, loopMode: "bounce" },
      false
    );
    expect(timeline.frames.map((frame) => frame.frameIndex)).toEqual([
      0, 1, 2, 3, 2, 1
    ]);
    expect(timeline.frames.map((frame) => frame.durationMs)).toEqual([
      100, 200, 400, 300, 400, 200
    ]);
    expect(timeline.durationMs).toBe(1600);
    expect(animationTimelineTime(timeline, 1000)).toBe(699);
    expect(animationTimelineTime(timeline, 1100)).toBe(599);
    expect(animationTimelineTime(timeline, 1400)).toBe(299);
    expect(animationTimelineTime(timeline, 1600)).toBe(0);
  });

  it("does not apply a saved section bounce while showing the full source", () => {
    const values = {
      ...defaults,
      loopMode: "bounce" as const,
      highlight: { startMs: 50, endMs: 800 }
    };
    expect(
      createAnimationTimeline(manifest, values, false).frames
    ).toHaveLength(4);
    expect(createAnimationTimeline(manifest, values, true).frames).toHaveLength(
      6
    );
  });

  it("supports one-frame and two-frame highlights without inserting duplicate frames", () => {
    const values = { ...defaults, loopMode: "bounce" as const };
    expect(
      createAnimationTimeline(
        manifest,
        { ...values, highlight: { startMs: 150, endMs: 200 } },
        true
      ).frames.map((frame) => frame.frameIndex)
    ).toEqual([1]);
    expect(
      createAnimationTimeline(
        manifest,
        { ...values, highlight: { startMs: 150, endMs: 400 } },
        true
      ).frames.map((frame) => frame.frameIndex)
    ).toEqual([1, 2]);
  });

  it("seeks by source time and maps the forward occurrence in a bounce", () => {
    const timeline = createAnimationTimeline(
      manifest,
      { ...defaults, loopMode: "bounce" },
      false
    );
    expect(
      [-100, 0, 99, 100, 699, 700, 1000, 5000].map((time) =>
        animationSourceFrame(manifest, time)
      )
    ).toEqual([0, 0, 0, 1, 2, 3, 3, 3]);
    expect(animationTimelinePosition(timeline, 2)).toBe(300);
    const highlight = createAnimationTimeline(
      manifest,
      { ...defaults, highlight: { startMs: 300, endMs: 800 } },
      true
    );
    expect(animationTimelinePosition(highlight, 0)).toBe(0);
    expect(animationTimelinePosition(highlight, 3)).toBe(400);
  });
});
