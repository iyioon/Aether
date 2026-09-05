export const FEED_WHEEL_LOCK_MS = 620;
export const FEED_WHEEL_THRESHOLD = 28;
export const FEED_TOUCH_DISTANCE = 54;
export const FEED_TOUCH_VELOCITY = 0.34;
export const FEED_PRELOAD_DISTANCE = 1;

export function nearestFeedIndexFromScroll(
  feedElement: HTMLElement | null,
  itemRefs: Array<HTMLElement | null>
): number {
  if (!feedElement) {
    return 0;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < itemRefs.length; index += 1) {
    const item = itemRefs[index];

    if (!item) {
      continue;
    }

    const distance = Math.abs(
      feedItemTop(feedElement, item) - feedElement.scrollTop
    );

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

export function feedItemTop(
  feedElement: HTMLElement,
  item: HTMLElement
): number {
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
