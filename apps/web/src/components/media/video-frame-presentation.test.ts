import { describe, expect, it, vi } from "vitest";
import { requestPresentedVideoFrame } from "./video-frame-presentation";

class FakeDocument extends EventTarget {
  visibilityState = "visible";
  baseURI = "https://aether.test/";
  frames = new Map<number, FrameRequestCallback>();
  nextFrame = 1;
  defaultView = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = this.nextFrame++;
      this.frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: vi.fn((id: number) => this.frames.delete(id))
  };
  advance() {
    const frames = [...this.frames.values()];
    this.frames.clear();
    for (const callback of frames) callback(0);
  }
}
class FakeVideo extends EventTarget {
  ownerDocument = new FakeDocument();
  source = "/video";
  currentSrc = "https://aether.test/video";
  readyState = 2;
  paused = false;
  seeking = false;
  error = null;
  currentTime = 2;
  frames = new Map<number, VideoFrameRequestCallback>();
  nextFrame = 1;
  getAttribute() {
    return this.source;
  }
  requestVideoFrameCallback = (callback: VideoFrameRequestCallback) => {
    const id = this.nextFrame++;
    this.frames.set(id, callback);
    return id;
  };
  cancelVideoFrameCallback = vi.fn((id: number) => this.frames.delete(id));
  present(time = this.currentTime) {
    const frames = [...this.frames.values()];
    this.frames.clear();
    for (const callback of frames)
      callback(0, { mediaTime: time } as VideoFrameCallbackMetadata);
  }
  get element() {
    return this as unknown as HTMLVideoElement;
  }
}

describe("requestPresentedVideoFrame", () => {
  it("waits for an actual video frame while playing", () => {
    const video = new FakeVideo();
    const onPresented = vi.fn();
    requestPresentedVideoFrame(video.element, onPresented);
    expect(video.ownerDocument.frames.size).toBe(0);
    expect(onPresented).not.toHaveBeenCalled();
    video.present();
    expect(onPresented).toHaveBeenCalledExactlyOnceWith(2);
    expect(video.cancelVideoFrameCallback).not.toHaveBeenCalled();
  });

  it("uses two animation frames when the video callback is unavailable", () => {
    const video = new FakeVideo();
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: undefined
    });
    const onPresented = vi.fn();
    requestPresentedVideoFrame(video.element, onPresented);
    video.ownerDocument.advance();
    expect(onPresented).not.toHaveBeenCalled();
    video.ownerDocument.advance();
    expect(onPresented).toHaveBeenCalledExactlyOnceWith(2);
    expect(video.ownerDocument.frames.size).toBe(0);
  });

  it("reveals a paused decoded frame without waiting for another video frame", () => {
    const video = new FakeVideo();
    video.paused = true;
    const onPresented = vi.fn();
    requestPresentedVideoFrame(video.element, onPresented);
    expect(video.frames.size).toBe(1);
    video.ownerDocument.advance();
    expect(onPresented).not.toHaveBeenCalled();
    video.ownerDocument.advance();
    expect(onPresented).toHaveBeenCalledExactlyOnceWith(2);
    expect(video.frames.size).toBe(0);
    expect(video.ownerDocument.frames.size).toBe(0);
  });

  it("cancels the paused fallback when a video frame wins the race", () => {
    const video = new FakeVideo();
    video.paused = true;
    const onPresented = vi.fn();
    requestPresentedVideoFrame(video.element, onPresented);
    video.present(1.99);
    video.ownerDocument.advance();
    expect(onPresented).toHaveBeenCalledExactlyOnceWith(1.99);
    expect(video.ownerDocument.frames.size).toBe(0);
  });

  it("waits for a paused seek to finish and a decoded frame to be available", () => {
    const video = new FakeVideo();
    video.paused = true;
    video.seeking = true;
    video.readyState = 1;
    const onPresented = vi.fn();
    const cancel = requestPresentedVideoFrame(video.element, onPresented);
    expect(video.ownerDocument.frames.size).toBe(0);
    video.seeking = false;
    video.dispatchEvent(new Event("seeked"));
    expect(video.ownerDocument.frames.size).toBe(0);
    video.readyState = 2;
    video.dispatchEvent(new Event("canplay"));
    video.ownerDocument.advance();
    video.ownerDocument.advance();
    expect(onPresented).toHaveBeenCalledExactlyOnceWith(2);
    cancel();
  });

  it.each([
    "dispose",
    "hidden",
    "source",
    "seeking",
    "error",
    "loadstart"
  ] as const)("cancels both paused paths when obsolete: %s", (reason) => {
    const video = new FakeVideo();
    video.paused = true;
    const onPresented = vi.fn();
    const cancel = requestPresentedVideoFrame(video.element, onPresented);
    const lateVideoFrame = [...video.frames.values()][0]!;
    const lateAnimationFrame = [...video.ownerDocument.frames.values()][0]!;
    if (reason === "dispose") cancel();
    if (reason === "hidden") {
      video.ownerDocument.visibilityState = "hidden";
      video.ownerDocument.dispatchEvent(new Event("visibilitychange"));
    }
    if (reason === "source") {
      video.source = "/replacement";
      video.currentSrc = "https://aether.test/replacement";
      video.ownerDocument.advance();
    }
    if (reason === "seeking") {
      video.seeking = true;
      video.dispatchEvent(new Event("seeking"));
    }
    if (reason === "error" || reason === "loadstart")
      video.dispatchEvent(new Event(reason));
    lateVideoFrame(0, { mediaTime: 2 } as VideoFrameCallbackMetadata);
    lateAnimationFrame(0);
    expect(onPresented).not.toHaveBeenCalled();
    expect(video.frames.size).toBe(0);
    expect(video.ownerDocument.frames.size).toBe(0);
  });

  it("does not use a paused snapshot after playback resumes or time changes", () => {
    const video = new FakeVideo();
    video.paused = true;
    const onPresented = vi.fn();
    const cancel = requestPresentedVideoFrame(video.element, onPresented);
    video.ownerDocument.advance();
    video.currentTime = 3;
    video.ownerDocument.advance();
    expect(onPresented).not.toHaveBeenCalled();
    video.dispatchEvent(new Event("pause"));
    video.ownerDocument.advance();
    video.paused = false;
    video.dispatchEvent(new Event("play"));
    video.ownerDocument.advance();
    expect(onPresented).not.toHaveBeenCalled();
    video.present(3.1);
    expect(onPresented).toHaveBeenCalledExactlyOnceWith(3.1);
    cancel();
  });

  it("cancels the second animation frame without a late notification", () => {
    const video = new FakeVideo();
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: undefined
    });
    const onPresented = vi.fn();
    const cancel = requestPresentedVideoFrame(video.element, onPresented);
    video.ownerDocument.advance();
    const late = [...video.ownerDocument.frames.values()][0]!;
    cancel();
    late(0);
    expect(onPresented).not.toHaveBeenCalled();
    expect(video.ownerDocument.frames.size).toBe(0);
  });
});
