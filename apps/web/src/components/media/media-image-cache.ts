const MAX_READY_IMAGE_SOURCES = 768;
const DEFAULT_PRELOAD_TIMEOUT_MS = 2_500;

const readyImageSources = new Map<string, true>();
const pendingImagePreloads = new Map<string, Promise<void>>();

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

export function preloadMediaImage(
  source: string,
  timeoutMs = DEFAULT_PRELOAD_TIMEOUT_MS
): Promise<void> {
  if (isMediaImageReady(source) || typeof window === "undefined") {
    return Promise.resolve();
  }

  const pending = pendingImagePreloads.get(source);

  if (pending) {
    return pending;
  }

  const preload = new Promise<void>((resolve) => {
    const image = new window.Image();
    let decodeStarted = false;
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    function finish(ready: boolean) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;

      if (ready) {
        markMediaImageReady(source);
      }

      resolve();
    }

    function decodeAndFinish() {
      if (decodeStarted || settled) {
        return;
      }

      decodeStarted = true;
      void image.decode().then(
        () => finish(true),
        () => finish(false)
      );
    }

    image.onload = decodeAndFinish;
    image.onerror = () => finish(false);
    image.decoding = "async";
    image.src = source;

    if (image.complete && image.naturalWidth > 0) {
      decodeAndFinish();
    }
  }).finally(() => {
    pendingImagePreloads.delete(source);
  });

  pendingImagePreloads.set(source, preload);
  return preload;
}
