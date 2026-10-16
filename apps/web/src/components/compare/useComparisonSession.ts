import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getComparisonPrefetch,
  getNextComparisonPair,
  recordComparison,
  resumeComparison,
  undoComparison,
  type AssetRecord,
  type ComparisonPairResponse,
  type ComparisonPairContext,
  type MediaTypeFilter,
  type ScoreFilter
} from "../../api/client";
import { createComparisonMediaPreloader } from "./comparison-media-preloader";
import { createComparisonPrefetchQueue } from "./comparison-prefetch-queue";

import {
  completeRankingMutation,
  createRankingMutationId,
  rankingResumeGeneration,
  readRankingResumeState,
  subscribeToRankingResumeReset,
  writeRankingResumeState,
  type PendingRankingMutation,
  type RankingResumeState
} from "./ranking-resume-state";

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
  pairAssetIds: [string, string];
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
  const [previousDecision, setPreviousDecision] =
    useState<PreviousDecision | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPairCommitted, setIsPairCommitted] = useState(false);
  const [chosenAssetId, setChosenAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetRevision, setResetRevision] = useState(0);
  const queryKey = JSON.stringify([
    folderId,
    mediaType,
    scoreFilter,
    search,
    tagFilters
  ]);
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const isMountedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const pairRequestAbortRef = useRef<AbortController | null>(null);
  const submissionInFlightRef = useRef(false);
  const revalidationPendingRef = useRef(false);
  const checkpointRef = useRef<RankingResumeState | null>(null);
  const mediaPreloaderRef = useRef<ReturnType<
    typeof createComparisonMediaPreloader
  > | null>(null);
  const prefetchRef = useRef<ReturnType<
    typeof createComparisonPrefetchQueue
  > | null>(null);
  const callbacksRef = useRef({ onAssetsUpdated, onRankingChanged });
  callbacksRef.current = { onAssetsUpdated, onRankingChanged };
  const restoreRef = useRef<() => Promise<void>>(async () => undefined);
  const mutationRef = useRef<
    (pending: PendingRankingMutation) => Promise<void>
  >(async () => undefined);
  const context: ComparisonPairContext | null = folderId
    ? {
        folderId,
        type: mediaType,
        recursive: true,
        search,
        tags: tagFilters,
        score: scoreFilter
      }
    : null;
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    isMountedRef.current = true;
    const media = createComparisonMediaPreloader();
    const prefetch = createComparisonPrefetchQueue({
      fetchPairs: getComparisonPrefetch,
      media,
      onGenerationChange: () => {
        if (!isMountedRef.current) return;
        if (submissionInFlightRef.current)
          revalidationPendingRef.current = true;
        else void restoreRef.current();
      }
    });
    mediaPreloaderRef.current = media;
    prefetchRef.current = prefetch;
    return () => {
      isMountedRef.current = false;
      prefetch.dispose();
      if (prefetchRef.current === prefetch) prefetchRef.current = null;
      if (mediaPreloaderRef.current === media) mediaPreloaderRef.current = null;
    };
  }, []);

  useEffect(
    () =>
      subscribeToRankingResumeReset(() => {
        prefetchRef.current?.clear();
        setResetRevision((current) => current + 1);
      }),
    []
  );

  useEffect(() => {
    if (assetUpdate) {
      setPair((current) => replacePairAsset(current, assetUpdate));
      prefetchRef.current?.clear();
      if (submissionInFlightRef.current) revalidationPendingRef.current = true;
      else void restoreRef.current();
    }
  }, [assetUpdate]);

  const restoreSession = useCallback(async () => {
    const requestContext = contextRef.current;
    if (!requestContext || submissionInFlightRef.current) {
      return;
    }
    revalidationPendingRef.current = false;
    prefetchRef.current?.clear();
    const requestQueryKey = queryKeyRef.current;
    const generation = rankingResumeGeneration();
    let checkpoint = readRankingResumeState(requestQueryKey) ?? {
      contextKey: requestQueryKey,
      comparisonGeneration: null,
      pairAssetIds: null,
      previousDecision: null,
      pending: null
    };
    checkpointRef.current = checkpoint;
    writeRankingResumeState(checkpoint, generation);
    if (checkpoint.pending) {
      await mutationRef.current(checkpoint.pending);
      return;
    }

    pairRequestAbortRef.current?.abort();
    const controller = new AbortController();
    pairRequestAbortRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      isMountedRef.current &&
      requestSequenceRef.current === sequence &&
      queryKeyRef.current === requestQueryKey &&
      rankingResumeGeneration() === generation;
    setIsLoading(true);
    setError(null);
    try {
      const restored = await resumeComparison({
        ...requestContext,
        pairAssetIds: checkpoint.pairAssetIds,
        previousDecision: checkpoint.previousDecision,
        signal: controller.signal
      });
      if (!isCurrent()) return;
      let nextPair = restored.pair;
      if (!nextPair) {
        try {
          nextPair = await getNextComparisonPair({
            ...requestContext,
            score: requestContext.score,
            signal: controller.signal
          });
        } catch (caught) {
          if (!(
            caught instanceof ApiError &&
            caught.code === "comparison_pair_unavailable"
          )) {
            throw caught;
          }
        }
      }
      if (!isCurrent()) return;
      const comparisonGeneration =
        nextPair?.comparisonGeneration ?? restored.comparisonGeneration;
      const restoredDecision =
        comparisonGeneration === restored.comparisonGeneration
          ? restored.previousDecision
          : null;
      checkpoint = {
        ...checkpoint,
        comparisonGeneration,
        pairAssetIds: pairIds(nextPair),
        previousDecision: restoredDecision
          ? {
              eventId: restoredDecision.eventId,
              pairAssetIds: pairIds(restoredDecision.pair)!
            }
          : null
      };
      writeRankingResumeState(checkpoint, generation);
      checkpointRef.current = checkpoint;
      setPreviousDecision(checkpoint.previousDecision);
      if (nextPair) {
        await mediaPreloaderRef.current?.waitForPair(nextPair, {
          signal: controller.signal
        });
      }
      if (isCurrent()) {
        setPair(nextPair);
        setIsPairCommitted(false);
        if (nextPair) prefetchRef.current?.refill(requestContext, nextPair);
      }
    } catch (caught) {
      if (isCurrent()) {
        setError(
          caught instanceof ApiError
            ? caught.code
            : "comparison_resume_unavailable"
        );
      }
    } finally {
      if (pairRequestAbortRef.current === controller) {
        pairRequestAbortRef.current = null;
        if (isCurrent()) setIsLoading(false);
      }
    }
  }, []);
  restoreRef.current = restoreSession;

  const performMutation = useCallback(
    async (pending: PendingRankingMutation) => {
      const requestContext = contextRef.current;
      if (!requestContext || submissionInFlightRef.current) return;
      const requestQueryKey = queryKeyRef.current;
      const generation = rankingResumeGeneration();
      const checkpoint = readRankingResumeState(requestQueryKey);
      if (!checkpoint || checkpoint.pending?.mutationId !== pending.mutationId)
        return;
      submissionInFlightRef.current = true;
      prefetchRef.current?.cancelRequest();
      if (pending.kind === "undo") prefetchRef.current?.clear();
      pairRequestAbortRef.current?.abort();
      pairRequestAbortRef.current = null;
      ++requestSequenceRef.current;
      setIsLoading(false);
      setIsSubmitting(true);
      setIsPairCommitted(true);
      setChosenAssetId(
        pending.kind === "choice" ? pending.winnerAssetId : null
      );
      setError(null);
      const isCurrent = () =>
        isMountedRef.current &&
        queryKeyRef.current === requestQueryKey &&
        rankingResumeGeneration() === generation;
      try {
        const response =
          pending.kind === "choice"
            ? await recordComparison({
                leftAssetId: pending.pairAssetIds[0],
                rightAssetId: pending.pairAssetIds[1],
                winnerAssetId: pending.winnerAssetId,
                mutationId: pending.mutationId,
                comparisonGeneration:
                  checkpoint.comparisonGeneration ?? undefined,
                nextPairAssetIds: pending.nextPairAssetIds,
                pairContext: requestContext
              })
            : await undoComparison(
                pending.eventId,
                pending.mutationId,
                checkpoint.comparisonGeneration ?? undefined
              );
        const nextCheckpoint: RankingResumeState =
          pending.kind === "choice"
            ? {
                ...checkpoint,
                pending: null,
                previousDecision: {
                  eventId: response.eventId,
                  pairAssetIds: pending.pairAssetIds
                },
                pairAssetIds: pairIds(response.nextPair ?? null)
              }
            : {
                ...checkpoint,
                pending: null,
                previousDecision: null,
                pairAssetIds: pending.pairAssetIds
              };
        // Only the first completion of a shared pending operation advances it.
        // Late responses from a view that unmounted cannot overwrite a new session.
        if (
          !completeRankingMutation(
            nextCheckpoint,
            pending.mutationId,
            generation
          )
        ) {
          if (isCurrent()) {
            submissionInFlightRef.current = false;
            await restoreRef.current();
          }
          return;
        }
        checkpointRef.current = nextCheckpoint;
        callbacksRef.current.onAssetsUpdated(response.assets);
        callbacksRef.current.onRankingChanged();
        if (isCurrent()) {
          if (pending.kind === "choice" && response.nextPair !== undefined) {
            setPreviousDecision(nextCheckpoint.previousDecision);
            const nextPair = response.nextPair;
            const controller = new AbortController();
            pairRequestAbortRef.current = controller;
            try {
              if (nextPair)
                await mediaPreloaderRef.current?.waitForPair(nextPair, {
                  signal: controller.signal
                });
              if (isCurrent() && !controller.signal.aborted) {
                setPair(nextPair);
                setIsPairCommitted(false);
                if (nextPair)
                  prefetchRef.current?.refill(requestContext, nextPair);
                else prefetchRef.current?.clear();
              }
            } finally {
              if (pairRequestAbortRef.current === controller)
                pairRequestAbortRef.current = null;
            }
          } else {
            submissionInFlightRef.current = false;
            await restoreRef.current();
          }
        }
      } catch (caught) {
        if (isCurrent()) {
          if (
            caught instanceof ApiError &&
            [400, 404, 409].includes(caught.status)
          ) {
            const nextCheckpoint = {
              ...checkpoint,
              pending: null,
              pairAssetIds: null,
              previousDecision:
                pending.kind === "undo" ? null : checkpoint.previousDecision
            };
            completeRankingMutation(
              nextCheckpoint,
              pending.mutationId,
              generation
            );
            checkpointRef.current = nextCheckpoint;
            setPair(null);
            if (pending.kind === "undo") setPreviousDecision(null);
            setIsPairCommitted(false);
            setError(caught.code);
          } else {
            // Keep the original identifier and intent until its server outcome is known.
            setError("comparison_outcome_uncertain");
          }
        }
      } finally {
        submissionInFlightRef.current = false;
        if (isCurrent()) {
          setChosenAssetId(null);
          setIsSubmitting(false);
          if (
            revalidationPendingRef.current &&
            document.visibilityState === "visible" &&
            navigator.onLine !== false
          )
            void restoreRef.current();
        } else if (isMountedRef.current) {
          void restoreRef.current();
        }
      }
    },
    []
  );
  mutationRef.current = performMutation;

  const cancelPairRequest = useCallback(() => {
    ++requestSequenceRef.current;
    pairRequestAbortRef.current?.abort();
    pairRequestAbortRef.current = null;
  }, []);

  useEffect(() => {
    prefetchRef.current?.clear();
    setPair(null);
    setPreviousDecision(null);
    setIsPairCommitted(false);
    setIsSubmitting(false);
    setError(null);
    checkpointRef.current = null;
    if (folderId) void restoreSession();
    else setIsLoading(false);
    return cancelPairRequest;
  }, [cancelPairRequest, folderId, queryKey, resetRevision, restoreSession]);

  useEffect(() => {
    let timer: number | undefined;
    const pause = () => {
      window.clearTimeout(timer);
      if (submissionInFlightRef.current) revalidationPendingRef.current = true;
      prefetchRef.current?.pause();
      cancelPairRequest();
    };
    const scheduleRestore = () => {
      if (document.visibilityState !== "visible") {
        pause();
        return;
      }
      prefetchRef.current?.resume();
      prefetchRef.current?.clear();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (
          !submissionInFlightRef.current &&
          pairRequestAbortRef.current === null
        ) {
          void restoreRef.current();
        }
      }, 180);
    };
    document.addEventListener("visibilitychange", scheduleRestore);
    window.addEventListener("pageshow", scheduleRestore);
    window.addEventListener("online", scheduleRestore);
    window.addEventListener("offline", pause);
    window.addEventListener("pagehide", pause);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", scheduleRestore);
      window.removeEventListener("pageshow", scheduleRestore);
      window.removeEventListener("online", scheduleRestore);
      window.removeEventListener("offline", pause);
      window.removeEventListener("pagehide", pause);
    };
  }, [cancelPairRequest]);

  const chooseAsset = useCallback(
    async (winnerAssetId: string) => {
      const checkpoint = checkpointRef.current;
      if (
        !pair ||
        !checkpoint ||
        checkpoint.contextKey !== queryKeyRef.current ||
        checkpoint.pending ||
        isPairCommitted ||
        submissionInFlightRef.current ||
        pairRequestAbortRef.current !== null
      )
        return;
      const prepared = prefetchRef.current?.peek();
      const pending: PendingRankingMutation = {
        kind: "choice",
        mutationId: createRankingMutationId(),
        pairAssetIds: pairIds(pair)!,
        winnerAssetId,
        nextPairAssetIds: prepared ? pairIds(prepared)! : undefined
      };
      const next = { ...checkpoint, pending };
      checkpointRef.current = next;
      if (!writeRankingResumeState(next, rankingResumeGeneration())) {
        setError("ranking_resume_capacity");
        return;
      }
      await performMutation(pending);
    },
    [isPairCommitted, pair, performMutation]
  );

  const skipPair = useCallback(() => {
    const checkpoint = checkpointRef.current;
    const requestContext = contextRef.current;
    if (
      !pair ||
      !checkpoint ||
      checkpoint.contextKey !== queryKeyRef.current ||
      !requestContext ||
      checkpoint.pending ||
      isPairCommitted ||
      submissionInFlightRef.current ||
      pairRequestAbortRef.current !== null
    )
      return;
    prefetchRef.current?.cancelRequest();
    const prepared = prefetchRef.current?.peek();
    const controller = new AbortController();
    pairRequestAbortRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const generation = rankingResumeGeneration();
    const requestQueryKey = queryKeyRef.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      isMountedRef.current &&
      sequence === requestSequenceRef.current &&
      generation === rankingResumeGeneration() &&
      requestQueryKey === queryKeyRef.current;
    setIsLoading(true);
    setError(null);
    let validatedPreviousDecision = checkpoint.previousDecision;
    let validatedGeneration = checkpoint.comparisonGeneration;
    const loadPair = async () => {
      if (prepared) {
        const restored = await resumeComparison({
          ...requestContext,
          pairAssetIds: pairIds(prepared),
          previousDecision: checkpoint.previousDecision,
          signal: controller.signal
        });
        validatedGeneration = restored.comparisonGeneration;
        validatedPreviousDecision = restored.previousDecision
          ? {
              eventId: restored.previousDecision.eventId,
              pairAssetIds: pairIds(restored.previousDecision.pair)!
            }
          : null;
        if (restored.pair) return restored.pair;
      }
      return getNextComparisonPair({
        ...requestContext,
        excludeAssetIds: [pair.left.id, pair.right.id],
        signal: controller.signal
      });
    };
    void loadPair()
      .then(async (nextPair) => {
        if (!isCurrent()) return;
        const next = {
          ...checkpoint,
          comparisonGeneration: nextPair.comparisonGeneration,
          pairAssetIds: pairIds(nextPair),
          previousDecision:
            nextPair.comparisonGeneration === checkpoint.comparisonGeneration
              ? validatedPreviousDecision
              : null
        };
        writeRankingResumeState(next, generation);
        checkpointRef.current = next;
        setPreviousDecision(next.previousDecision);
        await mediaPreloaderRef.current?.waitForPair(nextPair, {
          signal: controller.signal
        });
        if (isCurrent()) {
          setPair(nextPair);
          prefetchRef.current?.refill(requestContext, nextPair);
        }
      })
      .catch((caught: unknown) => {
        if (isCurrent()) {
          if (
            caught instanceof ApiError &&
            caught.code === "comparison_pair_unavailable"
          ) {
            const next = {
              ...checkpoint,
              comparisonGeneration: validatedGeneration,
              pairAssetIds: null,
              previousDecision: validatedPreviousDecision
            };
            writeRankingResumeState(next, generation);
            checkpointRef.current = next;
            setPreviousDecision(next.previousDecision);
            setPair(null);
            prefetchRef.current?.clear();
          } else {
            setError(
              caught instanceof ApiError
                ? caught.code
                : "comparison_next_pair_unavailable"
            );
          }
        }
      })
      .finally(() => {
        if (pairRequestAbortRef.current === controller) {
          pairRequestAbortRef.current = null;
          if (isCurrent()) setIsLoading(false);
        }
      });
  }, [isPairCommitted, pair]);

  const undoLastDecision = useCallback(async () => {
    const checkpoint = checkpointRef.current;
    if (
      !previousDecision ||
      !checkpoint ||
      checkpoint.contextKey !== queryKeyRef.current ||
      checkpoint.pending ||
      submissionInFlightRef.current ||
      pairRequestAbortRef.current !== null
    )
      return;
    const pending: PendingRankingMutation = {
      kind: "undo",
      mutationId: createRankingMutationId(),
      eventId: previousDecision.eventId,
      pairAssetIds: previousDecision.pairAssetIds
    };
    const next = { ...checkpoint, pending };
    checkpointRef.current = next;
    if (!writeRankingResumeState(next, rankingResumeGeneration())) {
      setError("ranking_resume_capacity");
      return;
    }
    await performMutation(pending);
  }, [performMutation, previousDecision]);

  return {
    chosenAssetId,
    error,
    isLoading,
    isPairCommitted,
    isSubmitting,
    pair,
    canUndo: previousDecision !== null,
    chooseAsset,
    retry: restoreSession,
    skipPair,
    undoLastDecision
  };
}

function pairIds(pair: ComparisonPairResponse | null): [string, string] | null {
  return pair ? [pair.left.id, pair.right.id] : null;
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
