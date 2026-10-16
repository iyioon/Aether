import type {
  ComparisonPairContext,
  ComparisonPairResponse,
  ComparisonPrefetchResponse
} from "../../api/client";
import type { ComparisonMediaPreloader } from "./comparison-media-preloader";

const MAX_PAIRS = 3;

type PrefetchInput = ComparisonPairContext & {
  count: number;
  excludePairs: [string, string][];
  signal: AbortSignal;
};

interface QueueOptions {
  fetchPairs: (input: PrefetchInput) => Promise<ComparisonPrefetchResponse>;
  media: ComparisonMediaPreloader;
  onGenerationChange?: () => void;
}

export function createComparisonPrefetchQueue({
  fetchPairs,
  media,
  onGenerationChange
}: QueueOptions) {
  let pairs: ComparisonPairResponse[] = [];
  let contextKey: string | null = null;
  let comparisonGeneration: string | null = null;
  let currentPairKey: string | null = null;
  let request: AbortController | null = null;
  let revision = 0;
  let settledKey: string | null = null;
  let paused = false;
  let disposed = false;

  function cancelRequest() {
    revision += 1;
    request?.abort();
    request = null;
  }

  function clear() {
    if (disposed) {
      return;
    }
    cancelRequest();
    pairs = [];
    contextKey = null;
    comparisonGeneration = null;
    currentPairKey = null;
    settledKey = null;
    media.clear();
  }

  function stateKey() {
    return JSON.stringify([
      contextKey,
      comparisonGeneration,
      currentPairKey,
      pairs.map(pairKey)
    ]);
  }

  function refill(
    context: ComparisonPairContext,
    currentPair: ComparisonPairResponse
  ) {
    if (disposed || paused) {
      return;
    }
    const nextContextKey = JSON.stringify([
      context.folderId,
      context.type,
      context.recursive,
      context.search,
      [...new Set(context.tags)].sort(),
      context.score
    ]);
    if (
      contextKey !== nextContextKey ||
      comparisonGeneration !== currentPair.comparisonGeneration
    ) {
      clear();
      contextKey = nextContextKey;
      comparisonGeneration = currentPair.comparisonGeneration;
    }
    const nextCurrentPairKey = pairKey(currentPair);
    if (currentPairKey !== nextCurrentPairKey) {
      cancelRequest();
      currentPairKey = nextCurrentPairKey;
      settledKey = null;
    }
    pairs = pairs
      .filter(
        (pair) =>
          pair.comparisonGeneration === comparisonGeneration &&
          pairKey(pair) !== currentPairKey
      )
      .slice(0, MAX_PAIRS);
    media.update([...pairs]);
    if (request || pairs.length === MAX_PAIRS || settledKey === stateKey()) {
      return;
    }

    const controller = new AbortController();
    request = controller;
    const requestRevision = revision;
    const requestGeneration = comparisonGeneration;
    const input: PrefetchInput = {
      ...context,
      tags: [...context.tags],
      count: MAX_PAIRS - pairs.length,
      excludePairs: [pairIds(currentPair), ...pairs.map(pairIds)],
      signal: controller.signal
    };

    void (async () => {
      try {
        const result = await fetchPairs(input);
        if (
          disposed ||
          paused ||
          controller.signal.aborted ||
          requestRevision !== revision
        ) {
          return;
        }
        if (
          typeof result?.comparisonGeneration !== "string" ||
          result.comparisonGeneration.length === 0 ||
          !Array.isArray(result.pairs)
        ) {
          return;
        }
        if (result.comparisonGeneration !== requestGeneration) {
          clear();
          onGenerationChange?.();
          return;
        }
        const seen = new Set([currentPairKey, ...pairs.map(pairKey)]);
        for (const pair of result.pairs) {
          if (
            !isUsablePair(pair, requestGeneration) ||
            seen.has(pairKey(pair))
          ) {
            continue;
          }
          seen.add(pairKey(pair));
          pairs.push(pair);
          if (pairs.length === MAX_PAIRS) {
            break;
          }
        }
        media.update([...pairs]);
        settledKey = stateKey();
      } catch {
        // Preparing another pair must never interrupt a confirmed comparison.
      } finally {
        if (request === controller) {
          request = null;
        }
      }
    })();
  }

  return {
    refill,
    peek: () => (disposed || paused ? null : (pairs[0] ?? null)),
    cancelRequest,
    clear,
    pause() {
      if (disposed) {
        return;
      }
      clear();
      paused = true;
      media.pause();
    },
    resume() {
      if (disposed) {
        return;
      }
      paused = false;
      media.resume();
    },
    dispose() {
      if (disposed) {
        return;
      }
      clear();
      disposed = true;
      media.dispose();
    }
  };
}

function pairIds(pair: ComparisonPairResponse): [string, string] {
  return [pair.left.id, pair.right.id];
}

function pairKey(pair: ComparisonPairResponse): string {
  return JSON.stringify(pairIds(pair).sort());
}

function isUsablePair(
  pair: ComparisonPairResponse,
  generation: string | null
): boolean {
  return (
    pair?.comparisonGeneration === generation &&
    typeof pair.left?.id === "string" &&
    pair.left.id.length > 0 &&
    typeof pair.right?.id === "string" &&
    pair.right.id.length > 0 &&
    pair.left.id !== pair.right.id
  );
}
