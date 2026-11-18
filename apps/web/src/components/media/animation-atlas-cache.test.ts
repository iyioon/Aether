import { describe, expect, it, vi } from "vitest";
import {
  AnimationAtlasCache,
  type DecodedAnimationAtlas
} from "./animation-atlas-cache";

const descriptor = (index: number, side = 1) => ({
  url: `atlas-${index}`,
  width: side,
  height: side
});
function decoded(side = 1): DecodedAnimationAtlas {
  return {
    image: {} as CanvasImageSource,
    width: side,
    height: side,
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
  it("does not keep speculative cache hits ahead of useful decoded atlases", async () => {
    const atlases = new Map<string, DecodedAnimationAtlas>();
    const load = vi.fn(async (atlas: { url: string }) => {
      const value = decoded();
      atlases.set(atlas.url, value);
      return value;
    });
    const cache = new AnimationAtlasCache(load, 12);
    const signal = new AbortController().signal;
    for (let index = 0; index < 3; index++)
      await cache.prefetch(descriptor(index), signal);
    await cache.prefetch(descriptor(0), signal);
    await cache.prefetch(descriptor(3), signal);
    expect(atlases.get("atlas-0")!.dispose).toHaveBeenCalledOnce();
    expect(atlases.get("atlas-1")!.dispose).not.toHaveBeenCalled();
    await cache.use(descriptor(1), signal, () => undefined);
    expect(load).toHaveBeenCalledTimes(4);
    cache.clear();
    for (const atlas of atlases.values())
      expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("prioritizes visible frames and promotes queued speculation without duplicate decoding", async () => {
    const jobs = Array.from({ length: 4 }, () =>
      deferred<DecodedAnimationAtlas>()
    );
    const load = vi.fn(
      (atlas: { url: string }) => jobs[Number(atlas.url.at(-1))]!.promise
    );
    const cache = new AnimationAtlasCache(load, 48 * 1024 * 1024, 32, 1);
    const signal = new AbortController().signal;
    const first = cache.prefetch(descriptor(0), signal);
    const speculative = cache.prefetch(descriptor(1), signal);
    const promotedPrefetch = cache.prefetch(descriptor(2), signal);
    const visibleDraw = vi.fn();
    const visible = cache.use(
      descriptor(3),
      new AbortController().signal,
      visibleDraw
    );
    const promotedDraw = vi.fn();
    const promoted = cache.use(descriptor(2), signal, promotedDraw);
    const started = () => load.mock.calls.map(([atlas]) => atlas.url);
    expect(started()).toEqual(["atlas-0"]);
    jobs[0]!.resolve(decoded());
    await first;
    expect(started()).toEqual(["atlas-0", "atlas-2"]);
    jobs[2]!.resolve(decoded());
    await Promise.all([promotedPrefetch, promoted]);
    expect(promotedDraw).toHaveBeenCalledOnce();
    expect(started()).toEqual(["atlas-0", "atlas-2", "atlas-3"]);
    jobs[3]!.resolve(decoded());
    await visible;
    expect(visibleDraw).toHaveBeenCalledOnce();
    expect(started()).toEqual(["atlas-0", "atlas-2", "atlas-3", "atlas-1"]);
    jobs[1]!.resolve(decoded());
    await speculative;
    cache.clear();
  });

  it("keeps two players' current full-size atlases through speculative completion within the byte budget", async () => {
    const atlases = new Map<string, DecodedAnimationAtlas>();
    const load = vi.fn(async (atlas: { url: string }) => {
      const value = decoded(2048);
      atlases.set(atlas.url, value);
      return value;
    });
    const cache = new AnimationAtlasCache(load);
    const first = new AbortController();
    const second = new AbortController();
    await cache.use(descriptor(0, 2048), first.signal, () => undefined);
    await cache.use(descriptor(1, 2048), second.signal, () => undefined);
    for (let index = 2; index < 5; index++)
      await cache.prefetch(
        descriptor(index, 2048),
        new AbortController().signal
      );
    expect(atlases.get("atlas-0")!.dispose).not.toHaveBeenCalled();
    expect(atlases.get("atlas-1")!.dispose).not.toHaveBeenCalled();
    expect(atlases.get("atlas-2")!.dispose).toHaveBeenCalledOnce();
    expect(atlases.get("atlas-3")!.dispose).toHaveBeenCalledOnce();
    expect(atlases.get("atlas-4")!.dispose).not.toHaveBeenCalled();
    await cache.use(descriptor(0, 2048), first.signal, () => undefined);
    await cache.use(descriptor(1, 2048), second.signal, () => undefined);
    expect(load).toHaveBeenCalledTimes(5);
    cache.clear();
    for (const atlas of atlases.values())
      expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("releases a suspended player's current atlas and disposes its late speculative decode", async () => {
    const pending = deferred<DecodedAnimationAtlas>();
    const atlases = new Map<string, DecodedAnimationAtlas>();
    let speculativeSignal: AbortSignal | null = null;
    const load = vi.fn(async (atlas: { url: string }, signal: AbortSignal) => {
      if (atlas.url === "atlas-4") {
        speculativeSignal = signal;
        return pending.promise;
      }
      const value = decoded();
      atlases.set(atlas.url, value);
      return value;
    });
    const cache = new AnimationAtlasCache(load, 12);
    const suspended = new AbortController();
    const active = new AbortController();
    const future = new AbortController();
    await cache.use(descriptor(0), suspended.signal, () => undefined);
    await cache.use(descriptor(1), active.signal, () => undefined);
    await cache.prefetch(descriptor(2), new AbortController().signal);
    const cancelled = cache.prefetch(descriptor(4), future.signal);
    suspended.abort();
    future.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(speculativeSignal!.aborted).toBe(true);
    await cache.prefetch(descriptor(3), new AbortController().signal);
    expect(atlases.get("atlas-0")!.dispose).toHaveBeenCalledOnce();
    expect(atlases.get("atlas-1")!.dispose).not.toHaveBeenCalled();
    const late = decoded();
    pending.resolve(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late.dispose).toHaveBeenCalledOnce();
    await cache.use(descriptor(1), active.signal, () => undefined);
    expect(load).toHaveBeenCalledTimes(5);
    cache.clear();
    for (const atlas of atlases.values())
      expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("keeps current and nearer future frames ahead of farther speculative completions", async () => {
    const atlases = new Map<string, DecodedAnimationAtlas>();
    const load = vi.fn(async (atlas: { url: string }) => {
      const value = decoded();
      atlases.set(atlas.url, value);
      return value;
    });
    const cache = new AnimationAtlasCache(load, 12);
    await cache.use(
      descriptor(0),
      new AbortController().signal,
      () => undefined
    );
    await cache.prefetch(descriptor(1), new AbortController().signal, 0);
    await cache.prefetch(descriptor(2), new AbortController().signal, 1);
    await cache.prefetch(descriptor(3), new AbortController().signal, 2);
    expect(atlases.get("atlas-3")!.dispose).toHaveBeenCalledOnce();
    expect(atlases.get("atlas-2")!.dispose).not.toHaveBeenCalled();
    await cache.prefetch(descriptor(4), new AbortController().signal, 0);
    expect(atlases.get("atlas-2")!.dispose).toHaveBeenCalledOnce();
    for (const index of [0, 1, 4])
      expect(atlases.get(`atlas-${index}`)!.dispose).not.toHaveBeenCalled();
    cache.clear();
    for (const atlas of atlases.values())
      expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("starts nearer queued speculation before farther work", async () => {
    const jobs = Array.from({ length: 3 }, () =>
      deferred<DecodedAnimationAtlas>()
    );
    const load = vi.fn(
      (atlas: { url: string }) => jobs[Number(atlas.url.at(-1))]!.promise
    );
    const cache = new AnimationAtlasCache(load, 12, 32, 1);
    const active = cache.use(
      descriptor(0),
      new AbortController().signal,
      () => undefined
    );
    const farther = cache.prefetch(
      descriptor(1),
      new AbortController().signal,
      1
    );
    const nearer = cache.prefetch(
      descriptor(2),
      new AbortController().signal,
      0
    );
    jobs[0]!.resolve(decoded());
    await active;
    expect(load.mock.calls.map(([atlas]) => atlas.url)).toEqual([
      "atlas-0",
      "atlas-2"
    ]);
    jobs[2]!.resolve(decoded());
    await nearer;
    expect(load.mock.calls.map(([atlas]) => atlas.url)).toEqual([
      "atlas-0",
      "atlas-2",
      "atlas-1"
    ]);
    jobs[1]!.resolve(decoded());
    await farther;
    cache.clear();
  });

  it("refreshes a future window's priority without decoding the same atlas twice", async () => {
    const jobs = Array.from({ length: 3 }, () =>
      deferred<DecodedAnimationAtlas>()
    );
    const atlases = Array.from({ length: 3 }, () => decoded());
    const load = vi.fn(
      (atlas: { url: string }) => jobs[Number(atlas.url.at(-1))]!.promise
    );
    const cache = new AnimationAtlasCache(load, 8, 32, 1);
    const visible = cache.use(
      descriptor(0),
      new AbortController().signal,
      () => undefined
    );
    const futureWindow = new AbortController();
    const original = cache.prefetch(descriptor(1), futureWindow.signal, 2);
    const farther = cache.prefetch(
      descriptor(2),
      new AbortController().signal,
      1
    );
    const promoted = cache.prefetch(descriptor(1), futureWindow.signal, 0);
    jobs[0]!.resolve(atlases[0]!);
    await visible;
    expect(load.mock.calls.map(([atlas]) => atlas.url)).toEqual([
      "atlas-0",
      "atlas-1"
    ]);
    jobs[1]!.resolve(atlases[1]!);
    await Promise.all([original, promoted]);
    jobs[2]!.resolve(atlases[2]!);
    await farther;
    expect(load).toHaveBeenCalledTimes(3);
    expect(atlases[0]!.dispose).not.toHaveBeenCalled();
    expect(atlases[1]!.dispose).not.toHaveBeenCalled();
    expect(atlases[2]!.dispose).toHaveBeenCalledOnce();
    await cache.prefetch(descriptor(1), futureWindow.signal, 0);
    expect(load).toHaveBeenCalledTimes(3);
    cache.clear();
    for (const atlas of atlases) expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("clears retained encoded sources when private decoded media is cleared", async () => {
    const atlas = decoded();
    const load = Object.assign(
      vi.fn(async () => atlas),
      { clear: vi.fn() }
    );
    const cache = new AnimationAtlasCache(load);
    await cache.use(
      descriptor(0),
      new AbortController().signal,
      () => undefined
    );
    cache.clear();
    expect(load.clear).toHaveBeenCalledOnce();
    expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("shares concurrent work and keeps three full-size atlases within the decoded byte budget", async () => {
    const decodedAtlases = Array.from({ length: 4 }, () => decoded(2048));
    const load = vi.fn(
      async (atlas: { url: string }) =>
        decodedAtlases[Number(atlas.url.at(-1))]!
    );
    const cache = new AnimationAtlasCache(load);
    const signal = new AbortController().signal;
    const draw = vi.fn();
    await Promise.all([
      cache.use(descriptor(0, 2048), signal, draw),
      cache.use(descriptor(0, 2048), signal, draw)
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(2);
    await cache.use(descriptor(1, 2048), signal, draw);
    await cache.use(descriptor(2, 2048), signal, draw);
    await cache.use(descriptor(0, 2048), signal, draw);
    await cache.use(descriptor(3, 2048), signal, draw);
    expect(decodedAtlases[1]!.dispose).toHaveBeenCalledOnce();
    expect(decodedAtlases[0]!.dispose).not.toHaveBeenCalled();
    cache.clear();
    for (const atlas of decodedAtlases)
      expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it.each([4, 6])(
    "reuses %i independent small atlases across repeated animation frames",
    async (count) => {
      const atlases: DecodedAnimationAtlas[] = [];
      const load = vi.fn(async () => {
        const atlas = decoded(640);
        atlases.push(atlas);
        return atlas;
      });
      const cache = new AnimationAtlasCache(load);
      const signal = new AbortController().signal;
      const draw = vi.fn();
      for (let frame = 0; frame < 24; frame++) {
        for (let index = 0; index < count; index++)
          await cache.use(descriptor(index, 640), signal, draw);
      }
      expect(load).toHaveBeenCalledTimes(count);
      expect(draw).toHaveBeenCalledTimes(count * 24);
      cache.clear();
      for (const atlas of atlases) expect(atlas.dispose).toHaveBeenCalledOnce();
    }
  );

  it("bounds small entries independently of bytes and retains recent atlases", async () => {
    const atlases = new Map<string, DecodedAnimationAtlas>();
    const load = vi.fn(async (atlas: { url: string }) => {
      const value = decoded();
      atlases.set(atlas.url, value);
      return value;
    });
    const cache = new AnimationAtlasCache(load);
    const signal = new AbortController().signal;
    for (let index = 0; index < 32; index++)
      await cache.use(descriptor(index), signal, () => undefined);
    await cache.use(descriptor(0), signal, () => undefined);
    await cache.use(descriptor(32), signal, () => undefined);
    expect(load).toHaveBeenCalledTimes(33);
    expect(atlases.get("atlas-0")!.dispose).not.toHaveBeenCalled();
    expect(atlases.get("atlas-1")!.dispose).toHaveBeenCalledOnce();
    cache.clear();
    for (const atlas of atlases.values())
      expect(atlas.dispose).toHaveBeenCalledOnce();
  });

  it("resets decoded byte accounting when private media is cleared", async () => {
    const atlases: DecodedAnimationAtlas[] = [];
    const load = vi.fn(async () => {
      const atlas = decoded(2048);
      atlases.push(atlas);
      return atlas;
    });
    const cache = new AnimationAtlasCache(load);
    const signal = new AbortController().signal;
    for (let index = 0; index < 3; index++)
      await cache.use(descriptor(index, 2048), signal, () => undefined);
    cache.clear();
    for (let index = 3; index < 6; index++)
      await cache.use(descriptor(index, 2048), signal, () => undefined);
    for (const atlas of atlases.slice(3))
      expect(atlas.dispose).not.toHaveBeenCalled();
    cache.clear();
    for (const atlas of atlases) expect(atlas.dispose).toHaveBeenCalledOnce();
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
