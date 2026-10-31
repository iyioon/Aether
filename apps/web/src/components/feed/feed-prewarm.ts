interface ConnectionInformation extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

const PRIORITY_DELAY_MS = 250;
const BUFFER_SECONDS = 2;
const blockedEvents = [
  "waiting",
  "stalled",
  "seeking",
  "loadstart",
  "emptied",
  "pause",
  "error"
];
const readyEvents = [
  "playing",
  "canplay",
  "canplaythrough",
  "progress",
  "loadeddata",
  "seeked",
  "ratechange",
  "timeupdate"
];

/** The current video owns the connection before the next item may prepare. */
export function observeFeedPrewarmPriority(
  feed: HTMLElement,
  activeItem: () => HTMLElement | null,
  isVideo: boolean,
  publish: (allowed: boolean) => void
) {
  const owner = feed.ownerDocument;
  const view = owner.defaultView;
  const network = (view?.navigator ?? navigator) as Navigator & {
    connection?: ConnectionInformation;
  };
  const connection = network.connection;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let allowed = false;
  let pageHidden = false;
  let disposed = false;

  function update(value: boolean) {
    if (disposed || value === allowed) return;
    allowed = value;
    publish(value);
  }
  function block() {
    clearTimeout(timer);
    timer = undefined;
    update(false);
  }
  function eligible() {
    if (
      disposed ||
      pageHidden ||
      owner.hidden ||
      !feed.isConnected ||
      network.onLine === false ||
      connection?.saveData ||
      ["slow-2g", "2g"].includes(connection?.effectiveType ?? "") ||
      (typeof connection?.downlink === "number" && connection.downlink < 1)
    )
      return false;
    if (!isVideo) return true;
    const video = activeItem()?.querySelector("video");
    if (
      !video ||
      !video.isConnected ||
      video.paused ||
      video.ended ||
      video.seeking ||
      video.error ||
      video.readyState < 3
    )
      return false;
    const rate =
      Number.isFinite(video.playbackRate) && video.playbackRate > 0
        ? video.playbackRate
        : 1;
    const minimum = Math.min(
      BUFFER_SECONDS * rate,
      Math.max(0, video.duration - video.currentTime)
    );
    if (!Number.isFinite(minimum) || minimum <= 0) return false;
    for (let index = 0; index < video.buffered.length; index++) {
      if (
        video.buffered.start(index) <= video.currentTime &&
        video.buffered.end(index) - video.currentTime + 0.01 >= minimum
      )
        return true;
    }
    return false;
  }
  function refresh() {
    if (!eligible()) return block();
    if (allowed || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (eligible()) update(true);
    }, PRIORITY_DELAY_MS);
  }
  function mediaEvent(event: Event) {
    if (event.target !== activeItem()?.querySelector("video")) return;
    if (blockedEvents.includes(event.type)) block();
    else refresh();
  }
  const hide = () => {
    pageHidden = true;
    block();
  };
  const show = () => {
    pageHidden = false;
    refresh();
  };
  for (const event of [...blockedEvents, ...readyEvents])
    feed.addEventListener(event, mediaEvent, true);
  owner.addEventListener("visibilitychange", refresh);
  view?.addEventListener("pagehide", hide);
  view?.addEventListener("pageshow", show);
  view?.addEventListener("online", refresh);
  view?.addEventListener("offline", refresh);
  connection?.addEventListener("change", refresh);
  publish(false);
  refresh();
  return () => {
    disposed = true;
    block();
    for (const event of [...blockedEvents, ...readyEvents])
      feed.removeEventListener(event, mediaEvent, true);
    owner.removeEventListener("visibilitychange", refresh);
    view?.removeEventListener("pagehide", hide);
    view?.removeEventListener("pageshow", show);
    view?.removeEventListener("online", refresh);
    view?.removeEventListener("offline", refresh);
    connection?.removeEventListener("change", refresh);
  };
}
