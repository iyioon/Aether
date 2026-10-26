export function requestPresentedVideoFrame(
  video: HTMLVideoElement,
  onPresented: (mediaTime: number) => void
): () => void {
  const document = video.ownerDocument;
  const window = document.defaultView!;
  const source = video.getAttribute("src");
  const sourceUrl = source ? new URL(source, document.baseURI).href : "";
  const hasVideoFrame = typeof video.requestVideoFrameCallback === "function";
  let active = true;
  let videoFrame: number | null = null;
  let animationFrame: number | null = null;
  const current = () =>
    active &&
    !video.error &&
    document.visibilityState !== "hidden" &&
    video.getAttribute("src") === source &&
    (!video.currentSrc || !sourceUrl || video.currentSrc === sourceUrl);
  const decoded = () => video.readyState >= 2 && !video.seeking;
  const cancelAnimation = () => {
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  };
  const cancel = () => {
    if (!active) return;
    active = false;
    if (videoFrame !== null) video.cancelVideoFrameCallback?.(videoFrame);
    videoFrame = null;
    cancelAnimation();
    for (const [event, listener] of events)
      video.removeEventListener(event, listener);
    document.removeEventListener("visibilitychange", visibility);
  };
  const presented = (time: number) => {
    if (!current()) {
      cancel();
      return;
    }
    if (!decoded()) return;
    cancel();
    onPresented(time);
  };
  const scheduleAnimation = () => {
    if (
      !current() ||
      !decoded() ||
      (hasVideoFrame && !video.paused) ||
      animationFrame !== null
    )
      return;
    const time = video.currentTime;
    animationFrame = window.requestAnimationFrame(() => {
      if (!current()) {
        cancel();
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        if (!current()) {
          cancel();
          return;
        }
        if (
          decoded() &&
          (!hasVideoFrame || video.paused) &&
          (!video.paused || video.currentTime === time)
        )
          presented(video.currentTime);
      });
    });
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") cancel();
  };
  const play = () => {
    cancelAnimation();
    if (!hasVideoFrame) scheduleAnimation();
  };
  const events: Array<[string, EventListener]> = [
    ["pause", scheduleAnimation],
    ["seeked", scheduleAnimation],
    ["canplay", scheduleAnimation],
    ["play", play],
    ["seeking", cancel],
    ["emptied", cancel],
    ["loadstart", cancel],
    ["error", cancel]
  ];
  for (const [event, listener] of events)
    video.addEventListener(event, listener);
  document.addEventListener("visibilitychange", visibility);
  if (current()) {
    if (hasVideoFrame)
      videoFrame = video.requestVideoFrameCallback((_now, metadata) => {
        videoFrame = null;
        presented(metadata.mediaTime);
      });
    scheduleAnimation();
  } else cancel();
  return cancel;
}
