import { describe, expect, it } from "vitest";
import { observePresentationVideoSeeking } from "./presentation-preview-video";

class FakeDocument extends EventTarget {
  visibilityState = "visible";
  baseURI = "https://aether.test/";
}

class FakeVideo extends EventTarget {
  ownerDocument = new FakeDocument();
  source = "/video";
  currentSrc = "https://aether.test/video";
  duration = 10;
  readyState = 2;
  seeking = false;
  error = null;
  time = 0;
  seeks: number[] = [];
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
    this.dispatchEvent(new Event("seeking"));
  }
  completeSeek() {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
  get element() {
    return this as unknown as HTMLVideoElement;
  }
}

describe("editor video seeking", () => {
  it("retains the latest paused seek before metadata is available", () => {
    const video = new FakeVideo();
    video.readyState = 0;
    const controller = observePresentationVideoSeeking(video.element);
    controller.seek(1200);
    controller.seek(3400);
    expect(video.seeks).toEqual([]);
    expect(controller.readTime()).toBeNull();
    video.readyState = 2;
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.seeks).toEqual([3.4]);
    expect(controller.readTime()).toBeNull();
    video.completeSeek();
    expect(controller.readTime()).toBe(3400);
    controller.dispose();
  });

  it("coalesces rapid reverse seeks and excludes intermediate positions", () => {
    const video = new FakeVideo();
    video.time = 8;
    const controller = observePresentationVideoSeeking(video.element);
    controller.seek(7900);
    for (let time = 7800; time >= 6000; time -= 100) controller.seek(time);
    expect(video.seeks).toEqual([7.9]);
    expect(controller.readTime()).toBeNull();
    video.completeSeek();
    expect(video.seeks).toEqual([7.9, 6]);
    expect(controller.readTime()).toBeNull();
    video.completeSeek();
    expect(controller.readTime()).toBe(6000);
    controller.dispose();
  });

  it("seeks exactly to a repeated UI checkpoint after playback advanced", () => {
    const video = new FakeVideo();
    const controller = observePresentationVideoSeeking(video.element);
    controller.seek(1000);
    video.completeSeek();
    expect(controller.readTime()).toBe(1000);
    video.time = 1.124;
    controller.seek(1000);
    expect(video.seeks).toEqual([1, 1]);
    expect(controller.readTime()).toBeNull();
    video.completeSeek();
    expect(controller.readTime()).toBe(1000);
    controller.dispose();
  });

  it("avoids redundant seeks and clips End to the last source frame", () => {
    const video = new FakeVideo();
    const controller = observePresentationVideoSeeking(video.element);
    controller.seek(0);
    expect(video.seeks).toEqual([]);
    expect(controller.readTime()).toBe(0);
    controller.seek(10000);
    expect(video.seeks).toEqual([9.999]);
    video.completeSeek();
    controller.seek(10000);
    expect(video.seeks).toEqual([9.999]);
    expect(controller.readTime()).toBe(9999);
    controller.seek(-50);
    expect(video.seeks).toEqual([9.999, 0]);
    controller.dispose();
  });

  it("does not admit non-finite targets or readbacks", () => {
    const video = new FakeVideo();
    const controller = observePresentationVideoSeeking(video.element);
    for (const time of [NaN, Infinity, -Infinity]) controller.seek(time);
    expect(video.seeks).toEqual([]);
    video.time = NaN;
    expect(controller.readTime()).toBeNull();
    controller.dispose();
  });

  it("retains a blocked seek for the next metadata or readiness event", () => {
    const video = new FakeVideo();
    const controller = observePresentationVideoSeeking(video.element);
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => video.time,
      set: () => {
        throw new Error("Seek unavailable");
      }
    });
    controller.seek(4000);
    expect(controller.readTime()).toBeNull();
    Reflect.deleteProperty(video, "currentTime");
    video.dispatchEvent(new Event("canplay"));
    expect(video.seeks).toEqual([4]);
    video.completeSeek();
    expect(controller.readTime()).toBe(4000);
    controller.dispose();
  });

  it("defers decoding while hidden and resumes the newest request", () => {
    const video = new FakeVideo();
    const controller = observePresentationVideoSeeking(video.element);
    video.ownerDocument.visibilityState = "hidden";
    controller.seek(2000);
    controller.seek(3000);
    expect(video.seeks).toEqual([]);
    video.ownerDocument.visibilityState = "visible";
    video.ownerDocument.dispatchEvent(new Event("visibilitychange"));
    expect(video.seeks).toEqual([3]);
    video.completeSeek();
    expect(controller.readTime()).toBe(3000);
    controller.dispose();
  });

  it.each(["disposed", "source", "error"] as const)(
    "ignores late seeks and events after %s",
    (reason) => {
      const video = new FakeVideo();
      const controller = observePresentationVideoSeeking(video.element);
      controller.seek(8000);
      controller.seek(4000);
      if (reason === "disposed") controller.dispose();
      if (reason === "source") {
        video.source = "/replacement";
        video.currentSrc = "https://aether.test/replacement";
      }
      if (reason === "error") Object.assign(video, { error: { code: 3 } });
      video.completeSeek();
      video.dispatchEvent(new Event("canplay"));
      controller.seek(2000);
      expect(video.seeks).toEqual([8]);
      expect(controller.readTime()).toBeNull();
      controller.dispose();
    }
  );
});
