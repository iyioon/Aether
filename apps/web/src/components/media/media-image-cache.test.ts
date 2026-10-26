import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMediaImageReady,
  clearMediaImageCache,
  markMediaImageReady,
  acquireMediaImagePreload
} from "./media-image-cache";

class MockImage {
  static instances: MockImage[] = [];

  complete = false;
  decoding = "auto";
  naturalWidth = 0;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  source = "";

  constructor() {
    MockImage.instances.push(this);
  }

  decode = vi.fn(() => Promise.resolve());

  set src(source: string) {
    this.source = source;
  }

  get src(): string {
    return this.source;
  }

  removeAttribute(name: string) {
    if (name === "src") {
      this.source = "";
    }
  }
}

function installImageWindow() {
  let nextTimerId = 1;
  const activeTimers = new Map<number, () => void>();

  vi.stubGlobal("window", {
    Image: MockImage,
    clearTimeout: (timerId: number) => activeTimers.delete(timerId),
    setTimeout: (callback: () => void) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      activeTimers.set(timerId, callback);
      return timerId;
    }
  });
  return activeTimers;
}

describe("media image cache", () => {
  afterEach(() => {
    clearMediaImageCache();
    MockImage.instances = [];
    vi.unstubAllGlobals();
  });

  it("records images that have already been decoded", () => {
    const source = "/decoded-poster.jpg";

    expect(isMediaImageReady(source)).toBe(false);
    markMediaImageReady(source);
    expect(isMediaImageReady(source)).toBe(true);
  });

  it("clears private readiness and cancels pending decodes without reviving stale loads", async () => {
    const timers = installImageWindow();
    const source = "/api/assets/private/thumbnail";
    markMediaImageReady("/api/assets/previous/thumbnail");
    const pending = acquireMediaImagePreload(source);
    const image = MockImage.instances[0]!;
    let resolveDecode!: () => void;
    image.decode.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDecode = resolve;
        })
    );
    const staleLoad = image.onload!;
    staleLoad();
    clearMediaImageCache();
    await expect(pending.promise).resolves.toBe(false);
    expect(image.src).toBe("");
    expect(timers.size).toBe(0);
    expect(isMediaImageReady("/api/assets/previous/thumbnail")).toBe(false);
    staleLoad();
    resolveDecode();
    await Promise.resolve();
    expect(isMediaImageReady(source)).toBe(false);
    const current = acquireMediaImagePreload(source);
    pending.release();
    expect(MockImage.instances[1]!.src).toBe(source);
    MockImage.instances[1]!.onload!();
    await expect(current.promise).resolves.toBe(true);
    clearMediaImageCache();
    expect(MockImage.instances[1]!.src).toBe("");
    expect(isMediaImageReady(source)).toBe(false);
    current.release();
  });

  it("deduplicates preloads and resolves after the image is decoded", async () => {
    installImageWindow();
    const source = "/next-comparison-poster.jpg";
    const firstPreload = acquireMediaImagePreload(source);
    const secondPreload = acquireMediaImagePreload(source);

    expect(MockImage.instances).toHaveLength(1);

    MockImage.instances[0]?.onload?.();
    MockImage.instances[0]?.onload?.();
    await expect(firstPreload.promise).resolves.toBe(true);
    await expect(secondPreload.promise).resolves.toBe(true);

    expect(MockImage.instances[0]?.decode).toHaveBeenCalledOnce();
    expect(isMediaImageReady(source)).toBe(true);
    firstPreload.release();
    secondPreload.release();
  });

  it("does not mark an image ready when decoding fails", async () => {
    installImageWindow();
    const source = "/invalid-poster.jpg";
    const preload = acquireMediaImagePreload(source);
    const image = MockImage.instances[0];

    image?.decode.mockRejectedValueOnce(new Error("decode failed"));
    image?.onload?.();
    await expect(preload.promise).resolves.toBe(false);

    expect(isMediaImageReady(source)).toBe(false);
    preload.release();
  });

  it("releases one consumer without cancelling a shared image", async () => {
    installImageWindow();
    const source = "/shared-comparison-image.jpg";
    const first = acquireMediaImagePreload(source);
    const second = acquireMediaImagePreload(source);
    first.release();

    await expect(first.promise).resolves.toBe(false);
    expect(MockImage.instances[0]?.src).toBe(source);
    MockImage.instances[0]?.onload?.();
    await expect(second.promise).resolves.toBe(true);
    second.release();
    expect(MockImage.instances[0]?.src).toBe("");
  });

  it("aborts the last consumer and retries with a new image", async () => {
    installImageWindow();
    const source = "/cancelled-comparison-image.jpg";
    const controller = new AbortController();
    const first = acquireMediaImagePreload(source, {
      signal: controller.signal
    });
    const staleLoad = MockImage.instances[0]?.onload;
    controller.abort();
    staleLoad?.();
    await expect(first.promise).resolves.toBe(false);
    expect(isMediaImageReady(source)).toBe(false);
    expect(MockImage.instances[0]?.src).toBe("");

    const second = acquireMediaImagePreload(source);
    expect(MockImage.instances).toHaveLength(2);
    MockImage.instances[1]?.onload?.();
    await expect(second.promise).resolves.toBe(true);
    second.release();
  });

  it("times out stalled image and decode operations", async () => {
    const timers = installImageWindow();
    const first = acquireMediaImagePreload("/timed-out-comparison-image.jpg");
    const second = acquireMediaImagePreload("/timed-out-comparison-decode.jpg");
    MockImage.instances[1]?.decode.mockReturnValueOnce(
      new Promise(() => undefined)
    );
    MockImage.instances[1]?.onload?.();
    for (const timeout of [...timers.values()]) {
      timeout();
    }

    await expect(first.promise).resolves.toBe(false);
    await expect(second.promise).resolves.toBe(false);
    expect(MockImage.instances.every((image) => image.src === "")).toBe(true);
    first.release();
    second.release();
  });

  it("ignores an already aborted consumer", async () => {
    installImageWindow();
    const controller = new AbortController();
    controller.abort();
    const handle = acquireMediaImagePreload("/never-requested.jpg", {
      signal: controller.signal
    });

    await expect(handle.promise).resolves.toBe(false);
    expect(MockImage.instances).toHaveLength(0);
    handle.release();
  });

  it("rechecks an old readiness hint instead of assuming the browser retained the image", async () => {
    installImageWindow();
    const source = "/previously-decoded-comparison-image.jpg";
    markMediaImageReady(source);
    const handle = acquireMediaImagePreload(source);

    expect(MockImage.instances).toHaveLength(1);
    expect(isMediaImageReady(source)).toBe(false);
    MockImage.instances[0]?.onload?.();
    await expect(handle.promise).resolves.toBe(true);
    expect(isMediaImageReady(source)).toBe(true);
    handle.release();

    const next = acquireMediaImagePreload(source);
    expect(MockImage.instances).toHaveLength(2);
    next.release();
    await expect(next.promise).resolves.toBe(false);
  });

  it("shares a decoded image while at least one consumer retains it", async () => {
    installImageWindow();
    const source = "/retained-decoded-comparison-image.jpg";
    const first = acquireMediaImagePreload(source);
    MockImage.instances[0]?.onload?.();
    await expect(first.promise).resolves.toBe(true);
    const second = acquireMediaImagePreload(source);
    await expect(second.promise).resolves.toBe(true);

    expect(MockImage.instances).toHaveLength(1);
    first.release();
    expect(MockImage.instances[0]?.src).toBe(source);
    second.release();
    expect(MockImage.instances[0]?.src).toBe("");
  });

  it("bounds readiness hints and refreshes recently used sources", () => {
    const oldest = "/oldest-readiness-hint.jpg";
    const reused = "/reused-readiness-hint.jpg";
    markMediaImageReady(oldest);
    markMediaImageReady(reused);
    for (let index = 0; index < 767; index += 1) {
      markMediaImageReady(`/bounded-readiness-hint-${index}.jpg`);
    }
    expect(isMediaImageReady(oldest)).toBe(false);
    expect(isMediaImageReady(reused)).toBe(true);
    markMediaImageReady(reused);
    markMediaImageReady("/last-readiness-hint.jpg");
    expect(isMediaImageReady(reused)).toBe(true);
  });
});
