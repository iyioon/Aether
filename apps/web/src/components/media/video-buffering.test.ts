import { describe, expect, it, vi } from "vitest";
import { observeVideoBuffering } from "./video-buffering";

class FakeDocument extends EventTarget {
  hidden = false;
  defaultView = new EventTarget();
  get document() {
    return this as unknown as Document;
  }
}

class FakeVideo extends EventTarget {
  source = "/api/assets/video/playback?variant=bounce&v=current";
  paused = false;
  ended = false;
  error: MediaError | null = null;
  readyState = 2;
  isConnected = true;
  currentTime = 1.5;
  play = vi.fn();
  pause = vi.fn();
  load = vi.fn();
  getAttribute() {
    return this.source;
  }
  get video() {
    return this as unknown as HTMLVideoElement;
  }
  emit(event: string) {
    this.dispatchEvent(new Event(event));
  }
}

function setup() {
  const owner = new FakeDocument();
  const video = new FakeVideo();
  const publish = vi.fn();
  const dispose = observeVideoBuffering(video.video, publish, owner.document);
  return { owner, video, publish, dispose };
}

describe("video buffering feedback", () => {
  it("reports starvation and recovery without changing playback or its frame", () => {
    const { video, publish, dispose } = setup();
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
    video.emit("waiting");
    expect(publish).toHaveBeenLastCalledWith(true);
    video.emit("stalled");
    video.emit("progress");
    expect(publish).toHaveBeenCalledTimes(2);
    video.emit("playing");
    expect(publish.mock.calls).toEqual([[false], [true], [false]]);
    expect(video.currentTime).toBe(1.5);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
    dispose();
  });

  it.each([3, 4])(
    "does not treat network stalled with readyState %s as playback starvation",
    (readyState) => {
      const { video, publish, dispose } = setup();
      video.readyState = readyState;
      video.emit("stalled");
      video.emit("waiting");
      video.emit("seeking");
      expect(publish).toHaveBeenCalledExactlyOnceWith(false);
      dispose();
    }
  );

  it.each(["canplay", "canplaythrough", "progress", "loadeddata", "seeked"])(
    "clears starvation on %s only when enough future data is available",
    (event) => {
      const { video, publish, dispose } = setup();
      video.emit("waiting");
      video.emit(event);
      expect(publish).toHaveBeenLastCalledWith(true);
      video.readyState = 3;
      video.emit(event);
      expect(publish.mock.calls).toEqual([[false], [true], [false]]);
      dispose();
    }
  );

  it.each(["pause", "ended", "error", "emptied", "loadstart"])(
    "clears buffering after %s without attempting recovery",
    (event) => {
      const { video, publish, dispose } = setup();
      video.emit("waiting");
      video.emit(event);
      expect(publish.mock.calls).toEqual([[false], [true], [false]]);
      expect(video.play).not.toHaveBeenCalled();
      expect(video.pause).not.toHaveBeenCalled();
      expect(video.load).not.toHaveBeenCalled();
      dispose();
    }
  );

  it.each(["paused", "ended", "error", "detached", "source", "empty"])(
    "ignores native wait events for %s media",
    (reason) => {
      const { video, publish, dispose } = setup();
      if (reason === "paused") video.paused = true;
      if (reason === "ended") video.ended = true;
      if (reason === "error") video.error = { code: 2 } as MediaError;
      if (reason === "detached") video.isConnected = false;
      if (reason === "source") video.source = "/api/assets/next/media";
      if (reason === "empty") video.source = "";
      video.emit("waiting");
      video.emit("stalled");
      expect(publish).toHaveBeenCalledExactlyOnceWith(false);
      dispose();
    }
  );

  it("keeps a user pause clear until playback actually needs data again", () => {
    const { video, publish, dispose } = setup();
    video.emit("waiting");
    video.paused = true;
    video.emit("pause");
    video.emit("stalled");
    expect(publish).toHaveBeenLastCalledWith(false);
    video.paused = false;
    video.emit("play");
    expect(publish).toHaveBeenLastCalledWith(false);
    video.emit("waiting");
    expect(publish.mock.calls).toEqual([[false], [true], [false], [true]]);
    dispose();
  });

  it.each(["visibility", "pagehide"])(
    "clears hidden feedback after %s and rejects background wait events",
    (event) => {
      const { owner, video, publish, dispose } = setup();
      video.emit("waiting");
      if (event === "visibility") {
        owner.hidden = true;
        owner.dispatchEvent(new Event("visibilitychange"));
      } else owner.defaultView.dispatchEvent(new Event("pagehide"));
      video.emit("waiting");
      expect(publish.mock.calls).toEqual([[false], [true], [false]]);
      owner.hidden = false;
      if (event === "visibility")
        owner.dispatchEvent(new Event("visibilitychange"));
      else owner.defaultView.dispatchEvent(new Event("pageshow"));
      expect(publish).toHaveBeenLastCalledWith(false);
      video.emit("waiting");
      expect(publish).toHaveBeenLastCalledWith(true);
      dispose();
    }
  );

  it("rejects old source events and removes listeners on disposal", () => {
    const { owner, video, publish, dispose } = setup();
    video.emit("waiting");
    video.source = "/api/assets/next/media";
    video.emit("stalled");
    expect(publish.mock.calls).toEqual([[false], [true], [false]]);
    dispose();
    video.emit("waiting");
    video.emit("playing");
    owner.hidden = true;
    owner.dispatchEvent(new Event("visibilitychange"));
    owner.defaultView.dispatchEvent(new Event("pagehide"));
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("does not subscribe to playhead updates or republish unchanged states", () => {
    const { video, publish, dispose } = setup();
    const add = vi.spyOn(video, "addEventListener");
    const second = observeVideoBuffering(
      video.video,
      () => undefined,
      new FakeDocument().document
    );
    expect(add.mock.calls.map(([event]) => event)).not.toContain("timeupdate");
    second();
    for (let index = 0; index < 5; index++) video.emit("timeupdate");
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
    video.emit("waiting");
    for (let index = 0; index < 5; index++) video.emit("waiting");
    expect(publish.mock.calls).toEqual([[false], [true]]);
    dispose();
  });
});
