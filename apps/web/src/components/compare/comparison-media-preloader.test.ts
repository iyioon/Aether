import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, ComparisonPairResponse } from "../../api/client";
import {
  createComparisonMediaPreloader,
  type ComparisonMediaPreloader
} from "./comparison-media-preloader";

class MockImage {
  static instances: MockImage[] = [];
  complete = false;
  naturalWidth = 0;
  decoding = "auto";
  fetchPriority = "auto";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  requestedSource = "";
  source = "";
  decode = vi.fn(() => Promise.resolve());

  constructor() {
    MockImage.instances.push(this);
  }

  set src(value: string) {
    this.source = value;
    this.requestedSource = value;
  }

  get src(): string {
    return this.source;
  }

  removeAttribute(name: string) {
    if (name === "src") {
      this.source = "";
    }
  }
}

class MockDocument extends EventTarget {
  visibilityState = "visible";
}

class MockConnection extends EventTarget {
  saveData = false;
  effectiveType = "4g";
  downlink = 10;
}

let testNumber = 0;
let browserWindow: EventTarget;
let browserDocument: MockDocument;
let connection: MockConnection;
let network: { onLine: boolean; connection: MockConnection };
let loaders: ComparisonMediaPreloader[];

function createPreloader() {
  const loader = createComparisonMediaPreloader();
  loaders.push(loader);
  return loader;
}

function asset(
  id: string,
  mediaType: "image" | "video" = "image",
  extension = ".jpg"
): AssetRecord {
  return {
    id: `${testNumber}-${id}`,
    folderId: "folder",
    name: `${id}${extension}`,
    extension,
    mediaType,
    mimeType: mediaType === "video" ? "video/mp4" : "image/jpeg",
    sizeBytes: 1_000_000,
    mtimeMs: 0,
    width: 1920,
    height: 1080,
    durationMs: mediaType === "video" ? 60_000 : null,
    codec: null,
    status: "ready",
    error: null,
    score: 0,
    ranking: null,
    favorite: false,
    tags: []
  };
}

function pair(left: AssetRecord, right: AssetRecord): ComparisonPairResponse {
  return {
    comparisonGeneration: "generation",
    left,
    right,
    progress: { candidateCount: 20, comparedCount: 0, decidedPairCount: 0 }
  };
}

async function flush() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

async function loadImages() {
  for (let i = 0; i < 8; i += 1) {
    for (const image of MockImage.instances) {
      image.onload?.();
    }
    await flush();
  }
}

function streamResponse({
  status = 206,
  range = "bytes 0-3/1000000",
  chunks = [new Uint8Array(4)]
}: { status?: number; range?: string | null; chunks?: Uint8Array[] } = {}) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
    cancel
  });
  return {
    response: new Response(body, {
      status,
      headers:
        range === null
          ? { "content-type": "video/mp4" }
          : { "content-range": range, "content-type": "video/mp4" }
    }),
    cancel
  };
}

