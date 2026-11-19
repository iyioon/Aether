/** Coalesces editor seeks without publishing an unfinished browser position. */
export function observePresentationVideoSeeking(video: HTMLVideoElement): {
  seek: (timeMs: number) => void;
  readTime: () => number | null;
  dispose: () => void;
} {
  const document = video.ownerDocument;
  const source = video.getAttribute("src");
  const sourceUrl = source ? new URL(source, document.baseURI).href : "";
  let active = true;
  let requested: number | null = null;
  let applied: number | null = null;
  const current = () =>
    active &&
    !video.error &&
    video.getAttribute("src") === source &&
    (!video.currentSrc || !sourceUrl || video.currentSrc === sourceUrl);
  const flush = () => {
    if (
      !current() ||
      document.visibilityState === "hidden" ||
      requested === null ||
      video.readyState < 1 ||
      video.seeking
    )
      return;
    const duration = video.duration * 1000;
    const target =
      Number.isFinite(duration) && duration > 0
        ? Math.min(requested, duration - Math.min(1, duration / 2))
        : requested;
    if (Math.abs(video.currentTime * 1000 - target) < 0.001) {
      requested = null;
      applied = null;
      return;
    }
    applied = requested;
    try {
      video.currentTime = target / 1000;
      // An already decoded, same-position seek need not emit seeked.
      if (!video.seeking) {
        requested = null;
        applied = null;
      }
    } catch {
      // Metadata or seekability can change between this check and assignment.
      applied = null;
    }
  };
  const seeked = () => {
    if (!current() || video.seeking) return;
    if (requested === applied) {
      requested = null;
      applied = null;
    }
    flush();
  };
  const events: Array<[string, EventListener]> = [
    ["loadedmetadata", flush],
    ["canplay", flush],
    ["seeked", seeked]
  ];
  for (const [event, listener] of events)
    video.addEventListener(event, listener);
  document.addEventListener("visibilitychange", flush);
  return {
    seek(timeMs) {
      if (!current() || !Number.isFinite(timeMs)) return;
      requested = Math.max(0, timeMs);
      flush();
    },
    readTime() {
      return current() &&
        requested === null &&
        !video.seeking &&
        video.readyState >= 1 &&
        Number.isFinite(video.currentTime)
        ? video.currentTime * 1000
        : null;
    },
    dispose() {
      active = false;
      for (const [event, listener] of events)
        video.removeEventListener(event, listener);
      document.removeEventListener("visibilitychange", flush);
    }
  };
}
