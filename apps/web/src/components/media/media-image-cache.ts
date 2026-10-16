const MAX_READY_IMAGE_SOURCES = 768;
const DEFAULT_PRELOAD_TIMEOUT_MS = 2_500;

const readyImageSources = new Map<string, true>();
const sharedImagePreloads = new Map<string, SharedImagePreload>();

interface SharedImagePreload {
  image: HTMLImageElement;
  consumers: Set<symbol>;
  promise: Promise<boolean>;
  settled: boolean;
  finish: (ready: boolean) => void;
}

export interface MediaImagePreload {
  promise: Promise<boolean>;
  release: () => void;
}

export function isMediaImageReady(source: string): boolean {
  return readyImageSources.has(source);
}

export function markMediaImageReady(source: string): void {
  readyImageSources.delete(source);
  readyImageSources.set(source, true);

  if (readyImageSources.size <= MAX_READY_IMAGE_SOURCES) {
    return;
  }

  const oldestSource = readyImageSources.keys().next().value;

  if (typeof oldestSource === "string") {
    readyImageSources.delete(oldestSource);
  }
}

export function acquireMediaImagePreload(
  source: string,
  {
    signal,
    timeoutMs = DEFAULT_PRELOAD_TIMEOUT_MS
  }: { signal?: AbortSignal; timeoutMs?: number } = {}
): MediaImagePreload {
  if (signal?.aborted || typeof window === "undefined") {
    return { promise: Promise.resolve(false), release: () => undefined };
  }

  const entry =
    sharedImagePreloads.get(source) ??
    createSharedImagePreload(source, timeoutMs);
  const consumer = Symbol(source);
  entry.consumers.add(consumer);
  let released = false;
  let resolveReleased: (ready: boolean) => void = () => undefined;
  const releasedPromise = new Promise<boolean>((resolve) => {
    resolveReleased = resolve;
  });

  function release() {
    if (released) {
      return;
    }

    released = true;
    signal?.removeEventListener("abort", release);
    entry.consumers.delete(consumer);
    resolveReleased(false);

    if (entry.consumers.size === 0) {
      if (sharedImagePreloads.get(source) === entry) {
        sharedImagePreloads.delete(source);
      }
      entry.finish(false);
      entry.image.removeAttribute("src");
    }
  }

  signal?.addEventListener("abort", release, { once: true });
  return {
    promise: Promise.race([entry.promise, releasedPromise]),
    release
  };
}

function createSharedImagePreload(
  source: string,
  timeoutMs: number
): SharedImagePreload {
  const image = new window.Image();
  readyImageSources.delete(source);
  let resolveReady: (ready: boolean) => void = () => undefined;
  let decodeStarted = false;
  const entry: SharedImagePreload = {
    image,
    consumers: new Set(),
    promise: new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    }),
    settled: false,
    finish
  };
  sharedImagePreloads.set(source, entry);

  function finish(ready: boolean) {
    if (entry.settled) {
      return;
    }

    entry.settled = true;
    window.clearTimeout(timeoutId);
    image.onload = null;
    image.onerror = null;

    if (!ready && sharedImagePreloads.get(source) === entry) {
      sharedImagePreloads.delete(source);
    }
    if (ready) {
      markMediaImageReady(source);
    } else {
      image.removeAttribute("src");
    }
    resolveReady(ready);
  }

  function decodeAndFinish() {
    if (decodeStarted || entry.settled) {
      return;
    }

    decodeStarted = true;
    if (typeof image.decode !== "function") {
      finish(true);
      return;
    }
    void image.decode().then(
      () => finish(true),
      () => finish(false)
    );
  }

  const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
  image.onload = decodeAndFinish;
  image.onerror = () => finish(false);
  image.decoding = "async";
  image.fetchPriority = "low";
  image.src = source;

  if (image.complete && image.naturalWidth > 0) {
    decodeAndFinish();
  }
  return entry;
}
