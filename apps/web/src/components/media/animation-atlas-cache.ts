import { notifyUnauthorized, type AnimationManifest } from "../../api/client";
import { AnimationAtlasSourceCache } from "./animation-atlas-source-cache";

export interface DecodedAnimationAtlas {
  image: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

type AtlasDescriptor = AnimationManifest["atlases"][number];
type AtlasLoader = ((
  atlas: AtlasDescriptor,
  signal: AbortSignal
) => Promise<DecodedAnimationAtlas>) & { clear?: () => void };
interface Consumer {
  signal: AbortSignal;
  priority: number;
  draw: (atlas: DecodedAnimationAtlas) => void;
  resolve: () => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}
interface AtlasJob {
  descriptor: AtlasDescriptor;
  controller: AbortController;
  consumers: Set<Consumer>;
  started: boolean;
}

const abortError = () =>
  new DOMException("Animation loading cancelled.", "AbortError");

export class AnimationAtlasCache {
  private readonly ready = new Map<string, DecodedAnimationAtlas>();
  private readyBytes = 0;
  private readonly jobs = new Map<string, AtlasJob>();
  private readonly retained = new Map<
    AbortSignal,
    {
      current: string | null;
      upcoming: Map<string, number>;
      cleanup: () => void;
    }
  >();
  private running = 0;

  constructor(
    private readonly load: AtlasLoader,
    private readonly maximumReadyBytes = 48 * 1024 * 1024,
    private readonly maximumReady = 32,
    private readonly maximumRunning = 2
  ) {}

  use(
    atlas: AtlasDescriptor,
    signal: AbortSignal,
    draw: Consumer["draw"]
  ): Promise<void> {
    return this.request(atlas, signal, draw, false);
  }

  prefetch(
    atlas: AtlasDescriptor,
    signal: AbortSignal,
    priority = 0
  ): Promise<void> {
    return this.request(atlas, signal, () => undefined, true, priority);
  }

  private request(
    atlas: AtlasDescriptor,
    signal: AbortSignal,
    draw: Consumer["draw"],
    speculative: boolean,
    priority = -1
  ): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    let retained = this.retained.get(signal);
    if (!retained) {
      const release = () => {
        this.retained.delete(signal);
        signal.removeEventListener("abort", release);
      };
      retained = { current: null, upcoming: new Map(), cleanup: release };
      this.retained.set(signal, retained);
      signal.addEventListener("abort", release, { once: true });
    }
    if (speculative) retained.upcoming.set(atlas.url, priority);
    else retained.current = atlas.url;
    const ready = this.ready.get(atlas.url);
    if (ready) {
      if (!speculative) {
        this.ready.delete(atlas.url);
        this.ready.set(atlas.url, ready);
      }
      try {
        draw(ready);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error("Animation draw failed.")
        );
      }
    }
    let job = this.jobs.get(atlas.url);
    if (!job) {
      if (this.jobs.size >= 32)
        return Promise.reject(new Error("Animation preparation is busy."));
      job = {
        descriptor: atlas,
        controller: new AbortController(),
        consumers: new Set(),
        started: false
      };
      this.jobs.set(atlas.url, job);
    }
    const current = job;
    const promise = new Promise<void>((resolve, reject) => {
      const cancel = () => {
        current.consumers.delete(consumer);
        consumer.cleanup();
        reject(abortError());
        if (current.consumers.size === 0) {
          current.controller.abort();
          if (this.jobs.get(atlas.url) === current) this.jobs.delete(atlas.url);
        }
      };
      const consumer: Consumer = {
        signal,
        priority,
        draw,
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", cancel)
      };
      current.consumers.add(consumer);
      signal.addEventListener("abort", cancel, { once: true });
    });
    this.pump();
    return promise;
  }

  clear(): void {
    this.load.clear?.();
    for (const retained of this.retained.values()) retained.cleanup();
    for (const atlas of this.ready.values()) atlas.dispose();
    this.ready.clear();
    this.readyBytes = 0;
    for (const job of this.jobs.values()) {
      job.controller.abort();
      for (const consumer of job.consumers) {
        consumer.cleanup();
        consumer.reject(abortError());
      }
      job.consumers.clear();
    }
    this.jobs.clear();
  }

  private pump(): void {
    const jobs = [...this.jobs.values()].sort(
      (left, right) => this.priority(left) - this.priority(right)
    );
    for (const job of jobs) {
      if (this.running >= this.maximumRunning) return;
      if (job.started || job.controller.signal.aborted) continue;
      job.started = true;
      this.running += 1;
      void this.prepare(job);
    }
  }

  private priority(job: AtlasJob): number {
    return Math.min(...[...job.consumers].map((consumer) => consumer.priority));
  }

  private evict(): void {
    const priorities = new Map<string, number>();
    for (const { current, upcoming } of this.retained.values()) {
      if (current) priorities.set(current, -1);
      for (const [url, priority] of upcoming) {
        priorities.set(
          url,
          Math.min(priorities.get(url) ?? Infinity, priority)
        );
      }
    }
    while (
      this.ready.size > this.maximumReady ||
      this.readyBytes > this.maximumReadyBytes
    ) {
      let oldest: string | undefined;
      let leastPriority = -Infinity;
      for (const url of this.ready.keys()) {
        const priority = priorities.get(url) ?? Infinity;
        if (priority <= leastPriority) continue;
        leastPriority = priority;
        oldest = url;
      }
      if (oldest === undefined) break;
      const evicted = this.ready.get(oldest)!;
      this.readyBytes -= evicted.width * evicted.height * 4;
      evicted.dispose();
      this.ready.delete(oldest);
    }
  }

  private async prepare(job: AtlasJob): Promise<void> {
    try {
      const atlas = await this.load(job.descriptor, job.controller.signal);
      if (job.controller.signal.aborted || job.consumers.size === 0) {
        atlas.dispose();
        return;
      }
      this.ready.set(job.descriptor.url, atlas);
      this.readyBytes += atlas.width * atlas.height * 4;
      // Draw callbacks execute before another job can evict this atlas.
      for (const consumer of job.consumers) {
        consumer.cleanup();
        if (consumer.signal.aborted) {
          consumer.reject(abortError());
          continue;
        }
        try {
          consumer.draw(atlas);
          consumer.resolve();
        } catch (error) {
          consumer.reject(error);
        }
      }
      this.evict();
    } catch (error) {
      for (const consumer of job.consumers) {
        consumer.cleanup();
        consumer.reject(error);
      }
    } finally {
      job.consumers.clear();
      if (this.jobs.get(job.descriptor.url) === job)
        this.jobs.delete(job.descriptor.url);
      this.running -= 1;
      this.pump();
    }
  }
}

