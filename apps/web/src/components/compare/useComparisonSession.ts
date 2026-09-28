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
  const [chosenAssetId, setChosenAssetId] = useState<string | null>(null);
  const [previousDecision, setPreviousDecision] =
    useState<PreviousDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
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
    if (!assetUpdate) {
      return;
    }

    setPair((currentPair) => replacePairAsset(currentPair, assetUpdate));
  }, [assetUpdate]);

  const loadPair = useCallback(
    async (excludeAssetIds: string[] = []) => {
      if (!folderId) {
        setPair(null);
        return;
      }

      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;
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
          excludeAssetIds
        });

        if (requestSequenceRef.current === requestSequence) {
          setPair(nextPair);
        }
      } catch (caught) {
        if (requestSequenceRef.current !== requestSequence) {
          return;
        }

        if (
          caught instanceof ApiError &&
          caught.code === "comparison_pair_unavailable"
        ) {
          setPair(null);
        } else {
          setError(
            caught instanceof ApiError
              ? caught.code
              : "Unable to load a comparison."
          );
        }
      } finally {
        if (requestSequenceRef.current === requestSequence) {
          setIsLoading(false);
        }
      }
    },
    [folderId, mediaType, scoreFilter, search, tagFilters]
  );

  useEffect(() => {
    setPair(null);
    setPreviousDecision(null);
    void loadPair();

    return () => {
      requestSequenceRef.current += 1;
    };
  }, [loadPair]);

  const chooseAsset = useCallback(
    async (winnerAssetId: string) => {
      if (!pair || isSubmitting) {
        return;
      }

      const decidedPair = pair;
      const decisionQueryKey = queryKeyRef.current;
      setChosenAssetId(winnerAssetId);
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await recordComparison({
          leftAssetId: decidedPair.left.id,
          rightAssetId: decidedPair.right.id,
          winnerAssetId
        });
        onAssetsUpdated(response.assets);
        onRankingChanged();
        if (queryKeyRef.current === decisionQueryKey) {
          setPreviousDecision({ eventId: response.eventId, pair: decidedPair });
          await loadPair([decidedPair.left.id, decidedPair.right.id]);
        }
      } catch (caught) {
        if (queryKeyRef.current === decisionQueryKey) {
          setError(
            caught instanceof ApiError
              ? caught.code
              : "Your choice could not be saved."
          );
        }
      } finally {
        setChosenAssetId(null);
        setIsSubmitting(false);
      }
    },
    [isSubmitting, loadPair, onAssetsUpdated, onRankingChanged, pair]
  );

  const skipPair = useCallback(() => {
    if (!pair || isSubmitting) {
      return;
    }

    void loadPair([pair.left.id, pair.right.id]);
  }, [isSubmitting, loadPair, pair]);

  const undoLastDecision = useCallback(async () => {
    if (!previousDecision || isSubmitting) {
      return;
    }

    const undoQueryKey = queryKeyRef.current;
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

      if (left && right && queryKeyRef.current === undoQueryKey) {
        setPair({
          left,
          right,
          progress: previousDecision.pair.progress
        });
      }
      if (queryKeyRef.current === undoQueryKey) {
        setPreviousDecision(null);
      }
    } catch (caught) {
      if (queryKeyRef.current === undoQueryKey) {
        setError(
          caught instanceof ApiError
            ? caught.code
            : "The last choice could not be restored."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onAssetsUpdated, onRankingChanged, previousDecision]);

  return {
    chosenAssetId,
    error,
    isLoading,
    isSubmitting,
    pair,
    canUndo: previousDecision !== null,
    chooseAsset,
    retry: loadPair,
    skipPair,
    undoLastDecision
  };
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
