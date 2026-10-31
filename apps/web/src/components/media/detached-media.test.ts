import { describe, expect, it, vi } from "vitest";
import { releaseDetachedMedia } from "./detached-media";

describe("detached native media", () => {
  it("releases a removed image after the DOM commit without requesting an empty URL", async () => {
    const image = { isConnected: true, removeAttribute: vi.fn() };
    releaseDetachedMedia(image as unknown as HTMLImageElement);
    expect(image.removeAttribute).not.toHaveBeenCalled();
    image.isConnected = false;
    await Promise.resolve();
    expect(image.removeAttribute).toHaveBeenCalledExactlyOnceWith("src");
  });

  it("pauses and unloads a removed video to abort native buffering", async () => {
    const video = {
      isConnected: false,
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn()
    };
    releaseDetachedMedia(video as unknown as HTMLVideoElement);
    await Promise.resolve();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.removeAttribute).toHaveBeenCalledExactlyOnceWith("src");
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.pause.mock.invocationCallOrder[0]).toBeLessThan(
      video.removeAttribute.mock.invocationCallOrder[0]!
    );
    expect(video.removeAttribute.mock.invocationCallOrder[0]).toBeLessThan(
      video.load.mock.invocationCallOrder[0]!
    );
  });

  it("preserves an active or reattached video through ref and source updates", async () => {
    const video = {
      isConnected: false,
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn()
    };
    releaseDetachedMedia(video as unknown as HTMLVideoElement);
    video.isConnected = true;
    await Promise.resolve();
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.removeAttribute).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
  });
});