const ATLAS_BYTE_LIMIT = 20 * 1024 * 1024;
const encodedAtlases = new AnimationAtlasSourceCache();

async function loadAtlas(
  descriptor: AtlasDescriptor,
  signal: AbortSignal
): Promise<DecodedAnimationAtlas> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 45_000);
  try {
    let blob = encodedAtlases.get(descriptor.url);
    if (!blob) {
      const response = await fetch(descriptor.url, {
        credentials: "same-origin",
        signal: controller.signal,
        redirect: "error"
      });
      if (response.status === 401) notifyUnauthorized();
      if (
        !response.ok ||
        response.headers.get("content-type")?.split(";")[0] !== "image/png"
      )
        throw new Error("Could not load animation atlas.");
      if (
        Number(response.headers.get("content-length")) > ATLAS_BYTE_LIMIT ||
        !response.body
      )
        throw new Error("Animation atlas exceeds its limit.");
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > ATLAS_BYTE_LIMIT)
            throw new Error("Animation atlas exceeds its limit.");
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      blob = new Blob(chunks, { type: "image/png" });
    }
    const header = new DataView(await blob.slice(0, 24).arrayBuffer());
    if (
      header.byteLength < 24 ||
      header.getUint32(0) !== 0x89504e47 ||
      header.getUint32(4) !== 0x0d0a1a0a ||
      header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) !== descriptor.width ||
      header.getUint32(20) !== descriptor.height
    ) {
      throw new Error("Invalid animation atlas dimensions.");
    }
    if (controller.signal.aborted) throw abortError();
    encodedAtlases.set(descriptor.url, blob);
    const decoded = await decodeAtlas(blob, controller.signal);
    if (
      decoded.width !== descriptor.width ||
      decoded.height !== descriptor.height ||
      controller.signal.aborted
    ) {
      decoded.dispose();
      throw new Error("Animation atlas dimensions changed.");
    }
    return decoded;
  } catch (error) {
    if (!controller.signal.aborted) encodedAtlases.delete(descriptor.url);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}

async function decodeAtlas(
  blob: Blob,
  signal: AbortSignal
): Promise<DecodedAnimationAtlas> {
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(blob);
    if (signal.aborted) {
      image.close();
      throw abortError();
    }
    return {
      image,
      width: image.width,
      height: image.height,
      dispose: () => image.close()
    };
  }
  const image = new Image();
  const url = URL.createObjectURL(blob);
  const dispose = () => {
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
  };
  const cancel = () => dispose();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    image.src = url;
    await image.decode();
    if (signal.aborted) throw abortError();
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export const animationAtlasCache = new AnimationAtlasCache(
  Object.assign(loadAtlas, { clear: () => encodedAtlases.clear() })
);
