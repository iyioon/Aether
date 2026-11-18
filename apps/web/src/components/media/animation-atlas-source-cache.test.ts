import { describe, expect, it } from "vitest";
import { AnimationAtlasSourceCache } from "./animation-atlas-source-cache";

const source = (bytes: number) =>
  new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe("bounded animation atlas source cache", () => {
  it("reuses the retained Blob and evicts the least recently read source by bytes", () => {
    const cache = new AnimationAtlasSourceCache(6);
    const first = source(2);
    const second = source(2);
    const third = source(2);
    cache.set("first", first);
    cache.set("second", second);
    cache.set("third", third);
    expect(cache.get("first")).toBe(first);
    cache.set("fourth", source(2));
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(first);
    expect(cache.get("third")).toBe(third);
    expect(cache.get("fourth")?.size).toBe(2);
  });

  it("bounds small and empty sources by entry count", () => {
    const cache = new AnimationAtlasSourceCache(1024, 2);
    cache.set("first", source(0));
    cache.set("second", source(0));
    expect(cache.get("first")).toBeInstanceOf(Blob);
    cache.set("third", source(1));
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")?.size).toBe(0);
    expect(cache.get("third")?.size).toBe(1);
  });

  it("accounts for smaller and larger replacements without counting a URL twice", () => {
    const cache = new AnimationAtlasSourceCache(6, 2);
    cache.set("first", source(4));
    cache.set("second", source(2));
    const smaller = source(1);
    cache.set("first", smaller);
    cache.set("third", source(5));
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(smaller);
    const larger = source(6);
    cache.set("first", larger);
    expect(cache.get("third")).toBeUndefined();
    expect(cache.get("first")).toBe(larger);
  });

  it("does not retain oversized input or leave an older replacement at its URL", () => {
    const cache = new AnimationAtlasSourceCache(4);
    const kept = source(2);
    cache.set("kept", kept);
    cache.set("replaced", source(2));
    cache.set("oversized", source(5));
    expect(cache.get("oversized")).toBeUndefined();
    expect(cache.get("kept")).toBe(kept);
    cache.set("replaced", source(5));
    expect(cache.get("replaced")).toBeUndefined();
    expect(cache.get("kept")).toBe(kept);
  });

  it("releases deleted sources and reuses their byte capacity", () => {
    const cache = new AnimationAtlasSourceCache(4);
    const kept = source(2);
    cache.set("removed", source(2));
    cache.set("kept", kept);
    cache.delete("removed");
    cache.delete("missing");
    cache.set("added", source(2));
    expect(cache.get("removed")).toBeUndefined();
    expect(cache.get("kept")).toBe(kept);
    expect(cache.get("added")?.size).toBe(2);
  });

  it("clears private sources and resets byte accounting before reuse", () => {
    const cache = new AnimationAtlasSourceCache(4, 2);
    cache.set("old", source(4));
    cache.clear();
    expect(cache.get("old")).toBeUndefined();
    cache.set("first", source(2));
    cache.set("second", source(2));
    expect(cache.get("first")?.size).toBe(2);
    expect(cache.get("second")?.size).toBe(2);
    cache.clear();
    cache.clear();
    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBeUndefined();
  });

  it.each([
    [0, 2],
    [4, 0]
  ])(
    "disables retention for zero limits (%i bytes, %i entries)",
    (bytes, entries) => {
      const cache = new AnimationAtlasSourceCache(bytes, entries);
      cache.set("source", source(1));
      cache.set("empty", source(0));
      expect(cache.get("source")).toBeUndefined();
      expect(cache.get("empty")).toBeUndefined();
    }
  );

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid memory or entry limit: %s",
    (limit) => {
      expect(() => new AnimationAtlasSourceCache(limit)).toThrow(RangeError);
      expect(() => new AnimationAtlasSourceCache(4, limit)).toThrow(RangeError);
    }
  );
});
