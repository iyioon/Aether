import { describe, expect, it } from "vitest";
import {
  feedItemTop,
  nearestFeedIndexFromScroll,
  shouldJumpFeedImmediately,
  shouldRenderFeedMedia
} from "./feed-navigation";

function feedElement(scrollTop: number, clientHeight = 800): HTMLElement {
  return { clientHeight, scrollTop } as HTMLElement;
}

describe("nearestFeedIndexFromScroll", () => {
  it("derives the nearest full-height feed item without scanning the DOM", () => {
    const items = Array<HTMLElement | null>(5).fill(null);

    expect(nearestFeedIndexFromScroll(feedElement(0), items)).toBe(0);
    expect(nearestFeedIndexFromScroll(feedElement(799), items)).toBe(1);
    expect(nearestFeedIndexFromScroll(feedElement(1_999), items)).toBe(2);
  });

  it("clamps positions to the loaded feed range", () => {
    const items = Array<HTMLElement | null>(3).fill(null);

    expect(nearestFeedIndexFromScroll(feedElement(-500), items)).toBe(0);
    expect(nearestFeedIndexFromScroll(feedElement(8_000), items)).toBe(2);
  });

  it("returns the first item while layout is unavailable", () => {
    expect(nearestFeedIndexFromScroll(null, [])).toBe(0);
    expect(nearestFeedIndexFromScroll(feedElement(500, 0), [null, null])).toBe(
      0
    );
  });
});

describe("shouldRenderFeedMedia", () => {
  it("keeps a bounded media window around the active item", () => {
    expect(shouldRenderFeedMedia(7, 10)).toBe(true);
    expect(shouldRenderFeedMedia(13, 10)).toBe(true);
    expect(shouldRenderFeedMedia(6, 10)).toBe(false);
    expect(shouldRenderFeedMedia(14, 10)).toBe(false);
  });
});

describe("shouldJumpFeedImmediately", () => {
  it("keeps nearby paging smooth and makes distant jumps immediate", () => {
    expect(shouldJumpFeedImmediately(10, 11)).toBe(false);
    expect(shouldJumpFeedImmediately(10, 13)).toBe(false);
    expect(shouldJumpFeedImmediately(10, 14)).toBe(true);
    expect(shouldJumpFeedImmediately(20, 0)).toBe(true);
  });
});

describe("feedItemTop", () => {
  it("uses the item's offset when the feed is its offset parent", () => {
    const feed = { scrollTop: 420 } as HTMLElement;
    const item = {
      offsetParent: feed,
      offsetTop: 1_600
    } as unknown as HTMLElement;

    expect(feedItemTop(feed, item)).toBe(1_600);
  });

  it("falls back to viewport geometry for a different offset parent", () => {
    const feed = {
      getBoundingClientRect: () => ({ top: 120 }),
      scrollTop: 300
    } as unknown as HTMLElement;
    const item = {
      getBoundingClientRect: () => ({ top: 570 }),
      offsetParent: null
    } as unknown as HTMLElement;

    expect(feedItemTop(feed, item)).toBe(750);
  });
});