describe("comparison media preloader", () => {
  beforeEach(() => {
    testNumber += 1;
    vi.useFakeTimers();
    MockImage.instances = [];
    loaders = [];
    browserWindow = Object.assign(new EventTarget(), {
      Image: MockImage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    browserDocument = new MockDocument();
    connection = new MockConnection();
    network = { onLine: true, connection };
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("navigator", network);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse().response)
    );
  });

  afterEach(async () => {
    for (const loader of loaders) {
      loader.dispose();
    }
    await flush();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads only the rendered still-image sources with a three-pair and two-load limit", async () => {
    const loader = createPreloader();
    const pairs = Array.from({ length: 4 }, (_, index) =>
      pair(asset(`${index}-left`), asset(`${index}-right`))
    );
    loader.update(pairs);

    expect(MockImage.instances).toHaveLength(2);
    await loadImages();
    expect(MockImage.instances).toHaveLength(6);
    expect(
      MockImage.instances.every((image) =>
        /\/thumbnail\?size=640$/.test(image.requestedSource)
      )
    ).toBe(true);
    expect(
      MockImage.instances.some((image) =>
        image.requestedSource.includes("3-left")
      )
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await loader.waitForPair(pairs[0]!);
  });

  it("deduplicates prepared thumbnails across pairs without loading native animated originals", async () => {
    const loader = createPreloader();
    const left = asset("animated", "image", ".GIF");
    const right = asset("still");
    loader.update([
      pair(left, right),
      pair(right, left),
      pair(left, asset("webp", "image", ".webp"))
    ]);
    await loadImages();

    const sources = MockImage.instances.map((image) => image.requestedSource);
    expect(sources).toHaveLength(3);
    expect(new Set(sources).size).toBe(3);
    expect(
      sources.every((source) => source.endsWith("/thumbnail?size=640"))
    ).toBe(true);
    loader.update([pair(left, right)]);
    await loadImages();
    expect(MockImage.instances).toHaveLength(3);
  });

  it("decodes video posters and requests a bounded authenticated original-video range", async () => {
    const loader = createPreloader();
    const video = asset("video", "video", ".mp4");
    const current = pair(video, asset("still"));
    loader.update([current]);
    await loadImages();

    expect(fetch).toHaveBeenCalledOnce();
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toBe(`/api/assets/${video.id}/media`);
    expect(call?.[1]).toMatchObject({
      credentials: "same-origin",
      headers: { Range: "bytes=0-524287" },
      priority: "low",
      redirect: "error"
    });
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    await loader.waitForPair(current);
  });

  it.each([
    [
      "data saver",
      () => {
        connection.saveData = true;
      }
    ],
    [
      "2g",
      () => {
        connection.effectiveType = "2g";
      }
    ],
    [
      "slow 2g",
      () => {
        connection.effectiveType = "slow-2g";
      }
    ],
    [
      "low bandwidth",
      () => {
        connection.downlink = 0.5;
      }
    ]
  ])(
    "reduces %s connections to one pair, one load, and no speculative video data",
    async (_label, constrain) => {
      constrain();
      const loader = createPreloader();
      const first = pair(asset("video", "video", ".mp4"), asset("still"));
      loader.update([first, pair(asset("third"), asset("fourth"))]);
      expect(MockImage.instances).toHaveLength(1);
      await loadImages();

      expect(MockImage.instances).toHaveLength(2);
      expect(fetch).not.toHaveBeenCalled();
      await loader.waitForPair(first);
    }
  );

  it("prepares only thumbnails for animated images on a constrained connection", async () => {
    connection.saveData = true;
    const loader = createPreloader();
    const current = pair(
      asset("gif", "image", ".gif"),
      asset("webp", "image", ".webp")
    );
    loader.update([current]);
    await loadImages();

    expect(MockImage.instances).toHaveLength(2);
    expect(
      MockImage.instances.every((image) =>
        image.requestedSource.endsWith("/thumbnail?size=640")
      )
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    await loader.waitForPair(current);
  });

  it.each([".gif", ".webp", ".apng", ".png", ".avif"])(
    "settles %s pair preparation after thumbnails decode without waiting for unused originals",
    async (extension) => {
      const loader = createPreloader();
      const current = pair(
        asset("animation", "image", extension),
        asset("still")
      );
      loader.update([current]);
      await loadImages();
      const settled = vi.fn();
      void loader.waitForPair(current).then(settled);
      await flush();

      expect(settled).toHaveBeenCalledOnce();
      expect(MockImage.instances).toHaveLength(2);
      expect(
        MockImage.instances.every((image) =>
          image.requestedSource.endsWith("/thumbnail?size=640")
        )
      ).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("releases removed images and never starts queued stale sources", async () => {
    const loader = createPreloader();
    loader.update([
      pair(asset("old-left"), asset("old-right")),
      pair(asset("old-third"), asset("old-fourth"))
    ]);
    const stale = [...MockImage.instances];
    loader.update([pair(asset("new-left"), asset("new-right"))]);
    expect(stale.every((image) => image.src === "")).toBe(true);
    await loadImages();

    expect(MockImage.instances).toHaveLength(4);
    expect(
      MockImage.instances.some((image) =>
        image.requestedSource.includes("old-third")
      )
    ).toBe(false);
    expect(
      MockImage.instances.some((image) =>
        image.requestedSource.includes("new-left")
      )
    ).toBe(true);
  });

  it("pauses and cancels work when hidden, and resumes only the retained queue", async () => {
    const loader = createPreloader();
    const first = pair(asset("left"), asset("right"));
    loader.update([first, pair(asset("third"), asset("fourth"))]);
    const waiting = loader.waitForPair(first);
    browserDocument.visibilityState = "hidden";
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    await waiting;
    await flush();

    expect(MockImage.instances).toHaveLength(2);
    expect(MockImage.instances.every((image) => image.src === "")).toBe(true);
    browserDocument.visibilityState = "visible";
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    await loadImages();
    expect(MockImage.instances).toHaveLength(6);
  });

  it("does not restart after clear, dispose, or a pagehide until a pageshow", async () => {
    const loader = createPreloader();
    loader.update([pair(asset("old-left"), asset("old-right"))]);
    browserWindow.dispatchEvent(new Event("pagehide"));
    await flush();
    expect(MockImage.instances).toHaveLength(2);
    loader.clear();
    browserWindow.dispatchEvent(new Event("pageshow"));
    await flush();
    expect(MockImage.instances).toHaveLength(2);

    loader.update([pair(asset("new-left"), asset("new-right"))]);
    expect(MockImage.instances).toHaveLength(4);
    loader.dispose();
    loader.resume();
    loader.update([pair(asset("ignored-left"), asset("ignored-right"))]);
    browserWindow.dispatchEvent(new Event("pageshow"));
    await flush();
    expect(MockImage.instances).toHaveLength(4);
  });

  it("retries cancelled work when pause and resume happen before the abort settles", async () => {
    const loader = createPreloader();
    const current = pair(asset("left"), asset("right"));
    loader.update([current]);
    loader.pause();
    loader.resume();
    await loadImages();

    expect(MockImage.instances).toHaveLength(4);
    expect(
      MockImage.instances.slice(0, 2).every((image) => image.src === "")
    ).toBe(true);
    expect(
      MockImage.instances
        .slice(2)
        .every((image) => image.decode.mock.calls.length === 1)
    ).toBe(true);
    await loader.waitForPair(current);
  });

  it("prioritizes an authoritative pair outside the queue without exceeding the queue limit", async () => {
    const loader = createPreloader();
    const upcoming = Array.from({ length: 3 }, (_, index) =>
      pair(asset(`queued-${index}-left`), asset(`queued-${index}-right`))
    );
    loader.update(upcoming);
    const current = pair(
      asset("authoritative-left"),
      asset("authoritative-right")
    );
    const waiting = loader.waitForPair(current);
    await loadImages();
    await waiting;

    expect(MockImage.instances).toHaveLength(8);
    expect(
      new Set(MockImage.instances.map((image) => image.requestedSource)).size
    ).toBe(6);
    expect(MockImage.instances[2]?.requestedSource).toContain(
      "authoritative-left"
    );
    expect(
      MockImage.instances.some((image) =>
        image.requestedSource.includes("authoritative-left")
      )
    ).toBe(true);
    expect(
      MockImage.instances.some((image) =>
        image.requestedSource.includes("queued-2-left")
      )
    ).toBe(false);
  });

  it("settles failed or stalled loads, bounded waits, and cancelled waits without blocking ranking", async () => {
    const loader = createPreloader();
    const current = pair(asset("left"), asset("right"));
    loader.update([current]);
    const firstWait = loader.waitForPair(current);
    MockImage.instances[0]?.onerror?.();
    MockImage.instances[1]?.onerror?.();
    await firstWait;

    const stalled = pair(asset("stalled-left"), asset("stalled-right"));
    const wait = vi.fn();
    void loader.waitForPair(stalled).then(wait);
    await vi.advanceTimersByTimeAsync(1_199);
    expect(wait).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(wait).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const cancelled = loader.waitForPair(stalled, {
      signal: controller.signal
    });
    controller.abort();
    await cancelled;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(MockImage.instances.every((image) => image.onload === null)).toBe(
      true
    );
  });

  it("cancels rather than reading a full response when the server ignores Range", async () => {
    const invalid = streamResponse({ status: 200, range: null });
    vi.mocked(fetch).mockResolvedValueOnce(invalid.response);
    const loader = createPreloader();
    const current = pair(asset("video", "video", ".mp4"), asset("image"));
    loader.update([current]);
    await loadImages();
    await loader.waitForPair(current);

    expect(invalid.cancel).toHaveBeenCalledOnce();
  });

  it("rejects non-video error documents before reading their body", async () => {
    const invalid = streamResponse();
    invalid.response.headers.set("content-type", "application/json");
    vi.mocked(fetch).mockResolvedValueOnce(invalid.response);
    const loader = createPreloader();
    const current = pair(asset("video", "video", ".mp4"), asset("image"));
    loader.update([current]);
    await loadImages();
    await loader.waitForPair(current);

    expect(invalid.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", null],
    ["wrong start", "bytes 1-4/1000000"],
    ["oversized", "bytes 0-524288/1000000"],
    ["invalid total", "bytes 0-3/2"]
  ])(
    "rejects %s Content-Range before reading the body",
    async (_label, range) => {
      const invalid = streamResponse({ range });
      vi.mocked(fetch).mockResolvedValueOnce(invalid.response);
      const loader = createPreloader();
      const current = pair(asset("video", "video", ".mp4"), asset("image"));
      loader.update([current]);
      await loadImages();
      await loader.waitForPair(current);

      expect(invalid.cancel).toHaveBeenCalledOnce();
    }
  );

  it("cancels a video response that exceeds its advertised byte range", async () => {
    const invalid = streamResponse({
      chunks: [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)]
    });
    vi.mocked(fetch).mockResolvedValueOnce(invalid.response);
    const loader = createPreloader();
    const current = pair(asset("video", "video", ".mp4"), asset("image"));
    loader.update([current]);
    await loadImages();
    await loader.waitForPair(current);

    expect(invalid.response.body?.locked).toBe(false);
    expect(invalid.cancel).toHaveBeenCalledOnce();
  });

  it("aborts video reads on pause even when the transport does not settle", async () => {
    const readerCancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({ cancel: readerCancelled }),
      {
        status: 206,
        headers: {
          "content-range": "bytes 0-3/1000000",
          "content-type": "video/mp4"
        }
      }
    );
    vi.mocked(fetch).mockResolvedValueOnce(response);
    const loader = createPreloader();
    const current = pair(asset("video", "video", ".mp4"), asset("image"));
    loader.update([current]);
    await loadImages();
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    loader.pause();
    await loader.waitForPair(current);
    await flush();

    expect(signal?.aborted).toBe(true);
    expect(readerCancelled).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("times out a stalled video transport and releases its loading slot", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => undefined));
    const loader = createPreloader();
    const current = pair(asset("video", "video", ".mp4"), asset("image"));
    loader.update([current]);
    await loadImages();
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(4_000);

    expect(signal?.aborted).toBe(true);
    await loader.waitForPair(current);
    loader.update([pair(asset("new-left"), asset("new-right"))]);
    expect(MockImage.instances).toHaveLength(4);
  });

  it("discards a late response after clear and cancels its body", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    const loader = createPreloader();
    const current = pair(asset("video", "video", ".mp4"), asset("image"));
    loader.update([current]);
    await loadImages();
    const waiting = loader.waitForPair(current);
    loader.clear();
    await waiting;
    const late = streamResponse();
    resolveFetch(late.response);
    await flush();

    expect(late.cancel).toHaveBeenCalledOnce();
    expect(MockImage.instances).toHaveLength(2);
    loader.resume();
    await flush();
    expect(MockImage.instances).toHaveLength(2);
  });

  it("accepts a complete small range and settles truncated or failed video responses", async () => {
    const loader = createPreloader();
    const current = pair(asset("video", "video", ".mp4"), asset("image"));
    vi.mocked(fetch).mockResolvedValueOnce(
      streamResponse({ chunks: [new Uint8Array(2)] }).response
    );
    loader.update([current]);
    await loadImages();
    await loader.waitForPair(current);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("connection lost"));
    loader.resume();
    await flush();
    await loader.waitForPair(current);
    loader.resume();
    await flush();
    await loader.waitForPair(current);

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rechecks connection policy on change and waits for online before preloading", async () => {
    network.onLine = false;
    const loader = createPreloader();
    const pairs = [
      pair(asset("left"), asset("right")),
      pair(asset("third"), asset("fourth"))
    ];
    loader.update(pairs);
    expect(MockImage.instances).toHaveLength(0);
    network.onLine = true;
    browserWindow.dispatchEvent(new Event("online"));
    expect(MockImage.instances).toHaveLength(2);
    connection.saveData = true;
    connection.dispatchEvent(new Event("change"));
    await loadImages();

    expect(MockImage.instances).toHaveLength(2);
  });
});
