export const FEED_WHEEL_LOCK_MS = 620;
export const FEED_WHEEL_THRESHOLD = 28;
export const FEED_TOUCH_DISTANCE = 54;
export const FEED_TOUCH_VELOCITY = 0.34;
export const FEED_PRELOAD_DISTANCE = 1;
export const FEED_RENDER_DISTANCE = 3;

export function shouldRenderFeedMedia(index: number, activeIndex: number) {
  return Math.abs(index - activeIndex) <= FEED_RENDER_DISTANCE;
}

export function shouldJumpFeedImmediately(
  currentIndex: number,
  nextIndex: number
) {
  return Math.abs(nextIndex - currentIndex) > FEED_RENDER_DISTANCE;
}

export function nearestFeedIndexFromScroll(
  feedElement: HTMLElement | null,
  itemRefs: Array<HTMLElement | null>
): number {
  if (!feedElement || itemRefs.length === 0) {
    return 0;
  }

  const itemHeight = feedElement.clientHeight;

  if (itemHeight <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      Math.round(feedElement.scrollTop / itemHeight),
      itemRefs.length - 1
    )
  );
}

export function feedItemTop(
  feedElement: HTMLElement,
  item: HTMLElement
): number {
  if (item.offsetParent === feedElement) {
    return item.offsetTop;
  }

  return (
    item.getBoundingClientRect().top -
    feedElement.getBoundingClientRect().top +
    feedElement.scrollTop
  );
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "a, button, input, select, textarea, [contenteditable='true']"
      )
    )
  );
}
