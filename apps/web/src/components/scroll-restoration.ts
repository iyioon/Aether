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
const STORAGE_WRITE_DELAY_MS = 120;
const LEGACY_STORAGE_KEYS = [
  "aether.scroll.v1.feed",
  "aether.scroll.v1.folder-tree",
  "aether.scroll.v1.gallery"
];
const cachedPositions = new Map<ScrollSurface, SessionScrollPosition>();
const dirtySurfaces = new Set<ScrollSurface>();
const pendingStorageWrites = new Map<
  ScrollSurface,
  ReturnType<typeof setTimeout>
>();

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

export function scaleScrollAnchorOffset(
  anchorOffset: number | undefined,
  previousAnchorSize: number | undefined,
  nextAnchorSize: number
): number {
  const safeOffset =
    typeof anchorOffset === "number" && Number.isFinite(anchorOffset)
      ? Math.max(0, anchorOffset)
      : 0;

  if (
    typeof previousAnchorSize !== "number" ||
    !Number.isFinite(previousAnchorSize) ||
    previousAnchorSize <= 0 ||
    !Number.isFinite(nextAnchorSize) ||
    nextAnchorSize <= 0
  ) {
    return safeOffset;
  }

  const rowProgress = Math.min(1, safeOffset / previousAnchorSize);
  return rowProgress * nextAnchorSize;
}

export function readSessionScrollPosition(
  surface: ScrollSurface
): SessionScrollPosition | null {
  const cachedPosition = cachedPositions.get(surface);

  if (cachedPosition) {
    return { ...cachedPosition };
  }

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

    const position = {
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
    cachedPositions.set(surface, position);
    return { ...position };
  } catch {
    return null;
  }
}

export function writeSessionScrollPosition(
  surface: ScrollSurface,
  position: SessionScrollPosition
) {
  const normalizedPosition = {
    ...position,
    scrollTop: Math.max(0, Math.round(position.scrollTop))
  };
  cachedPositions.set(surface, normalizedPosition);

  if (typeof window === "undefined") {
    return;
  }

  dirtySurfaces.add(surface);

  if (pendingStorageWrites.has(surface)) {
    return;
  }

  pendingStorageWrites.set(
    surface,
    globalThis.setTimeout(
      () => flushSessionScrollPositions(surface),
      STORAGE_WRITE_DELAY_MS
    )
  );
}

export function flushSessionScrollPositions(surface?: ScrollSurface) {
  const surfaces = surface ? [surface] : [...dirtySurfaces];

  for (const currentSurface of surfaces) {
    const pendingWrite = pendingStorageWrites.get(currentSurface);
    if (pendingWrite !== undefined) {
      globalThis.clearTimeout(pendingWrite);
      pendingStorageWrites.delete(currentSurface);
    }

    const position = cachedPositions.get(currentSurface);
    dirtySurfaces.delete(currentSurface);

    if (!position || typeof window === "undefined") {
      continue;
    }

    try {
      window.sessionStorage.setItem(
        storageKey(currentSurface),
        JSON.stringify(position)
      );
    } catch {
      // Scroll restoration is optional and should never block navigation.
    }
  }
}

export function clearSessionScrollPositions() {
  for (const pendingWrite of pendingStorageWrites.values()) {
    globalThis.clearTimeout(pendingWrite);
  }
  pendingStorageWrites.clear();
  dirtySurfaces.clear();
  cachedPositions.clear();

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
