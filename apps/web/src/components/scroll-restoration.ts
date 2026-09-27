export type ScrollSurface = "folder-tree" | "library-content";

export interface SessionScrollPosition {
  anchorId?: string;
  anchorOffset?: number;
  anchorSize?: number;
  contextKey: string;
  index?: number;
  scrollTop: number;
}

export interface ScrollAnchorItem {
  end: number;
  index: number;
  start: number;
}

const STORAGE_PREFIX = "aether.scroll.v2";
const LEGACY_STORAGE_KEYS = [
  "aether.scroll.v1.feed",
  "aether.scroll.v1.folder-tree",
  "aether.scroll.v1.gallery"
];

export function findScrollAnchorItem<T extends ScrollAnchorItem>(
  items: readonly T[],
  scrollTop: number
): T | undefined {
  let precedingItem: T | undefined;

  for (const item of items) {
    if (item.start > scrollTop) {
      break;
    }

    precedingItem = item;

    if (item.end > scrollTop) {
      return item;
    }
  }

  return precedingItem ?? items[0];
}

export function readSessionScrollPosition(
  surface: ScrollSurface
): SessionScrollPosition | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.sessionStorage.getItem(storageKey(surface));

    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<SessionScrollPosition>;

    if (
      typeof parsed.contextKey !== "string" ||
      typeof parsed.scrollTop !== "number" ||
      !Number.isFinite(parsed.scrollTop)
    ) {
      return null;
    }

    return {
      anchorId:
        typeof parsed.anchorId === "string" ? parsed.anchorId : undefined,
      anchorOffset:
        typeof parsed.anchorOffset === "number" &&
        Number.isFinite(parsed.anchorOffset)
          ? parsed.anchorOffset
          : undefined,
      anchorSize:
        typeof parsed.anchorSize === "number" &&
        Number.isFinite(parsed.anchorSize) &&
        parsed.anchorSize > 0
          ? parsed.anchorSize
          : undefined,
      contextKey: parsed.contextKey,
      index:
        typeof parsed.index === "number" && Number.isFinite(parsed.index)
          ? parsed.index
          : undefined,
      scrollTop: Math.max(0, parsed.scrollTop)
    };
  } catch {
    return null;
  }
}

export function writeSessionScrollPosition(
  surface: ScrollSurface,
  position: SessionScrollPosition
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      storageKey(surface),
      JSON.stringify({
        ...position,
        scrollTop: Math.max(0, Math.round(position.scrollTop))
      })
    );
  } catch {
    // Scroll restoration is optional and should never block navigation.
  }
}

export function clearSessionScrollPositions() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    for (const surface of ["folder-tree", "library-content"] as const) {
      window.sessionStorage.removeItem(storageKey(surface));
    }
    for (const key of LEGACY_STORAGE_KEYS) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore unavailable session storage during logout.
  }
}

function storageKey(surface: ScrollSurface): string {
  return `${STORAGE_PREFIX}.${surface}`;
}
