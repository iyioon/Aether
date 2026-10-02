import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMediaImageReady,
  markMediaImageReady,
  preloadMediaImage
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
}

describe("media image cache", () => {
  afterEach(() => {
    MockImage.instances = [];
    vi.unstubAllGlobals();
  });

  it("records images that have already been decoded", () => {
    const source = "/decoded-poster.jpg";

    expect(isMediaImageReady(source)).toBe(false);
    markMediaImageReady(source);
    expect(isMediaImageReady(source)).toBe(true);
  });

  it("deduplicates preloads and resolves after the image is decoded", async () => {
    installImageWindow();
    const source = "/next-comparison-poster.jpg";
    const firstPreload = preloadMediaImage(source);
    const secondPreload = preloadMediaImage(source);

    expect(secondPreload).toBe(firstPreload);
    expect(MockImage.instances).toHaveLength(1);

    MockImage.instances[0]?.onload?.();
    MockImage.instances[0]?.onload?.();
    await firstPreload;

    expect(MockImage.instances[0]?.decode).toHaveBeenCalledOnce();
    expect(isMediaImageReady(source)).toBe(true);
  });

  it("does not mark an image ready when decoding fails", async () => {
    installImageWindow();
    const source = "/invalid-poster.jpg";
    const preload = preloadMediaImage(source);
    const image = MockImage.instances[0];

    image?.decode.mockRejectedValueOnce(new Error("decode failed"));
    image?.onload?.();
    await preload;

    expect(isMediaImageReady(source)).toBe(false);
  });
});
