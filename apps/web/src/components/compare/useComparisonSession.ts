import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getNextComparisonPair,
  recordComparison,
  undoComparison,
  type AssetRecord,
  type ComparisonPairResponse,
  type MediaTypeFilter,
  type ScoreFilter
} from "../../api/client";
import { preloadMediaImage } from "../media/media-image-cache";
import { thumbnailUrl } from "../media/media-urls";

const PAIR_POSTER_PRELOAD_BUDGET_MS = 1_200;

interface UseComparisonSessionOptions {
  assetUpdate: AssetRecord | null;
  folderId: string | null;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onRankingChanged: () => void;
}

interface PreviousDecision {
  eventId: string;
  pair: ComparisonPairResponse;
}

export function useComparisonSession({
  assetUpdate,
  folderId,
  mediaType,
  scoreFilter,
  search,
  tagFilters,
  onAssetsUpdated,
  onRankingChanged
}: UseComparisonSessionOptions) {
  const [pair, setPair] = useState<ComparisonPairResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPairCommitted, setIsPairCommitted] = useState(false);
  const [chosenAssetId, setChosenAssetId] = useState<string | null>(null);
  const [previousDecision, setPreviousDecision] =
    useState<PreviousDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const pairRequestAbortRef = useRef<AbortController | null>(null);
  const pairCommittedRef = useRef(false);
  const submissionInFlightRef = useRef(false);
  const isMountedRef = useRef(false);
  const queryKey = [
    folderId ?? "",
    mediaType,
    scoreFilter,
    search,
    ...tagFilters
  ].join("\u0000");
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!assetUpdate) {
      return;
    }

    setPair((currentPair) => replacePairAsset(currentPair, assetUpdate));
  }, [assetUpdate]);

  const presentPair = useCallback(
    async (
      nextPair: ComparisonPairResponse | null,
      requestSequence: number,
      controller: AbortController
    ) => {
      if (nextPair) {
        await waitForPosterPreloads(
          [thumbnailUrl(nextPair.left.id), thumbnailUrl(nextPair.right.id)],
          controller.signal
        );
      }

      if (
        controller.signal.aborted ||
        requestSequenceRef.current !== requestSequence
      ) {
        return;
      }

      setPair(nextPair);
      pairCommittedRef.current = false;
      setIsPairCommitted(false);
    },
    []
  );

  const presentReturnedPair = useCallback(
    async (nextPair: ComparisonPairResponse | null) => {
      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;
      pairRequestAbortRef.current?.abort();
      const controller = new AbortController();
      pairRequestAbortRef.current = controller;
      setIsLoading(true);
      setError(null);

      try {
        await presentPair(nextPair, requestSequence, controller);
      } catch (caught) {
        if (
          !controller.signal.aborted &&
          requestSequenceRef.current === requestSequence
        ) {
          setError(
            caught instanceof Error
              ? caught.message
              : "comparison_next_pair_unavailable"
          );
        }
      } finally {
        if (
          pairRequestAbortRef.current === controller &&
          requestSequenceRef.current === requestSequence
        ) {
          pairRequestAbortRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [presentPair]
  );

  const loadPair = useCallback(
    async (excludeAssetIds: string[] = []) => {
      if (!folderId) {
        requestSequenceRef.current += 1;
        pairRequestAbortRef.current?.abort();
        pairRequestAbortRef.current = null;
        setPair(null);
        pairCommittedRef.current = false;
        setIsPairCommitted(false);
        setIsLoading(false);
        return;
      }

      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;
      pairRequestAbortRef.current?.abort();
      const controller = new AbortController();
      pairRequestAbortRef.current = controller;
      setIsLoading(true);
      setError(null);

      try {
        const nextPair = await getNextComparisonPair({
          folderId,
          type: mediaType,
          recursive: true,
          search,
          tags: tagFilters,
          score: scoreFilter,
          excludeAssetIds,
          signal: controller.signal
        });

        if (
          controller.signal.aborted ||
          requestSequenceRef.current !== requestSequence
        ) {
          return;
        }

        await presentPair(nextPair, requestSequence, controller);
      } catch (caught) {
        if (
          controller.signal.aborted ||
          requestSequenceRef.current !== requestSequence
        ) {
          return;
        }

        if (
          caught instanceof ApiError &&
          caught.code === "comparison_pair_unavailable"
        ) {
          setPair(null);
          pairCommittedRef.current = false;
          setIsPairCommitted(false);
        } else {
          setError(
            caught instanceof ApiError
              ? caught.code
              : caught instanceof Error
                ? caught.message
                : "Unable to load a comparison."
          );
        }
      } finally {
        if (
          pairRequestAbortRef.current === controller &&
          requestSequenceRef.current === requestSequence
        ) {
          pairRequestAbortRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [folderId, mediaType, presentPair, scoreFilter, search, tagFilters]
  );

  useEffect(() => {
    setPair(null);
    setPreviousDecision(null);
    pairCommittedRef.current = false;
    setIsPairCommitted(false);
    void loadPair();

    return () => {
      requestSequenceRef.current += 1;
      pairRequestAbortRef.current?.abort();
      pairRequestAbortRef.current = null;
    };
  }, [loadPair]);

  const chooseAsset = useCallback(
    async (winnerAssetId: string) => {
      if (
        !pair ||
        !folderId ||
        submissionInFlightRef.current ||
        pairRequestAbortRef.current !== null ||
        pairCommittedRef.current
      ) {
        return;
      }

      submissionInFlightRef.current = true;
      const decidedPair = pair;
      const decisionQueryKey = queryKeyRef.current;
      setChosenAssetId(winnerAssetId);
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await recordComparison({
          leftAssetId: decidedPair.left.id,
          rightAssetId: decidedPair.right.id,
          winnerAssetId,
          pairContext: {
            folderId,
            type: mediaType,
            recursive: true,
            search,
            tags: tagFilters,
            score: scoreFilter
          }
        });
        onAssetsUpdated(response.assets);
        onRankingChanged();
        if (isMountedRef.current && queryKeyRef.current === decisionQueryKey) {
          pairCommittedRef.current = true;
          setIsPairCommitted(true);
          setPreviousDecision({ eventId: response.eventId, pair: decidedPair });
          setChosenAssetId(null);
          setIsSubmitting(false);
          submissionInFlightRef.current = false;

          if ("nextPair" in response) {
            await presentReturnedPair(response.nextPair ?? null);
          } else {
            await loadPair([decidedPair.left.id, decidedPair.right.id]);
          }
        }
      } catch (caught) {
        if (isMountedRef.current && queryKeyRef.current === decisionQueryKey) {
          setError(
            caught instanceof ApiError
              ? caught.code
              : "Your choice could not be saved."
          );
        }
      } finally {
        submissionInFlightRef.current = false;
        if (isMountedRef.current) {
          setChosenAssetId(null);
          setIsSubmitting(false);
        }
      }
    },
    [
      folderId,
      loadPair,
      mediaType,
      onAssetsUpdated,
      onRankingChanged,
      pair,
      presentReturnedPair,
      scoreFilter,
      search,
      tagFilters
    ]
  );

  const skipPair = useCallback(() => {
    if (
      !pair ||
      submissionInFlightRef.current ||
      pairRequestAbortRef.current !== null ||
      pairCommittedRef.current
    ) {
      return;
    }

    void loadPair([pair.left.id, pair.right.id]);
  }, [loadPair, pair]);

  const undoLastDecision = useCallback(async () => {
    if (!previousDecision || submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    requestSequenceRef.current += 1;
    pairRequestAbortRef.current?.abort();
    pairRequestAbortRef.current = null;
    const undoQueryKey = queryKeyRef.current;
    setIsLoading(false);
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await undoComparison(previousDecision.eventId);
      onAssetsUpdated(response.assets);
      onRankingChanged();
      const assetById = new Map(
        response.assets.map((asset) => [asset.id, asset])
      );
      const left = assetById.get(previousDecision.pair.left.id);
      const right = assetById.get(previousDecision.pair.right.id);

      if (
        left &&
        right &&
        isMountedRef.current &&
        queryKeyRef.current === undoQueryKey
      ) {
        setPair({
          left,
          right,
          progress: previousDecision.pair.progress
        });
        pairCommittedRef.current = false;
        setIsPairCommitted(false);
      }
      if (isMountedRef.current && queryKeyRef.current === undoQueryKey) {
        setPreviousDecision(null);
      }
    } catch (caught) {
      if (isMountedRef.current && queryKeyRef.current === undoQueryKey) {
        setError(
          caught instanceof ApiError
            ? caught.code
            : "The last choice could not be restored."
        );
      }
    } finally {
      submissionInFlightRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [onAssetsUpdated, onRankingChanged, previousDecision]);

  return {
    chosenAssetId,
    error,
    isLoading,
    isPairCommitted,
    isSubmitting,
    pair,
    canUndo: previousDecision !== null,
    chooseAsset,
    retry: loadPair,
    skipPair,
    undoLastDecision
  };
}

async function waitForPosterPreloads(
  sources: string[],
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(finish, PAIR_POSTER_PRELOAD_BUDGET_MS);

    function finish() {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", finish);
      resolve();
    }

    signal.addEventListener("abort", finish, { once: true });
    void Promise.all(sources.map((source) => preloadMediaImage(source))).then(
      finish,
      finish
    );
  });
}

function replacePairAsset(
  pair: ComparisonPairResponse | null,
  updatedAsset: AssetRecord
): ComparisonPairResponse | null {
  if (!pair) {
    return null;
  }

  if (pair.left.id === updatedAsset.id) {
    return { ...pair, left: updatedAsset };
  }

  if (pair.right.id === updatedAsset.id) {
    return { ...pair, right: updatedAsset };
  }

  return pair;
}
