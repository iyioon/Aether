import { requestPresentedVideoFrame } from "./video-frame-presentation";

export interface VideoSection {
  start: number;
  end: number;
}

const sectionControllers = new WeakMap<HTMLVideoElement, object>();

export function videoSectionTime(time: number, section: VideoSection): number {
  const lastTime =
    section.end - Math.min(0.001, (section.end - section.start) / 2);
  return Math.max(section.start, Math.min(lastTime, time));
}

/** Keeps one native source timeline inside a section without decoding a copy. */
export function observeVideoSection(
  video: HTMLVideoElement,
  section: VideoSection,
  onReady: (ready: boolean) => void
): () => void {
  const document = video.ownerDocument;
  const window = document.defaultView!;
  const source = video.getAttribute("src");
  const sourceUrl = source ? new URL(source, document.baseURI).href : "";
  const controller = {};
  sectionControllers.set(video, controller);
  let active = true;
  let ready = false;
  let initialized = false;
  let wantedPlaying = !video.paused;
  let resumeAfterSeek = false;
  let frame: number | null = null;
  let videoFrame = false;
  let cancelPausedFrame: (() => void) | null = null;
  let seekingTo: number | null = null;
  let playRequest = 0;
  const sameSource = () =>
    video.getAttribute("src") === source &&
    (!video.currentSrc || !sourceUrl || video.currentSrc === sourceUrl);
  const current = () =>
    active &&
    sectionControllers.get(video) === controller &&
    !video.error &&
    sameSource();
  const visible = () => document.visibilityState !== "hidden";
  const bounds = (): VideoSection | null => {
    const end = Number.isFinite(video.duration)
      ? Math.min(section.end, video.duration)
      : section.end;
    return Number.isFinite(section.start) &&
      Number.isFinite(end) &&
      section.start >= 0 &&
      end > section.start
      ? { start: section.start, end }
      : null;
  };
  const cancelFrame = () => {
    cancelPausedFrame?.();
    cancelPausedFrame = null;
    if (frame !== null) {
      if (videoFrame) video.cancelVideoFrameCallback(frame);
      else window.cancelAnimationFrame(frame);
    }
    frame = null;
  };
  const seek = (time: number) => {
    if (seekingTo !== null || !current() || video.readyState < 1) return;
    seekingTo = time;
    try {
      video.currentTime = time;
      // A same-position assignment need not fire seeked.
      if (!video.seeking) seekingTo = null;
    } catch {
      seekingTo = null;
    }
  };
  const synchronize = () => {
    if (!current() || !visible() || video.readyState < 1) return;
    video.loop = false;
    const range = bounds();
    if (!range) return;
    if (!initialized) {
      initialized = true;
      seek(range.start);
    } else if (!video.seeking && seekingTo === null) {
      if (video.currentTime < range.start) seek(range.start);
      else if (video.currentTime >= range.end) {
        resumeAfterSeek = !video.paused || (video.ended && wantedPlaying);
        seek(
          resumeAfterSeek ? range.start : videoSectionTime(range.end, range)
        );
      }
    }
  };
  const schedule = () => {
    if (
      !current() ||
      !visible() ||
      !bounds() ||
      video.readyState < 2 ||
      (ready && video.paused)
    ) {
      cancelFrame();
      return;
    }
    if (video.paused) {
      if (video.seeking || seekingTo !== null || cancelPausedFrame) return;
      cancelPausedFrame = requestPresentedVideoFrame(video, (time) => {
        cancelPausedFrame = null;
        presented(time);
      });
      return;
    }
    if (frame !== null) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      videoFrame = true;
      frame = video.requestVideoFrameCallback((_now, metadata) => {
        frame = null;
        presented(metadata.mediaTime);
      });
    } else {
      videoFrame = false;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        presented(video.currentTime);
      });
    }
  };
  const presented = (time: number) => {
    if (!current() || !visible()) return;
    const range = bounds();
    if (
      initialized &&
      range &&
      time >= range.end &&
      !video.paused &&
      !video.seeking
    ) {
      resumeAfterSeek = true;
      seek(range.start);
    }
    synchronize();
    if (
      !ready &&
      initialized &&
      range &&
      !video.seeking &&
      seekingTo === null &&
      video.readyState >= 2 &&
      time >= range.start &&
      time < range.end
    ) {
      ready = true;
      onReady(true);
    }
    schedule();
  };
  const update = () => {
    synchronize();
    schedule();
  };
  const play = () => {
    wantedPlaying = true;
    cancelFrame();
    update();
  };
  const pause = () => {
    if (!video.ended) {
      wantedPlaying = false;
      resumeAfterSeek = false;
      playRequest += 1;
    }
    cancelFrame();
    if (!ready) schedule();
  };
  const seeked = () => {
    seekingTo = null;
    synchronize();
    if (resumeAfterSeek && current() && visible() && wantedPlaying) {
      resumeAfterSeek = false;
      if (!video.paused) {
        schedule();
        return;
      }
      const request = ++playRequest;
      try {
        void video.play().then(
          () => {
            const detachedAfterDisposal =
              !active &&
              !video.isConnected &&
              sameSource() &&
              !sectionControllers.has(video);
            if (
              detachedAfterDisposal ||
              (active &&
                sectionControllers.get(video) === controller &&
                (!current() ||
                  !visible() ||
                  !wantedPlaying ||
                  request !== playRequest))
            )
              video.pause();
          },
          () => undefined
        );
      } catch {
        // Playback policy may require another user gesture.
      }
    }
    schedule();
  };
  const seeking = () => {
    cancelFrame();
    update();
  };
  const emptied = () => {
    cancelFrame();
    initialized = false;
    seekingTo = null;
    resumeAfterSeek = false;
    ready = false;
    onReady(false);
  };
  const error = () => {
    wantedPlaying = false;
    resumeAfterSeek = false;
    playRequest += 1;
    cancelFrame();
  };
  const visibility = () => {
    if (!visible()) {
      cancelFrame();
      playRequest += 1;
    } else update();
  };
  const events: Array<[string, EventListener]> = [
    ["loadedmetadata", update],
    ["durationchange", update],
    ["timeupdate", update],
    ["canplay", update],
    ["play", play],
    ["playing", play],
    ["pause", pause],
    ["seeking", seeking],
    ["seeked", seeked],
    ["ended", update],
    ["emptied", emptied],
    ["error", error]
  ];
  for (const [event, listener] of events)
    video.addEventListener(event, listener);
  document.addEventListener("visibilitychange", visibility);
  onReady(false);
  update();
  return () => {
    active = false;
    if (sectionControllers.get(video) === controller)
      sectionControllers.delete(video);
    playRequest += 1;
    cancelFrame();
    for (const [event, listener] of events)
      video.removeEventListener(event, listener);
    document.removeEventListener("visibilitychange", visibility);
  };
}
