import { notifyUnauthorized, type AnimationManifest } from "../../api/client";

export interface DecodedAnimationAtlas {
  image: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

type AtlasDescriptor = AnimationManifest["atlases"][number];
type AtlasLoader = (
  atlas: AtlasDescriptor,
  signal: AbortSignal
) => Promise<DecodedAnimationAtlas>;
interface Consumer {
  signal: AbortSignal;
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
  private readonly jobs = new Map<string, AtlasJob>();
  private running = 0;

  constructor(
    private readonly load: AtlasLoader,
    private readonly maximumReady = 3,
    private readonly maximumRunning = 2
  ) {}

  use(
    atlas: AtlasDescriptor,
    signal: AbortSignal,
    draw: Consumer["draw"]
  ): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    const ready = this.ready.get(atlas.url);
    if (ready) {
      this.ready.delete(atlas.url);
      this.ready.set(atlas.url, ready);
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
    for (const atlas of this.ready.values()) atlas.dispose();
    this.ready.clear();
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
    for (const job of this.jobs.values()) {
      if (this.running >= this.maximumRunning) return;
      if (job.started || job.controller.signal.aborted) continue;
      job.started = true;
      this.running += 1;
      void this.prepare(job);
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
      while (this.ready.size > this.maximumReady) {
        const oldest = this.ready.keys().next().value;
        if (oldest === undefined) break;
        this.ready.get(oldest)?.dispose();
        this.ready.delete(oldest);
      }
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
    const blob = new Blob(chunks, { type: "image/png" });
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

export const animationAtlasCache = new AnimationAtlasCache(loadAtlas);
