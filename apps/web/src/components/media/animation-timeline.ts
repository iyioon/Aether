import type { AnimationManifest, PresentationValues } from "../../api/client";

export interface AnimationTimelineFrame {
  frameIndex: number;
  durationMs: number;
  startMs: number;
  endMs: number;
  reverse: boolean;
}

export interface AnimationTimeline {
  frames: AnimationTimelineFrame[];
  endOffsets: number[];
  durationMs: number;
  startMs: number;
  endMs: number;
}

export function createAnimationTimeline(
  manifest: AnimationManifest,
  presentation: Pick<PresentationValues, "highlight" | "loopMode">,
  highlightsOnly: boolean
): AnimationTimeline {
  const highlight = highlightsOnly ? presentation.highlight : null;
  const startMs = Math.max(
    0,
    Math.min(manifest.durationMs - 1, highlight?.startMs ?? 0)
  );
  const endMs = Math.max(
    startMs + 1,
    Math.min(manifest.durationMs, highlight?.endMs ?? manifest.durationMs)
  );
  const frames: AnimationTimelineFrame[] = [];
  for (const [frameIndex, frame] of manifest.frames.entries()) {
    const start = Math.max(startMs, frame.startMs);
    const end = Math.min(endMs, frame.startMs + frame.durationMs);
    if (end > start)
      frames.push({
        frameIndex,
        durationMs: end - start,
        startMs: start,
        endMs: end,
        reverse: false
      });
  }
  // Interior frames form the return trip; neither endpoint is duplicated.
  if (
    presentation.loopMode === "bounce" &&
    (highlightsOnly || !presentation.highlight)
  ) {
    frames.push(
      ...frames
        .slice(1, -1)
        .reverse()
        .map((frame) => ({ ...frame, reverse: true }))
    );
  }
  let durationMs = 0;
  const endOffsets = frames.map((frame) => (durationMs += frame.durationMs));
  return { frames, endOffsets, durationMs, startMs, endMs };
}

export function animationTimelineFrame(
  timeline: AnimationTimeline,
  elapsedMs: number
): AnimationTimelineFrame {
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const position =
    ((elapsed % timeline.durationMs) + timeline.durationMs) %
    timeline.durationMs;
  let low = 0;
  let high = timeline.endOffsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (position < timeline.endOffsets[middle]!) high = middle;
    else low = middle + 1;
  }
  return timeline.frames[low]!;
}

export function animationSourceFrame(
  manifest: AnimationManifest,
  sourceTimeMs: number
): number {
  const time = Math.max(0, Math.min(manifest.durationMs - 1, sourceTimeMs));
  let low = 0;
  let high = manifest.frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const frame = manifest.frames[middle]!;
    if (time < frame.startMs + frame.durationMs) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function animationTimelinePosition(
  timeline: AnimationTimeline,
  sourceFrame: number
): number {
  const index = timeline.frames.findIndex(
    (frame) => frame.frameIndex >= sourceFrame
  );
  return index <= 0 ? 0 : timeline.endOffsets[index - 1]!;
}

export function animationTimelineTime(
  timeline: AnimationTimeline,
  elapsedMs: number
): number {
  const frame = animationTimelineFrame(timeline, elapsedMs);
  const index = timeline.frames.indexOf(frame);
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const position =
    ((elapsed % timeline.durationMs) + timeline.durationMs) %
    timeline.durationMs;
  const offset = position - (index > 0 ? timeline.endOffsets[index - 1]! : 0);
  return frame.reverse
    ? Math.max(frame.startMs, frame.endMs - 1 - offset)
    : Math.min(frame.endMs - 1, frame.startMs + offset);
}

export function animationPresentationKey(
  sourceKey: string,
  highlight: { startMs: number; endMs: number } | null,
  highlightsOnly: boolean
): string {
  const range = highlightsOnly ? highlight : null;
  return `${sourceKey}:${range?.startMs ?? ""}:${range?.endMs ?? ""}`;
}
