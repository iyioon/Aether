import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
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
import { preloadMediaImage } from "../media/media-image-cache";
import { thumbnailUrl } from "../media/media-urls";

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
  const checkpointRef = useRef<RankingResumeState | null>(null);
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
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(
    () =>
      subscribeToRankingResumeReset(() => {
        setResetRevision((current) => current + 1);
      }),
    []
  );

  useEffect(() => {
    if (assetUpdate) {
      setPair((current) => replacePairAsset(current, assetUpdate));
    }
  }, [assetUpdate]);

  const restoreSession = useCallback(async () => {
    const requestContext = contextRef.current;
    if (!requestContext || submissionInFlightRef.current) {
      return;
    }
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
      setPreviousDecision(restoredDecision);
      if (nextPair) {
        await waitForPosterPreloads(
          [thumbnailUrl(nextPair.left.id), thumbnailUrl(nextPair.right.id)],
          controller.signal
        );
      }
      if (isCurrent()) {
        setPair(nextPair);
        setIsPairCommitted(false);
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
          submissionInFlightRef.current = false;
          await restoreRef.current();
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
    const scheduleRestore = () => {
      if (document.visibilityState !== "visible") return;
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
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", scheduleRestore);
      window.removeEventListener("pageshow", scheduleRestore);
      window.removeEventListener("online", scheduleRestore);
    };
  }, []);

  const chooseAsset = useCallback(
    async (winnerAssetId: string) => {
      const checkpoint = checkpointRef.current;
      if (
        !pair ||
        !checkpoint ||
        checkpoint.pending ||
        isPairCommitted ||
        submissionInFlightRef.current ||
        pairRequestAbortRef.current !== null
      )
        return;
      const pending: PendingRankingMutation = {
        kind: "choice",
        mutationId: createRankingMutationId(),
        pairAssetIds: pairIds(pair)!,
        winnerAssetId
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
      !requestContext ||
      checkpoint.pending ||
      isPairCommitted ||
      submissionInFlightRef.current ||
      pairRequestAbortRef.current !== null
    )
      return;
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
    void getNextComparisonPair({
      ...requestContext,
      excludeAssetIds: [pair.left.id, pair.right.id],
      signal: controller.signal
    })
      .then(async (nextPair) => {
        if (!isCurrent()) return;
        const next = {
          ...checkpoint,
          comparisonGeneration: nextPair.comparisonGeneration,
          pairAssetIds: pairIds(nextPair),
          previousDecision:
            nextPair.comparisonGeneration === checkpoint.comparisonGeneration
              ? checkpoint.previousDecision
              : null
        };
        writeRankingResumeState(next, generation);
        checkpointRef.current = next;
        if (next.previousDecision === null) setPreviousDecision(null);
        await waitForPosterPreloads(
          [thumbnailUrl(nextPair.left.id), thumbnailUrl(nextPair.right.id)],
          controller.signal
        );
        if (isCurrent()) setPair(nextPair);
      })
      .catch((caught: unknown) => {
        if (isCurrent()) {
          if (
            caught instanceof ApiError &&
            caught.code === "comparison_pair_unavailable"
          ) {
            const next = {
              ...checkpoint,
              pairAssetIds: null
            };
            writeRankingResumeState(next, generation);
            checkpointRef.current = next;
            setPair(null);
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
      checkpoint.pending ||
      submissionInFlightRef.current ||
      pairRequestAbortRef.current !== null
    )
      return;
    const pending: PendingRankingMutation = {
      kind: "undo",
      mutationId: createRankingMutationId(),
      eventId: previousDecision.eventId,
      pairAssetIds: pairIds(previousDecision.pair)!
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
