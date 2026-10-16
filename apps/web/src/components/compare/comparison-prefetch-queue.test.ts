import { describe, expect, it, vi } from "vitest";
import type {
  AssetRecord,
  ComparisonPairContext,
  ComparisonPairResponse,
  ComparisonPrefetchResponse
} from "../../api/client";
import { createComparisonPrefetchQueue } from "./comparison-prefetch-queue";
import type { ComparisonMediaPreloader } from "./comparison-media-preloader";

const context: ComparisonPairContext = {
  folderId: "folder",
  type: "all",
  recursive: true,
  search: "",
  tags: [],
  score: "all"
};
const current = pair("a", "b");

function pair(
  leftId: string,
  rightId: string,
  comparisonGeneration = "generation"
): ComparisonPairResponse {
  return {
    left: { id: leftId } as AssetRecord,
    right: { id: rightId } as AssetRecord,
    comparisonGeneration,
    progress: { candidateCount: 10, comparedCount: 0, decidedPairCount: 0 }
  };
}

function result(
  pairs: ComparisonPairResponse[],
  comparisonGeneration = "generation"
): ComparisonPrefetchResponse {
  return { pairs, comparisonGeneration };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const pending: ReturnType<typeof deferred<ComparisonPrefetchResponse>>[] = [];
  const fetchPairs = vi.fn<
    Parameters<typeof createComparisonPrefetchQueue>[0]["fetchPairs"]
  >(() => {
    const request = deferred<ComparisonPrefetchResponse>();
    pending.push(request);
    return request.promise;
  });
  const media: ComparisonMediaPreloader = {
    update: vi.fn(),
    waitForPair: vi.fn(async () => undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn()
  };
  const onGenerationChange = vi.fn();
  const queue = createComparisonPrefetchQueue({
    fetchPairs,
    media,
    onGenerationChange
  });
  return { queue, fetchPairs, media, pending, onGenerationChange };
}

async function flush() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe("comparison prefetch queue", () => {
  it("fills up to three pairs while excluding the current pair and preserving orientation", async () => {
    const { queue, fetchPairs, media, pending } = fixture();
    queue.refill(context, current);
    expect(fetchPairs).toHaveBeenCalledWith({
      ...context,
      count: 3,
      excludePairs: [["a", "b"]],
      signal: fetchPairs.mock.calls[0]![0].signal
    });
    expect(fetchPairs.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
    const prepared = [pair("d", "c"), pair("e", "f"), pair("g", "h")];
    pending[0]!.resolve(result(prepared));
    await flush();
    expect(queue.peek()).toBe(prepared[0]);
    expect(media.update).toHaveBeenLastCalledWith(prepared);
    queue.refill(context, current);
    expect(fetchPairs).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicates, reversed current pairs, malformed entries, mixed generations and oversized responses", async () => {
    const { queue, media, pending } = fixture();
    queue.refill(context, current);
    const prepared = [pair("c", "d"), pair("e", "f"), pair("g", "h")];
    pending[0]!.resolve(
      result([
        pair("b", "a"),
        pair("x", "x"),
        pair("", "x"),
        pair("i", "j", "old"),
        prepared[0]!,
        pair("d", "c"),
        prepared[1]!,
        prepared[2]!,
        pair("extra", "pair")
      ])
    );
    await flush();
    expect(queue.peek()).toBe(prepared[0]);
    expect(media.update).toHaveBeenLastCalledWith(prepared);
  });

  it("consumes a displayed pair canonically and requests only the remaining space", async () => {
    const { queue, fetchPairs, media, pending } = fixture();
    const prepared = [pair("c", "d"), pair("e", "f"), pair("g", "h")];
    queue.refill(context, current);
    pending[0]!.resolve(result(prepared));
    await flush();
    queue.refill(context, pair("d", "c"));
    expect(queue.peek()).toBe(prepared[1]);
    expect(media.update).toHaveBeenLastCalledWith(prepared.slice(1));
    expect(fetchPairs).toHaveBeenLastCalledWith({
      ...context,
      count: 1,
      excludePairs: [
        ["d", "c"],
        ["e", "f"],
        ["g", "h"]
      ],
      signal: fetchPairs.mock.calls[1]![0].signal
    });
    pending[1]!.resolve(result([pair("i", "j"), pair("k", "l")]));
    await flush();
    expect(media.update).toHaveBeenLastCalledWith([
      prepared[1],
      prepared[2],
      pair("i", "j")
    ]);
  });

  it("does not repeatedly refill exhausted pools and retries after the current pair changes", async () => {
    const { queue, fetchPairs, pending } = fixture();
    queue.refill(context, current);
    pending[0]!.resolve(result([]));
    await flush();
    for (let i = 0; i < 5; i += 1) queue.refill(context, current);
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    expect(queue.peek()).toBeNull();
    queue.refill(context, pair("c", "d"));
    expect(fetchPairs).toHaveBeenCalledTimes(2);
  });

  it("does not re-request an undersized completed batch until its state changes", async () => {
    const { queue, fetchPairs, pending } = fixture();
    queue.refill(context, current);
    pending[0]!.resolve(result([pair("c", "d")]));
    await flush();
    queue.refill(context, current);
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    queue.refill(context, pair("c", "d"));
    expect(fetchPairs).toHaveBeenCalledTimes(2);
    expect(fetchPairs).toHaveBeenLastCalledWith(
      expect.objectContaining({ count: 3, excludePairs: [["c", "d"]] })
    );
  });

  it("coalesces identical active refills without sharing mutable context tags", async () => {
    const { queue, fetchPairs } = fixture();
    const tagged = { ...context, tags: ["two", "one", "one"] };
    queue.refill(tagged, current);
    queue.refill({ ...context, tags: ["one", "two"] }, current);
    tagged.tags.push("three");
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    expect(fetchPairs.mock.calls[0]![0]).toMatchObject({
      tags: ["two", "one", "one"]
    });
  });

  it.each([
    { folderId: "another" },
    { type: "video" as const },
    { recursive: false },
    { search: "different" },
    { tags: ["new"] },
    { score: "unranked" as const }
  ])("discards a superseded context response for %j", async (change) => {
    const { queue, fetchPairs, pending, media } = fixture();
    queue.refill(context, current);
    const signal = fetchPairs.mock.calls[0]![0].signal;
    queue.refill({ ...context, ...change }, current);
    expect(signal.aborted).toBe(true);
    pending[1]!.resolve(result([pair("new-left", "new-right")]));
    await flush();
    pending[0]!.resolve(result([pair("old-left", "old-right")]));
    await flush();
    expect(queue.peek()?.left.id).toBe("new-left");
    expect(media.update).toHaveBeenLastCalledWith([
      pair("new-left", "new-right")
    ]);
  });

  it("ignores a stale response after the current pair changes while retaining warmed candidates", async () => {
    const { queue, fetchPairs, pending } = fixture();
    queue.refill(context, current);
    pending[0]!.resolve(result([pair("c", "d"), pair("e", "f")]));
    await flush();
    queue.refill(context, pair("c", "d"));
    const signal = fetchPairs.mock.calls[1]![0].signal;
    queue.refill(context, pair("e", "f"));
    expect(signal.aborted).toBe(true);
    pending[1]!.resolve(result([pair("stale", "pair")]));
    await flush();
    expect(queue.peek()).toBeNull();
    pending[2]!.resolve(result([pair("latest", "pair")]));
    await flush();
    expect(queue.peek()?.left.id).toBe("latest");
  });

  it("replaces cached generation state and rejects callbacks from its older request", async () => {
    const { queue, fetchPairs, pending, onGenerationChange } = fixture();
    queue.refill(context, current);
    queue.refill(context, pair("a", "b", "next-generation"));
    expect(fetchPairs.mock.calls[0]![0].signal.aborted).toBe(true);
    pending[0]!.resolve(result([pair("old", "pair")]));
    pending[1]!.resolve(
      result([pair("new", "pair", "next-generation")], "next-generation")
    );
    await flush();
    expect(queue.peek()?.left.id).toBe("new");
    expect(onGenerationChange).not.toHaveBeenCalled();
  });

  it("clears prepared state and requests validation when the server generation changes", async () => {
    const { queue, media, pending, onGenerationChange } = fixture();
    queue.refill(context, current);
    pending[0]!.resolve(result([pair("c", "d")]));
    await flush();
    queue.refill(context, pair("c", "d"));
    pending[1]!.resolve(result([pair("new", "pair", "reset")], "reset"));
    await flush();
    expect(queue.peek()).toBeNull();
    expect(media.clear).toHaveBeenCalled();
    expect(onGenerationChange).toHaveBeenCalledTimes(1);
  });

  it("makes an optional failed prefetch retryable without discarding warmed pairs", async () => {
    const { queue, fetchPairs, pending } = fixture();
    queue.refill(context, current);
    pending[0]!.resolve(result([pair("c", "d"), pair("e", "f")]));
    await flush();
    queue.refill(context, pair("c", "d"));
    pending[1]!.reject(new Error("offline"));
    await flush();
    expect(queue.peek()?.left.id).toBe("e");
    queue.refill(context, pair("c", "d"));
    expect(fetchPairs).toHaveBeenCalledTimes(3);
  });

  it("swallows synchronous transport failures and malformed response envelopes", async () => {
    const media: ComparisonMediaPreloader = {
      update: vi.fn(),
      waitForPair: vi.fn(async () => undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn()
    };
    const fetchPairs =
      vi.fn<
        Parameters<typeof createComparisonPrefetchQueue>[0]["fetchPairs"]
      >();
    fetchPairs.mockImplementationOnce(() => {
      throw new Error("unavailable");
    });
    fetchPairs.mockResolvedValueOnce({
      comparisonGeneration: "generation",
      pairs: null
    } as unknown as ComparisonPrefetchResponse);
    fetchPairs.mockResolvedValueOnce(result([pair("c", "d")]));
    const queue = createComparisonPrefetchQueue({ fetchPairs, media });
    expect(() => queue.refill(context, current)).not.toThrow();
    await flush();
    queue.refill(context, current);
    await flush();
    queue.refill(context, current);
    await flush();
    expect(queue.peek()?.left.id).toBe("c");
  });

  it("cancels metadata requests for a mutation while retaining its warmed queue", async () => {
    const { queue, fetchPairs, pending, media } = fixture();
    queue.refill(context, current);
    pending[0]!.resolve(result([pair("c", "d"), pair("e", "f")]));
    await flush();
    queue.refill(context, pair("c", "d"));
    const signal = fetchPairs.mock.calls[1]![0].signal;
    const clearCount = vi.mocked(media.clear).mock.calls.length;
    queue.cancelRequest();
    expect(signal.aborted).toBe(true);
    expect(queue.peek()?.left.id).toBe("e");
    expect(media.clear).toHaveBeenCalledTimes(clearCount);
    pending[1]!.resolve(result([pair("canceled", "pair")]));
    await flush();
    expect(queue.peek()?.left.id).toBe("e");
    queue.refill(context, pair("c", "d"));
    expect(fetchPairs).toHaveBeenCalledTimes(3);
  });

  it("clears all metadata and media state without accepting a late result", async () => {
    const { queue, fetchPairs, pending, media } = fixture();
    queue.refill(context, current);
    queue.clear();
    expect(fetchPairs.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(media.clear).toHaveBeenCalled();
    pending[0]!.resolve(result([pair("old", "pair")]));
    await flush();
    expect(queue.peek()).toBeNull();
    queue.refill(context, current);
    expect(fetchPairs).toHaveBeenCalledTimes(2);
  });

  it("pauses all work and resumes only after the caller supplies a validated current pair", async () => {
    const { queue, fetchPairs, pending, media } = fixture();
    queue.refill(context, current);
    queue.pause();
    expect(fetchPairs.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(media.pause).toHaveBeenCalledTimes(1);
    queue.refill(context, current);
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    pending[0]!.resolve(result([pair("old", "pair")]));
    await flush();
    queue.resume();
    expect(media.resume).toHaveBeenCalledTimes(1);
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    expect(queue.peek()).toBeNull();
    queue.refill(context, current);
    expect(fetchPairs).toHaveBeenCalledTimes(2);
  });

  it("cannot revive a disposed queue or accept its response", async () => {
    const { queue, fetchPairs, pending, media, onGenerationChange } = fixture();
    queue.refill(context, current);
    queue.dispose();
    queue.dispose();
    queue.resume();
    queue.pause();
    queue.clear();
    queue.refill(context, current);
    pending[0]!.resolve(result([pair("new", "pair", "reset")], "reset"));
    await flush();
    expect(queue.peek()).toBeNull();
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    expect(media.dispose).toHaveBeenCalledTimes(1);
    expect(media.resume).not.toHaveBeenCalled();
    expect(onGenerationChange).not.toHaveBeenCalled();
  });
});
