import type { AnimationManifest } from "../../api/client";

export const ANIMATION_FRAME_LIMIT = 600;
export const ANIMATION_DURATION_LIMIT_MS = 60_000;
export const ANIMATION_ATLAS_SIDE_LIMIT = 2048;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function validateAnimationManifest(
  value: unknown,
  assetId: string,
  renditionKey: string,
  origin: string
): AnimationManifest {
  if (
    !record(value) ||
    value.kind !== "animation" ||
    !integer(value.durationMs, 1, ANIMATION_DURATION_LIMIT_MS) ||
    !integer(value.width, 1, ANIMATION_ATLAS_SIDE_LIMIT) ||
    !integer(value.height, 1, ANIMATION_ATLAS_SIDE_LIMIT) ||
    !Array.isArray(value.frames) ||
    value.frames.length < 1 ||
    value.frames.length > ANIMATION_FRAME_LIMIT ||
    !Array.isArray(value.atlases) ||
    value.atlases.length < 1 ||
    value.atlases.length > ANIMATION_FRAME_LIMIT
  ) {
    throw new Error("Invalid animation manifest.");
  }
  const atlases: AnimationManifest["atlases"] = value.atlases.map(
    (atlas: unknown, index) => {
      if (
        !record(atlas) ||
        typeof atlas.url !== "string" ||
        !integer(atlas.width, 1, ANIMATION_ATLAS_SIDE_LIMIT) ||
        !integer(atlas.height, 1, ANIMATION_ATLAS_SIDE_LIMIT)
      ) {
        throw new Error("Invalid animation atlas.");
      }
      const url = new URL(atlas.url, origin);
      const expectedPath = `/api/assets/${encodeURIComponent(assetId)}/animation/atlases/${index}`;
      if (
        url.origin !== origin ||
        url.pathname !== expectedPath ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.size !== 1 ||
        url.searchParams.get("v") !== renditionKey
      ) {
        throw new Error("Invalid animation atlas URL.");
      }
      return {
        url: url.pathname + url.search,
        width: atlas.width,
        height: atlas.height
      };
    }
  );
  let nextStart = 0;
  const frames: AnimationManifest["frames"] = value.frames.map(
    (frame: unknown) => {
      if (
        !record(frame) ||
        !integer(frame.startMs, 0, value.durationMs as number) ||
        !integer(frame.durationMs, 1, value.durationMs as number) ||
        frame.startMs !== nextStart ||
        !integer(frame.atlas, 0, atlases.length - 1) ||
        !integer(frame.x, 0, ANIMATION_ATLAS_SIDE_LIMIT) ||
        !integer(frame.y, 0, ANIMATION_ATLAS_SIDE_LIMIT) ||
        frame.width !== value.width ||
        frame.height !== value.height
      ) {
        throw new Error("Invalid animation frame.");
      }
      const atlas = atlases[frame.atlas]!;
      if (
        frame.x + (frame.width as number) > atlas.width ||
        frame.y + (frame.height as number) > atlas.height
      ) {
        throw new Error("Animation frame exceeds its atlas.");
      }
      nextStart += frame.durationMs;
      return {
        startMs: frame.startMs,
        durationMs: frame.durationMs,
        atlas: frame.atlas,
        x: frame.x,
        y: frame.y,
        width: frame.width as number,
        height: frame.height as number
      };
    }
  );
  if (nextStart !== value.durationMs) {
    throw new Error("Animation duration does not match its frames.");
  }
  return {
    kind: "animation",
    durationMs: value.durationMs,
    width: value.width,
    height: value.height,
    frames,
    atlases
  };
}
