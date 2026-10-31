import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeFeedPrewarmPriority } from "./feed-prewarm";

class FakeConnection extends EventTarget {
  saveData = false;
  effectiveType = "4g";
  downlink = 10;
}
class FakeVideo {
  isConnected = true;
  paused = false;
  ended = false;
  seeking = false;
  error = null;
  readyState = 3;
  duration = 10;
  currentTime = 1;
  playbackRate = 1;
  bufferedEnd = 4;
  get buffered() {
    return { length: 1, start: () => 0, end: () => this.bufferedEnd };
  }
  get video() {
    return this as unknown as HTMLVideoElement;
  }
}
class FakeDocument extends EventTarget {
  hidden = false;
  defaultView = Object.assign(new EventTarget(), {
    navigator: { onLine: true, connection: new FakeConnection() }
  });
}
class FakeFeed extends EventTarget {
  isConnected = true;
  ownerDocument = new FakeDocument();
  active = new FakeVideo();
  get element() {
    return this as unknown as HTMLElement;
  }
  get item() {
    return { querySelector: () => this.active.video } as unknown as HTMLElement;
  }
  emit(type: string, target: unknown = this.active.video) {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    this.dispatchEvent(event);
  }
}

const disposers: Array<() => void> = [];
function setup(isVideo = true) {
  const feed = new FakeFeed();
  const publish = vi.fn();
  const dispose = observeFeedPrewarmPriority(
    feed.element,
    () => feed.item,
    isVideo,
    publish
  );
  disposers.push(dispose);
  return {
    feed,
    publish,
    dispose,
    owner: feed.ownerDocument,
    network: feed.ownerDocument.defaultView.navigator
  };
}

describe("Feed foreground-first prewarm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.useRealTimers();
  });

  it("waits for a stable decoded current video and two seconds of future data", async () => {
    const { feed, publish } = setup();
    feed.active.readyState = 2;
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
    feed.active.readyState = 3;
    feed.active.bufferedEnd = 2;
    feed.emit("progress");
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
    feed.active.bufferedEnd = 3;
    feed.emit("progress");
    await vi.advanceTimersByTimeAsync(249);
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(publish.mock.calls).toEqual([[false], [true]]);
  });

  it.each([
    "waiting",
    "stalled",
    "seeking",
    "loadstart",
    "emptied",
    "pause",
    "error"
  ])(
    "yields immediately on current %s and resumes only after healthy data",
    async (event) => {
      const { feed, publish } = setup();
      await vi.advanceTimersByTimeAsync(250);
      feed.emit(event);
      expect(publish).toHaveBeenLastCalledWith(false);
      feed.active.bufferedEnd = 1.5;
      feed.emit("progress");
      await vi.advanceTimersByTimeAsync(500);
      expect(publish).toHaveBeenLastCalledWith(false);
      feed.active.bufferedEnd = 4;
      feed.emit("playing");
      await vi.advanceTimersByTimeAsync(250);
      expect(publish.mock.calls).toEqual([[false], [true], [false], [true]]);
    }
  );

  it("ignores neighbors' media events and admits a short fully buffered tail", async () => {
    const { feed, publish } = setup();
    feed.active.currentTime = 9.5;
    feed.active.bufferedEnd = 10;
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenLastCalledWith(true);
    feed.emit("waiting", new FakeVideo().video);
    expect(publish.mock.calls).toEqual([[false], [true]]);
  });

  it("reserves two wall-clock seconds after playback speed changes", async () => {
    const { feed, publish } = setup();
    await vi.advanceTimersByTimeAsync(250);
    feed.active.playbackRate = 2;
    feed.emit("ratechange");
    expect(publish).toHaveBeenLastCalledWith(false);
    feed.active.bufferedEnd = 5;
    feed.emit("progress");
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenLastCalledWith(true);
    feed.active.playbackRate = 0.5;
    feed.active.bufferedEnd = 2;
    feed.emit("ratechange");
    expect(publish).toHaveBeenLastCalledWith(true);
  });

  it("yields as the current video consumes its buffer without further network progress", async () => {
    const { feed, publish } = setup();
    await vi.advanceTimersByTimeAsync(250);
    feed.active.currentTime = 2.5;
    feed.emit("timeupdate");
    expect(publish.mock.calls).toEqual([[false], [true], [false]]);
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).toHaveBeenLastCalledWith(false);
  });

  it("blocks manual pause, seeking and detached media even when bytes are buffered", async () => {
    const { feed, publish } = setup();
    feed.active.paused = true;
    await vi.advanceTimersByTimeAsync(250);
    feed.emit("progress");
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
    feed.active.paused = false;
    feed.active.seeking = true;
    feed.emit("progress");
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
    feed.active.seeking = false;
    feed.active.isConnected = false;
    feed.emit("canplay");
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each(["data saver", "2g", "slow-2g", "low bandwidth", "offline"])(
    "cancels eligibility for %s and rechecks connection changes",
    async (policy) => {
      const { owner, network, publish } = setup();
      await vi.advanceTimersByTimeAsync(250);
      if (policy === "data saver") network.connection.saveData = true;
      else if (policy === "low bandwidth") network.connection.downlink = 0.5;
      else if (policy === "offline") network.onLine = false;
      else network.connection.effectiveType = policy;
      network.connection.dispatchEvent(new Event("change"));
      expect(publish).toHaveBeenLastCalledWith(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(publish).toHaveBeenLastCalledWith(false);
      network.connection.saveData = false;
      network.connection.downlink = 10;
      network.connection.effectiveType = "4g";
      network.onLine = true;
      owner.defaultView.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(250);
      expect(publish).toHaveBeenLastCalledWith(true);
    }
  );

  it("cancels on hide and does not restart until pageshow and foreground readiness", async () => {
    const { owner, publish } = setup();
    await vi.advanceTimersByTimeAsync(250);
    owner.defaultView.dispatchEvent(new Event("pagehide"));
    expect(publish).toHaveBeenLastCalledWith(false);
    owner.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).toHaveBeenLastCalledWith(false);
    owner.defaultView.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenLastCalledWith(true);
    owner.hidden = true;
    owner.dispatchEvent(new Event("visibilitychange"));
    expect(publish).toHaveBeenLastCalledWith(false);
  });

  it("disposes an obsolete item without late publication or restarted work", async () => {
    const { feed, owner, publish, dispose } = setup();
    dispose();
    feed.active = new FakeVideo();
    feed.emit("playing");
    owner.defaultView.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(publish).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("permits a next video while viewing a photo after the same idle delay", async () => {
    const { publish } = setup(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(publish.mock.calls).toEqual([[false], [true]]);
  });
});
