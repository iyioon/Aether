import { describe, expect, it, vi } from "vitest";
import { ApiTimeoutError, type VideoPlaybackFailure } from "../../api/client";
import { observeVideoPlaybackFailure } from "./video-playback-failure";

const source = "/api/assets/video/playback?variant=bounce";
const failure: VideoPlaybackFailure = {
  kind: "preparation",
  code: "media_tool_unavailable",
  status: 503
};
class FakeDocument extends EventTarget {
  hidden = false;
  defaultView = new EventTarget();
  get document() {
    return this as unknown as Document;
  }
}
class FakeVideo {
  source = source;
  error: { code: number } | null = null;
  getAttribute() {
    return this.source;
  }
  get video() {
    return this as unknown as HTMLVideoElement;
  }
}
function pending() {
  let resolve!: (failure: VideoPlaybackFailure) => void;
  const promise = new Promise<VideoPlaybackFailure>((yes) => (resolve = yes));
  return { promise, resolve };
}

describe("video playback failure observer", () => {
  it.each([
    [2, "network", "media_network_failed"],
    [3, "browser", "browser_playback_unsupported"],
    [4, "browser", "browser_playback_unsupported"]
  ] as const)(
    "distinguishes a recovered network request from decoding failure: %s",
    async (code, kind, expectedCode) => {
      const owner = new FakeDocument();
      const video = new FakeVideo();
      video.error = { code };
      const publish = vi.fn();
      const observer = observeVideoPlaybackFailure(
        source,
        publish,
        owner.document,
        () =>
          Promise.resolve({
            kind: "browser",
            code: "browser_playback_unsupported",
            status: 200
          })
      );
      observer.diagnose(video.video);
      await Promise.resolve();
      expect(publish).toHaveBeenCalledExactlyOnceWith(
        code === 2
          ? { kind, code: expectedCode }
          : { kind, code: expectedCode, status: 200 }
      );
      observer.dispose();
    }
  );

  it("retains a known server reason after a native network error", async () => {
    const owner = new FakeDocument();
    const video = new FakeVideo();
    video.error = { code: 2 };
    const publish = vi.fn();
    const observer = observeVideoPlaybackFailure(
      source,
      publish,
      owner.document,
      () => Promise.resolve(failure)
    );
    observer.diagnose(video.video);
    await Promise.resolve();
    expect(publish).toHaveBeenCalledExactlyOnceWith(failure);
    observer.dispose();
  });

  it("diagnoses one final failure per source until an explicit retry", async () => {
    const owner = new FakeDocument();
    const video = new FakeVideo();
    const publish = vi.fn();
    const inspect = vi.fn(() => Promise.resolve(failure));
    const observer = observeVideoPlaybackFailure(
      source,
      publish,
      owner.document,
      inspect
    );
    observer.diagnose(video.video);
    observer.diagnose(video.video);
    await Promise.resolve();
    expect(inspect).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledExactlyOnceWith(failure);
    observer.clear();
    observer.diagnose(video.video);
    await Promise.resolve();
    expect(inspect).toHaveBeenCalledTimes(2);
    observer.dispose();
  });

  it("aborts old work on retry and rejects its late result", async () => {
    const owner = new FakeDocument();
    const video = new FakeVideo();
    const old = pending();
    const latest = pending();
    const publish = vi.fn();
    const signals: Array<AbortSignal | undefined> = [];
    const inspect = vi.fn((_source: string, signal?: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? old.promise : latest.promise;
    });
    const observer = observeVideoPlaybackFailure(
      source,
      publish,
      owner.document,
      inspect
    );
    observer.diagnose(video.video);
    observer.clear();
    observer.diagnose(video.video);
    expect(signals[0]?.aborted).toBe(true);
    old.resolve(failure);
    await Promise.resolve();
    expect(publish).toHaveBeenCalledExactlyOnceWith(null);
    latest.resolve(failure);
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith(failure);
    observer.dispose();
  });

  it.each(["dispose", "hidden", "pagehide", "source"] as const)(
    "does not publish obsolete diagnostics after %s",
    async (reason) => {
      const owner = new FakeDocument();
      const video = new FakeVideo();
      const job = pending();
      let signal: AbortSignal | undefined;
      const publish = vi.fn();
      const observer = observeVideoPlaybackFailure(
        source,
        publish,
        owner.document,
        (_source, callerSignal) => {
          signal = callerSignal;
          return job.promise;
        }
      );
      observer.diagnose(video.video);
      if (reason === "dispose") observer.dispose();
      if (reason === "hidden") {
        owner.hidden = true;
        owner.dispatchEvent(new Event("visibilitychange"));
      }
      if (reason === "pagehide")
        owner.defaultView.dispatchEvent(new Event("pagehide"));
      if (reason === "source") video.source = "/api/assets/next/media";
      if (reason !== "source") expect(signal?.aborted).toBe(true);
      job.resolve(failure);
      await Promise.resolve();
      expect(publish).not.toHaveBeenCalled();
      observer.dispose();
    }
  );

  it("ignores errors from a previous node or a hidden page", () => {
    const owner = new FakeDocument();
    const video = new FakeVideo();
    const inspect = vi.fn(() => Promise.resolve(failure));
    const observer = observeVideoPlaybackFailure(
      source,
      vi.fn(),
      owner.document,
      inspect
    );
    video.source = "/api/assets/old/media";
    observer.diagnose(video.video);
    video.source = source;
    owner.hidden = true;
    observer.diagnose(video.video);
    expect(inspect).not.toHaveBeenCalled();
    observer.dispose();
  });

  it.each([
    [new TypeError("private network details"), "media_network_failed"],
    [new ApiTimeoutError(30_000), "request_timeout"]
  ])("reports safe network failures: %s", async (error, code) => {
    const owner = new FakeDocument();
    const publish = vi.fn();
    const observer = observeVideoPlaybackFailure(
      source,
      publish,
      owner.document,
      () => Promise.reject(error)
    );
    observer.diagnose(new FakeVideo().video);
    await Promise.resolve();
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      kind: "network",
      code
    });
    observer.dispose();
  });
});
