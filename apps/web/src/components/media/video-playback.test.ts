import { describe, expect, it, vi } from "vitest";
import {
  formatVideoTime,
  observeVideoPlayback,
  readVideoPlayback,
  videoSeekTarget,
  type VideoPlaybackState
} from "./video-playback";

function timeRanges(ranges: [number, number][]): TimeRanges {
  return {
    length: ranges.length,
    start: (index) => ranges[index]![0],
    end: (index) => ranges[index]![1]
  };
}

class FakeVideo extends EventTarget {
  duration = 120;
  currentTime = 5;
  paused = true;
  ended = false;
  loop = false;
  muted = true;
  volume = 1;
  error: MediaError | null = null;
  seekable = timeRanges([[0, 120]]);
  buffered = timeRanges([[0, 20]]);
  play = vi.fn((): Promise<void> => {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });

  get element(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

function pendingPlay() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("video playback state", () => {
  it("reads actual playback, sound, duration and buffered state", () => {
    const video = new FakeVideo();
    expect(readVideoPlayback(video.element)).toEqual({
      available: true,
      paused: true,
      muted: true,
      currentTime: 5,
      duration: 120,
      bufferedEnd: 20,
      seekable: true,
      error: false
    });

    video.paused = false;
    video.muted = false;
    video.volume = 0;
    expect(readVideoPlayback(video.element)).toMatchObject({
      paused: false,
      muted: true
    });
    video.ended = true;
    expect(readVideoPlayback(video.element).paused).toBe(true);
  });

  it("does not present invalid or unbounded durations as a seekable timeline", () => {
    const video = new FakeVideo();
    for (const duration of [NaN, Infinity, -1, 0]) {
      video.duration = duration;
      video.currentTime = Infinity;
      expect(readVideoPlayback(video.element)).toMatchObject({
        currentTime: 0,
        duration: 0,
        bufferedEnd: 0,
        seekable: false
      });
    }
  });

  it("shows buffering only through the range containing the current time", () => {
    const video = new FakeVideo();
    video.buffered = timeRanges([
      [0, 10],
      [30, 90]
    ]);
    expect(readVideoPlayback(video.element).bufferedEnd).toBe(10);
    video.currentTime = 20;
    expect(readVideoPlayback(video.element).bufferedEnd).toBe(0);
    video.currentTime = 40;
    expect(readVideoPlayback(video.element).bufferedEnd).toBe(90);
  });

  it("clamps seeks to the duration and nearest available interval", () => {
    const video = new FakeVideo();
    expect(videoSeekTarget(video.element, -10)).toBe(0);
    expect(videoSeekTarget(video.element, 500)).toBe(120);
    video.seekable = timeRanges([
      [10, 30],
      [50, 100]
    ]);
    expect(videoSeekTarget(video.element, 2)).toBe(10);
    expect(videoSeekTarget(video.element, 34)).toBe(30);
    expect(videoSeekTarget(video.element, 45)).toBe(50);
    expect(videoSeekTarget(video.element, 80)).toBe(80);
  });

  it("rejects nonfinite requests, empty ranges and invalid range boundaries", () => {
    const video = new FakeVideo();
    expect(videoSeekTarget(video.element, NaN)).toBeNull();
    expect(videoSeekTarget(video.element, Infinity)).toBeNull();
    video.seekable = timeRanges([]);
    expect(videoSeekTarget(video.element, 10)).toBeNull();
    video.seekable = timeRanges([
      [NaN, 30],
      [50, Infinity],
      [80, 60]
    ]);
    expect(videoSeekTarget(video.element, 10)).toBe(50);
    video.duration = Infinity;
    expect(videoSeekTarget(video.element, 10)).toBeNull();
  });

  it("keeps end seeks inside looping media and within available ranges", () => {
    const video = new FakeVideo();
    video.loop = true;
    expect(videoSeekTarget(video.element, 120)).toBeCloseTo(119.99);
    expect(videoSeekTarget(video.element, 500)).toBeCloseTo(119.99);
    video.seekable = timeRanges([[10, 100]]);
    expect(videoSeekTarget(video.element, 120)).toBe(100);
    video.duration = 0.005;
    video.seekable = timeRanges([[0, 0.005]]);
    expect(videoSeekTarget(video.element, 0.005)).toBeCloseTo(0.0025, 6);
  });

  it("formats short and hour-long times without rounding past the playhead", () => {
    expect(formatVideoTime(0)).toBe("0:00");
    expect(formatVideoTime(65.9)).toBe("1:05");
    expect(formatVideoTime(3_661.9)).toBe("1:01:01");
    expect(formatVideoTime(NaN)).toBe("0:00");
    expect(formatVideoTime(Infinity)).toBe("0:00");
    expect(formatVideoTime(-1)).toBe("0:00");
  });
});

describe("video playback commands", () => {
  it("calls play synchronously and follows real play, pause and volume events", async () => {
    const video = new FakeVideo();
    const updates = vi.fn<(state: VideoPlaybackState) => void>();
    const controls = observeVideoPlayback(video.element, updates);
    expect(controls.togglePlayback()).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: false })
    );
    await Promise.resolve();
    expect(controls.togglePlayback()).toBe(true);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: true })
    );
    video.muted = false;
    video.dispatchEvent(new Event("volumechange"));
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ muted: false })
    );
    controls.dispose();
  });

  it("keeps a rejected play request paused and permits a subsequent gesture", async () => {
    const video = new FakeVideo();
    const pending = pendingPlay();
    video.play.mockImplementationOnce(() => pending.promise);
    const updates = vi.fn<(state: VideoPlaybackState) => void>();
    const controls = observeVideoPlayback(video.element, updates);
    controls.togglePlayback();
    pending.reject(new Error("Autoplay blocked"));
    await Promise.resolve();
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: true })
    );
    controls.togglePlayback();
    expect(video.play).toHaveBeenCalledTimes(2);
    controls.dispose();
  });

  it("keeps the real paused state when the browser throws from play", () => {
    const video = new FakeVideo();
    video.play.mockImplementation(() => {
      throw new Error("Playback unavailable");
    });
    const updates = vi.fn<(state: VideoPlaybackState) => void>();
    const controls = observeVideoPlayback(video.element, updates);
    expect(controls.togglePlayback()).toBe(false);
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ paused: true })
    );
    expect(controls.togglePlayback()).toBe(false);
    expect(video.play).toHaveBeenCalledTimes(2);
    controls.dispose();
  });

  it("refreshes seeking and buffering as metadata arrives and a source empties", () => {
    const video = new FakeVideo();
    video.duration = NaN;
    video.seekable = timeRanges([]);
    const updates = vi.fn<(state: VideoPlaybackState) => void>();
    const controls = observeVideoPlayback(video.element, updates);
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ duration: 0, seekable: false })
    );
    video.duration = 120;
    video.seekable = timeRanges([[0, 120]]);
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ duration: 120, seekable: true })
    );
    video.buffered = timeRanges([[0, 100]]);
    video.dispatchEvent(new Event("progress"));
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ bufferedEnd: 100 })
    );
    video.duration = NaN;
    video.seekable = timeRanges([]);
    video.dispatchEvent(new Event("emptied"));
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ duration: 0, seekable: false, currentTime: 0 })
    );
    controls.dispose();
  });

  it("allows a second toggle to cancel a play request before it settles", async () => {
    const video = new FakeVideo();
    const pending = pendingPlay();
    video.play.mockImplementationOnce(() => pending.promise);
    const updates = vi.fn<(state: VideoPlaybackState) => void>();
    const controls = observeVideoPlayback(video.element, updates);
    expect(controls.togglePlayback()).toBe(false);
    expect(controls.togglePlayback()).toBe(true);
    expect(video.pause).toHaveBeenCalledOnce();
    const count = updates.mock.calls.length;
    pending.resolve();
    await Promise.resolve();
    expect(updates).toHaveBeenCalledTimes(count);
    controls.dispose();
  });

  it("ignores pending promises, old events and commands after source disposal", async () => {
    const video = new FakeVideo();
    const pending = pendingPlay();
    video.play.mockImplementationOnce(() => pending.promise);
    const updates = vi.fn<(state: VideoPlaybackState) => void>();
    const controls = observeVideoPlayback(video.element, updates);
    controls.togglePlayback();
    controls.dispose();
    const count = updates.mock.calls.length;
    pending.reject(new Error("Source replaced"));
    await Promise.resolve();
    video.dispatchEvent(new Event("timeupdate"));
    controls.seek(90);
    controls.toggleMuted();
    expect(controls.togglePlayback()).toBeNull();
    expect(updates).toHaveBeenCalledTimes(count);
    expect(video.currentTime).toBe(5);
    expect(video.muted).toBe(true);
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it("seeks into available intervals without changing paused state", () => {
    const video = new FakeVideo();
    video.seekable = timeRanges([[20, 120]]);
    const updates = vi.fn<(state: VideoPlaybackState) => void>();
    const controls = observeVideoPlayback(video.element, updates);
    controls.seek(2);
    expect(video.currentTime).toBe(20);
    expect(video.paused).toBe(true);
    controls.seek(Infinity);
    expect(video.currentTime).toBe(20);
    expect(video.play).not.toHaveBeenCalled();
    controls.dispose();
  });

  it("restores audible volume when unmuting a zero-volume video", () => {
    const video = new FakeVideo();
    video.muted = false;
    video.volume = 0;
    const controls = observeVideoPlayback(video.element, () => undefined);
    controls.toggleMuted();
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);
    controls.toggleMuted();
    expect(video.muted).toBe(true);
    controls.dispose();
  });

  it("tolerates a source becoming unseekable during user input", () => {
    const video = new FakeVideo();
    const controls = observeVideoPlayback(video.element, () => undefined);
    Object.defineProperty(video, "currentTime", {
      get: () => 5,
      set: () => {
        throw new Error("Source detached");
      }
    });
    expect(() => controls.seek(30)).not.toThrow();
    controls.dispose();
  });
});
