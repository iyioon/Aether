import { describe, expect, it } from "vitest";
import type { AnimationManifest } from "../../api/client";
import { validateAnimationManifest } from "./animation-manifest";

const origin = "https://aether.test";
const key = "revision-key";
function manifest(): AnimationManifest {
  return {
    kind: "animation",
    width: 10,
    height: 20,
    durationMs: 600,
    atlases: [
      {
        url: `/api/assets/asset/animation/atlases/0?v=${key}`,
        width: 30,
        height: 20
      }
    ],
    frames: [
      {
        startMs: 0,
        durationMs: 100,
        atlas: 0,
        x: 0,
        y: 0,
        width: 10,
        height: 20
      },
      {
        startMs: 100,
        durationMs: 300,
        atlas: 0,
        x: 10,
        y: 0,
        width: 10,
        height: 20
      },
      {
        startMs: 400,
        durationMs: 200,
        atlas: 0,
        x: 20,
        y: 0,
        width: 10,
        height: 20
      }
    ]
  };
}

describe("authenticated animation manifests", () => {
  it("accepts contiguous variable frame delays and preserves tile geometry", () => {
    expect(validateAnimationManifest(manifest(), "asset", key, origin)).toEqual(
      manifest()
    );
  });

  it.each([
    "https://other.test/api/assets/asset/animation/atlases/0?v=revision-key",
    "/api/assets/another/animation/atlases/0?v=revision-key",
    "/api/assets/asset/animation/atlases/1?v=revision-key",
    "/api/assets/asset/animation/atlases/0?v=old",
    "/api/assets/asset/animation/atlases/0?v=revision-key&extra=1",
    "/api/assets/asset/animation/atlases/0?v=revision-key&v=revision-key",
    "/api/assets/asset/animation/atlases/0?v=revision-key#fragment",
    "https://user:password@aether.test/api/assets/asset/animation/atlases/0?v=revision-key",
    "data:image/png;base64,AAAA"
  ])("rejects an untrusted or mismatched atlas URL: %s", (url) => {
    const value = manifest();
    value.atlases[0]!.url = url;
    expect(() =>
      validateAnimationManifest(value, "asset", key, origin)
    ).toThrow();
  });

  it("rejects unbounded dimensions, frame counts and duration before media is requested", () => {
    for (const invalid of [
      { ...manifest(), width: 2049 },
      { ...manifest(), durationMs: 60001 },
      {
        ...manifest(),
        frames: Array.from({ length: 601 }, () => manifest().frames[0])
      },
      { ...manifest(), atlases: [{ ...manifest().atlases[0], height: 2049 }] },
      { ...manifest(), frames: [] },
      { ...manifest(), kind: "image" },
      null
    ]) {
      expect(() =>
        validateAnimationManifest(invalid, "asset", key, origin)
      ).toThrow();
    }
  });

  it("rejects gaps, overlap, invalid delays, missing atlases and out-of-bounds rectangles", () => {
    for (const replacement of [
      { startMs: 101 },
      { startMs: 99 },
      { durationMs: 0 },
      { durationMs: NaN },
      { durationMs: 300.5 },
      { atlas: 1 },
      { x: 25 },
      { y: 1 },
      { width: 9 },
      { height: 19 }
    ]) {
      const value = manifest();
      value.frames[1] = { ...value.frames[1]!, ...replacement };
      expect(() =>
        validateAnimationManifest(value, "asset", key, origin)
      ).toThrow();
    }
    expect(() =>
      validateAnimationManifest(
        { ...manifest(), durationMs: 601 },
        "asset",
        key,
        origin
      )
    ).toThrow();
  });
});
