import { describe, expect, it, vi } from "vitest";
import { observeVideoSection, videoSectionTime } from "./video-section";

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
    cancelAnimationFrame: (id: number) => this.frames.delete(id)
  };
  advance() {
    const frames = [...this.frames.values()];
    this.frames.clear();
    for (const callback of frames) callback(0);
  }
  visible(value: boolean) {
    this.visibilityState = value ? "visible" : "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
class FakeVideo extends EventTarget {
  ownerDocument = new FakeDocument();
  source = "/video";
  currentSrc = "https://aether.test/video";
  duration = 120;
  readyState = 2;
  paused = true;
  ended = false;
  seeking = false;
  loop = true;
  isConnected = true;
  time = 0;
  seeks: number[] = [];
  frames = new Map<number, VideoFrameRequestCallback>();
  nextFrame = 1;
  getAttribute() {
    return this.source;
  }
  get currentTime() {
    return this.time;
  }
  set currentTime(time: number) {
    this.seeks.push(time);
    this.time = time;
    this.seeking = true;
    this.ended = false;
    this.dispatchEvent(new Event("seeking"));
  }
  play = vi.fn(() => {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  requestVideoFrameCallback = (callback: VideoFrameRequestCallback) => {
    const id = this.nextFrame++;
    this.frames.set(id, callback);
    return id;
  };
  cancelVideoFrameCallback = (id: number) => this.frames.delete(id);
  completeSeek() {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
  present(time = this.time) {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks)
      callback(0, { mediaTime: time } as VideoFrameCallbackMetadata);
    this.ownerDocument.advance();
  }
  tick(time: number, event = "timeupdate") {
    this.time = time;
    this.dispatchEvent(new Event(event));
  }
  get element() {
    return this as unknown as HTMLVideoElement;
  }
}

describe("native source video sections", () => {
  it("holds readiness until metadata, the start seek, and its presented frame", () => {
    const video = new FakeVideo();
    video.readyState = 0;
    const ready = vi.fn();
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      ready
    );
    expect(video.seeks).toEqual([]);
    expect(video.frames.size).toBe(0);
    video.readyState = 2;
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.seeks).toEqual([10]);
    expect(video.loop).toBe(false);
    video.present(0);
    expect(ready.mock.calls).toEqual([[false]]);
    video.completeSeek();
    video.present(0);
    expect(ready.mock.calls).toEqual([[false]]);
    video.present(10);
    expect(ready.mock.calls).toEqual([[false], [true]]);
    expect(video.frames.size).toBe(0);
    dispose();
  });
  it("wraps while playing with one seek and keeps the decoded poster state ready", () => {
    const video = new FakeVideo();
    video.paused = false;
    const ready = vi.fn();
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      ready
    );
    video.completeSeek();
    video.present(10);
    video.tick(20);
    video.dispatchEvent(new Event("timeupdate"));
    expect(video.seeks).toEqual([10, 10]);
    video.completeSeek();
    video.present(10);
    expect(ready.mock.calls).toEqual([[false], [true]]);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.frames.size).toBe(1);
    dispose();
  });
  it("clamps manual seeks while paused without restarting playback", () => {
    const video = new FakeVideo();
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      vi.fn()
    );
    video.completeSeek();
    video.present(10);
    video.tick(2, "seeking");
    expect(video.seeks.at(-1)).toBe(10);
    video.completeSeek();
    video.tick(50, "seeked");
    expect(video.seeks.at(-1)).toBeCloseTo(19.999);
    video.completeSeek();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
    dispose();
  });
  it("recovers an actual resource end only when it was playing", () => {
    const video = new FakeVideo();
    video.duration = 20;
    video.paused = false;
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      vi.fn()
    );
    video.completeSeek();
    video.present();
    video.paused = true;
    video.ended = true;
    video.time = 20;
    video.dispatchEvent(new Event("pause"));
    video.dispatchEvent(new Event("ended"));
    expect(video.seeks.at(-1)).toBe(10);
    video.completeSeek();
    expect(video.play).toHaveBeenCalledOnce();
    video.pause();
    video.tick(20, "ended");
    video.completeSeek();
    expect(video.play).toHaveBeenCalledOnce();
    dispose();
  });
  it("uses frame callbacks to catch a boundary between coarse time updates", () => {
    const video = new FakeVideo();
    video.paused = false;
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      vi.fn()
    );
    video.completeSeek();
    video.present(10);
    video.time = 19.99;
    video.present(20.01);
    expect(video.seeks).toEqual([10, 10]);
    dispose();
  });
  it("cancels callbacks while hidden and ignores stale source events and late callbacks", () => {
    const video = new FakeVideo();
    video.paused = false;
    const ready = vi.fn();
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      ready
    );
    video.completeSeek();
    const late = [...video.frames.values()][0]!;
    video.ownerDocument.visible(false);
    expect(video.frames.size).toBe(0);
    video.tick(21);
    expect(video.seeks).toEqual([10]);
    video.ownerDocument.visible(true);
    expect(video.seeks).toEqual([10, 10]);
    video.source = "/other";
    video.tick(30);
    expect(video.seeks).toEqual([10, 10]);
    dispose();
    late(0, { mediaTime: 10 } as VideoFrameCallbackMetadata);
    expect(ready.mock.calls).toEqual([[false]]);
    expect(video.frames.size).toBe(0);
  });
  it("waits for the current source and clips the section to a changed duration", () => {
    const video = new FakeVideo();
    video.currentSrc = "https://aether.test/old";
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      vi.fn()
    );
    expect(video.seeks).toEqual([]);
    video.currentSrc = "https://aether.test/video";
    video.duration = 15;
    video.dispatchEvent(new Event("durationchange"));
    video.completeSeek();
    video.tick(16, "seeked");
    expect(video.seeks.at(-1)).toBeCloseTo(14.999);
    dispose();
  });
  it("falls back to two animation frames while paused and does not schedule invalid bounds", () => {
    const video = new FakeVideo();
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: undefined
    });
    const ready = vi.fn();
    const dispose = observeVideoSection(
      video.element,
      { start: 10, end: 20 },
      ready
    );
    video.completeSeek();
    expect(video.ownerDocument.frames.size).toBe(1);
    video.ownerDocument.advance();
    expect(ready).toHaveBeenLastCalledWith(false);
    video.ownerDocument.advance();
    expect(ready).toHaveBeenLastCalledWith(true);
    dispose();
    expect(video.ownerDocument.frames.size).toBe(0);
    const invalid = observeVideoSection(
      video.element,
      { start: NaN, end: Infinity },
      vi.fn()
    );
    expect(video.seeks).toEqual([10]);
    invalid();
  });
  it("restores section readiness after a paused toggle without another video frame", () => {
    const video = new FakeVideo();
    for (let toggle = 0; toggle < 2; toggle++) {
      const ready = vi.fn();
      const dispose = observeVideoSection(
        video.element,
        { start: 10, end: 20 },
        ready
      );
      expect(video.frames.size).toBe(0);
      video.completeSeek();
      expect(video.frames.size).toBe(1);
      video.ownerDocument.advance();
      expect(ready.mock.calls).toEqual([[false]]);
      video.ownerDocument.advance();
      expect(ready.mock.calls).toEqual([[false], [true]]);
      expect(video.frames.size).toBe(0);
      expect(video.ownerDocument.frames.size).toBe(0);
      expect(video.paused).toBe(true);
      expect(video.play).not.toHaveBeenCalled();
      dispose();
    }
  });
  it.each(["hidden", "disposed", "source", "controller"] as const)(
    "cancels both paused readiness paths when obsolete: %s",
    (reason) => {
      const video = new FakeVideo();
      const ready = vi.fn();
      const dispose = observeVideoSection(
        video.element,
        { start: 10, end: 20 },
        ready
      );
      video.completeSeek();
      video.ownerDocument.advance();
      const late = [...video.ownerDocument.frames.values()][0]!;
      const lateVideoFrame = [...video.frames.values()][0]!;
      if (reason === "hidden") video.ownerDocument.visible(false);
      if (reason === "disposed" || reason === "controller") dispose();
      if (reason === "source") {
        video.source = "/other";
        video.currentSrc = "https://aether.test/other";
        video.dispatchEvent(new Event("loadedmetadata"));
      }
      const disposeReplacement =
        reason === "controller"
          ? observeVideoSection(video.element, { start: 11, end: 20 }, vi.fn())
          : null;
      late(0);
      lateVideoFrame(0, { mediaTime: 10 } as VideoFrameCallbackMetadata);
      expect(ready.mock.calls).toEqual([[false]]);
      expect(video.ownerDocument.frames.size).toBe(0);
      expect(video.frames.size).toBe(0);
      disposeReplacement?.();
      dispose();
    }
  );
  it("keeps an end scrub inside the final frame of short and normal sections", () => {
    expect(videoSectionTime(20, { start: 10, end: 20 })).toBeCloseTo(19.999);
    expect(videoSectionTime(-1, { start: 10, end: 20 })).toBe(10);
    expect(videoSectionTime(0.0001, { start: 0, end: 0.0001 })).toBe(0.00005);
  });

  it.each(["detached", "connected", "new-source", "new-controller"] as const)(
    "contains a deferred end-wrap play after disposal: %s",
    async (replacement) => {
      const video = new FakeVideo();
      video.duration = 20;
      video.paused = false;
      let completePlay!: () => void;
      video.play.mockImplementation(() => {
        video.paused = false;
        video.dispatchEvent(new Event("play"));
        return new Promise<void>((resolve) => {
          completePlay = resolve;
        });
      });
      const dispose = observeVideoSection(
        video.element,
        { start: 10, end: 20 },
        vi.fn()
      );
      video.completeSeek();
      video.present();
      video.paused = true;
      video.ended = true;
      video.time = 20;
      video.dispatchEvent(new Event("pause"));
      video.dispatchEvent(new Event("ended"));
      video.completeSeek();
      expect(video.play).toHaveBeenCalledOnce();
      dispose();
      video.isConnected = replacement === "connected";
      if (replacement === "new-source") {
        video.source = "/replacement";
        video.currentSrc = "https://aether.test/replacement";
      }
      const disposeReplacement =
        replacement === "new-controller"
          ? observeVideoSection(video.element, { start: 10, end: 20 }, vi.fn())
          : null;
      completePlay();
      await Promise.resolve();
      expect(video.pause).toHaveBeenCalledTimes(
        replacement === "detached" ? 1 : 0
      );
      expect(video.paused).toBe(replacement === "detached");
      disposeReplacement?.();
    }
  );
});
