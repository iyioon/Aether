/** Observe native playback starvation without changing playback or its source. */
export function observeVideoBuffering(
  video: HTMLVideoElement,
  publish: (buffering: boolean) => void,
  ownerDocument: Document = video.ownerDocument
): () => void {
  const source = video.getAttribute("src");
  let active = true;
  let pageHidden = ownerDocument.hidden;
  let buffering: boolean | null = null;
  const canWait = () =>
    active &&
    !pageHidden &&
    !ownerDocument.hidden &&
    video.isConnected &&
    Boolean(source) &&
    video.getAttribute("src") === source &&
    !video.paused &&
    !video.ended &&
    video.error === null;
  const update = (next: boolean) => {
    if (!active || buffering === next) return;
    buffering = next;
    publish(next);
  };
  const clear = () => update(false);
  const waiting = () => update(canWait() && video.readyState < 3);
  const refresh = () => {
    if (!canWait() || video.readyState >= 3) clear();
  };
  const visibility = () => {
    pageHidden = ownerDocument.hidden;
    if (pageHidden) clear();
  };
  const hide = () => {
    pageHidden = true;
    clear();
  };
  const show = () => {
    pageHidden = ownerDocument.hidden;
    refresh();
  };
  const listeners: Array<[string, () => void]> = [
    ["waiting", waiting],
    ["stalled", waiting],
    ["seeking", waiting],
    ["playing", clear],
    ["canplay", refresh],
    ["canplaythrough", refresh],
    ["loadeddata", refresh],
    ["progress", refresh],
    ["seeked", refresh],
    ["pause", clear],
    ["ended", clear],
    ["error", clear],
    ["emptied", clear],
    ["loadstart", clear]
  ];
  for (const [event, listener] of listeners)
    video.addEventListener(event, listener);
  ownerDocument.addEventListener("visibilitychange", visibility);
  ownerDocument.defaultView?.addEventListener("pagehide", hide);
  ownerDocument.defaultView?.addEventListener("pageshow", show);
  clear();
  return () => {
    active = false;
    for (const [event, listener] of listeners)
      video.removeEventListener(event, listener);
    ownerDocument.removeEventListener("visibilitychange", visibility);
    ownerDocument.defaultView?.removeEventListener("pagehide", hide);
    ownerDocument.defaultView?.removeEventListener("pageshow", show);
  };
}
