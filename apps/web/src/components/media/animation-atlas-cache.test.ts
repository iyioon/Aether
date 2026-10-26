import { describe, expect, it, vi } from "vitest";
import {
  AnimationAtlasCache,
  type DecodedAnimationAtlas
} from "./animation-atlas-cache";

const descriptor = (index: number) => ({
  url: `atlas-${index}`,
  width: 1,
  height: 1
});
function decoded(): DecodedAnimationAtlas {
  return {
    image: {} as CanvasImageSource,
    width: 1,
    height: 1,
    dispose: vi.fn()
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("bounded decoded animation atlas cache", () => {
  it("shares concurrent work, draws current consumers and keeps only three least-recently-used atlases", async () => {
    const decodedAtlases = Array.from({ length: 4 }, decoded);
    const load = vi.fn(
      async (atlas: { url: string }) =>
        decodedAtlases[Number(atlas.url.at(-1))]!
    );
    const cache = new AnimationAtlasCache(load);
    const signal = new AbortController().signal;
    const draw = vi.fn();
    await Promise.all([
      cache.use(descriptor(0), signal, draw),
      cache.use(descriptor(0), signal, draw)
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(2);
    await cache.use(descriptor(1), signal, draw);
    await cache.use(descriptor(2), signal, draw);
    await cache.use(descriptor(0), signal, draw);
    await cache.use(descriptor(3), signal, draw);
    expect(decodedAtlases[1]!.dispose).toHaveBeenCalledOnce();
    expect(decodedAtlases[0]!.dispose).not.toHaveBeenCalled();
    cache.clear();
    for (const atlas of decodedAtlases)
      expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("cancels one consumer without interrupting another and aborts work after the last leaves", async () => {
    const pending = deferred<DecodedAnimationAtlas>();
    let loadSignal: AbortSignal | null = null;
    const cache = new AnimationAtlasCache((_atlas, signal) => {
      loadSignal = signal;
      return pending.promise;
    });
    const first = new AbortController();
    const second = new AbortController();
    const draw = vi.fn();
    const firstPromise = cache.use(descriptor(0), first.signal, draw);
    const secondPromise = cache.use(descriptor(0), second.signal, draw);
    first.abort();
    await expect(firstPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(loadSignal!.aborted).toBe(false);
    second.abort();
    await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(loadSignal!.aborted).toBe(true);
    const atlas = decoded();
    pending.resolve(atlas);
    await Promise.resolve();
    expect(atlas.dispose).toHaveBeenCalledOnce();
    expect(draw).not.toHaveBeenCalled();
  });

  it("limits concurrent fetch/decode work and advances its queue after a failure", async () => {
    const jobs = Array.from({ length: 3 }, () =>
      deferred<DecodedAnimationAtlas>()
    );
    const load = vi.fn(
      (atlas: { url: string }) => jobs[Number(atlas.url.at(-1))]!.promise
    );
    const cache = new AnimationAtlasCache(load);
    const signal = new AbortController().signal;
    const first = cache.use(descriptor(0), signal, () => undefined);
    const second = cache.use(descriptor(1), signal, () => undefined);
    const third = cache.use(descriptor(2), signal, () => undefined);
    expect(load).toHaveBeenCalledTimes(2);
    jobs[0]!.reject(new Error("failed"));
    await expect(first).rejects.toThrow("failed");
    expect(load).toHaveBeenCalledTimes(3);
    jobs[1]!.resolve(decoded());
    jobs[2]!.resolve(decoded());
    await Promise.all([second, third]);
    cache.clear();
  });

  it("rejects an already cancelled request and releases late decodes on clear", async () => {
    const job = deferred<DecodedAnimationAtlas>();
    const load = vi.fn(() => job.promise);
    const cache = new AnimationAtlasCache(load);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      cache.use(descriptor(0), aborted.signal, () => undefined)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(load).not.toHaveBeenCalled();
    const pending = cache.use(
      descriptor(0),
      new AbortController().signal,
      () => undefined
    );
    cache.clear();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const atlas = decoded();
    job.resolve(atlas);
    await Promise.resolve();
    expect(atlas.dispose).toHaveBeenCalledOnce();
  });
});
