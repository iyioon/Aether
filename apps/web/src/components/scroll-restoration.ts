export type ScrollSurface = "folder-tree" | "library-content" | "leaderboard";

export interface SessionScrollPosition {
  anchorId?: string;
  anchorOffset?: number;
  anchorSize?: number;
  contextKey: string;
  index?: number;
  loadedCount?: number;
  scrollTop: number;
}

export interface ScrollAnchorItem {
  end: number;
  index: number;
  start: number;
}

/** Appending another page does not move any previously visible asset. */
export function hasScrollOrderChanged(
  previousIds: readonly string[],
  nextIds: readonly string[]
): boolean {
  return (
    nextIds.length < previousIds.length ||
    previousIds.some((id, index) => nextIds[index] !== id)
  );
}

const STORAGE_PREFIX = "aether.scroll.v3";
const SESSION_STORAGE_PREFIX = "aether.scroll.v2";
const STORAGE_WRITE_DELAY_MS = 120;
const MAX_STORED_STRING_LENGTH = 16_384;
const MAX_SCROLL_DISTANCE = 100_000_000;
const SCROLL_SURFACES: ScrollSurface[] = [
  "folder-tree",
  "library-content",
  "leaderboard"
];
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

  const durablePosition = readStoredPosition(() =>
    window.localStorage.getItem(storageKey(surface))
  );
  const position =
    durablePosition ??
    readStoredPosition(() =>
      window.sessionStorage.getItem(sessionStorageKey(surface))
    );

  if (position) {
    cachedPositions.set(surface, position);
    if (!durablePosition) {
      // An existing installation's session checkpoint becomes durable on read.
      dirtySurfaces.add(surface);
      flushSessionScrollPositions(surface);
    }
    return { ...position };
  }

  return null;
}

export function writeSessionScrollPosition(
  surface: ScrollSurface,
  position: SessionScrollPosition
) {
  const normalizedPosition = normalizePosition(position);
  if (!normalizedPosition) {
    return;
  }
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

    const serialized = JSON.stringify(position);
    if (serialized.length > MAX_STORED_STRING_LENGTH) {
      continue;
    }
    for (const storePosition of [
      () => window.localStorage.setItem(storageKey(currentSurface), serialized),
      () =>
        window.sessionStorage.setItem(
          sessionStorageKey(currentSurface),
          serialized
        )
    ]) {
      try {
        storePosition();
      } catch {
        // Restricted storage must not block navigation or the other store.
      }
    }
  }
}

/** Capture while the DOM is still available, before iOS can suspend timers. */
export function checkpointScrollPositionOnPageLifecycle(
  surface: ScrollSurface,
  savePosition: () => void
): () => void {
  const checkpoint = () => {
    savePosition();
    flushSessionScrollPositions(surface);
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      checkpoint();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", checkpoint);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", checkpoint);
    flushSessionScrollPositions(surface);
  };
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

  for (const removePositions of [
    () => {
      for (const surface of SCROLL_SURFACES) {
        window.localStorage.removeItem(storageKey(surface));
      }
    },
    () => {
      for (const surface of SCROLL_SURFACES) {
        window.sessionStorage.removeItem(sessionStorageKey(surface));
      }
      for (const key of LEGACY_STORAGE_KEYS) {
        window.sessionStorage.removeItem(key);
      }
    }
  ]) {
    try {
      removePositions();
    } catch {
      // Ignore unavailable storage during explicit logout or data reset.
    }
  }
}

function storageKey(surface: ScrollSurface): string {
  return `${STORAGE_PREFIX}.${surface}`;
}

function sessionStorageKey(surface: ScrollSurface): string {
  return `${SESSION_STORAGE_PREFIX}.${surface}`;
}

function readStoredPosition(read: () => string | null) {
  try {
    const stored = read();
    if (!stored || stored.length > MAX_STORED_STRING_LENGTH) {
      return null;
    }
    return normalizePosition(JSON.parse(stored) as unknown);
  } catch {
    return null;
  }
}

function normalizePosition(value: unknown): SessionScrollPosition | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const position = value as Partial<SessionScrollPosition>;
  if (
    typeof position.contextKey !== "string" ||
    position.contextKey.length > MAX_STORED_STRING_LENGTH / 2 ||
    typeof position.scrollTop !== "number" ||
    !Number.isFinite(position.scrollTop)
  ) {
    return null;
  }

  const nonNegativeInteger = (number: unknown) =>
    typeof number === "number" && Number.isSafeInteger(number) && number >= 0
      ? number
      : undefined;
  const finiteDistance = (number: unknown) =>
    typeof number === "number" &&
    Number.isFinite(number) &&
    Math.abs(number) <= MAX_SCROLL_DISTANCE
      ? number
      : undefined;

  return {
    anchorId:
      typeof position.anchorId === "string" && position.anchorId.length <= 512
        ? position.anchorId
        : undefined,
    anchorOffset: finiteDistance(position.anchorOffset),
    anchorSize:
      typeof position.anchorSize === "number" && position.anchorSize > 0
        ? finiteDistance(position.anchorSize)
        : undefined,
    contextKey: position.contextKey,
    index: nonNegativeInteger(position.index),
    loadedCount: nonNegativeInteger(position.loadedCount),
    scrollTop: Math.min(
      MAX_SCROLL_DISTANCE,
      Math.max(0, Math.round(position.scrollTop))
    )
  };
}
