import type { AnimationManifest } from "../../api/client";
import {
  animationTimelineFrame,
  type AnimationTimeline
} from "./animation-timeline";

export const ANIMATION_LOOKAHEAD_MS = 500;
export const ANIMATION_LOOKAHEAD_ATLASES = 2;

export function animationAtlasLookahead(
  manifest: AnimationManifest,
  timeline: AnimationTimeline,
  elapsedMs: number,
  playbackRate: number
): number[] {
  if (
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0 ||
    !Number.isFinite(timeline.durationMs) ||
    timeline.durationMs <= 0 ||
    timeline.frames.length === 0
  )
    return [];

  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const position =
    ((elapsed % timeline.durationMs) + timeline.durationMs) %
    timeline.durationMs;
  const current = animationTimelineFrame(timeline, position);
  const currentPosition = timeline.frames.indexOf(current);
  const currentAtlas = manifest.frames[current.frameIndex]?.atlas;
  if (currentAtlas === undefined) return [];

  const lead = Math.min(
    timeline.durationMs,
    ANIMATION_LOOKAHEAD_MS * playbackRate
  );
  let distance = timeline.endOffsets[currentPosition]! - position;
  const upcoming: number[] = [];
  // One cycle covers every distinct atlas, including the return trip in Bounce.
  for (let ahead = 1; ahead <= timeline.frames.length; ahead += 1) {
    if (distance > lead) break;
    const next =
      timeline.frames[(currentPosition + ahead) % timeline.frames.length]!;
    const atlas = manifest.frames[next.frameIndex]?.atlas;
    if (
      atlas !== undefined &&
      atlas !== currentAtlas &&
      !upcoming.includes(atlas)
    ) {
      upcoming.push(atlas);
      if (upcoming.length === ANIMATION_LOOKAHEAD_ATLASES) break;
    }
    distance += next.durationMs;
  }
  return upcoming;
}
