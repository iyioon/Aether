import { useCallback, useEffect } from "react";
import { CornerUpLeft, RefreshCw } from "lucide-react";
import type {
  AssetRecord,
  MediaTypeFilter,
  ScoreFilter
} from "../../api/client";
import {
  hasOpenKeyboardLayer,
  hasShortcutModifier,
  isEditableKeyboardTarget
} from "../../lib/keyboard";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { ComparisonCard } from "./ComparisonCard";
import { ComparisonChoiceFeedback } from "./ComparisonChoiceFeedback";
import { ComparisonSessionFooter } from "./ComparisonSessionFooter";
import type { ComparisonDirection } from "./comparison-types";
import { useComparisonChoiceFeedback } from "./useComparisonChoiceFeedback";
import { useComparisonSession } from "./useComparisonSession";

interface RankingSessionProps {
  assetUpdate: AssetRecord | null;
  folderId: string | null;
  mediaType: MediaTypeFilter;
  isPlaybackPaused: boolean;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onExit: () => void;
  onOpenFullscreen: (asset: AssetRecord) => void;
  onRankingChanged: () => void;
}

export function RankingSession({
  assetUpdate,
  folderId,
  mediaType,
  isPlaybackPaused,
  scoreFilter,
  search,
  tagFilters,
  onAssetsUpdated,
  onExit,
  onOpenFullscreen,
  onRankingChanged
}: RankingSessionProps) {
  const {
    canUndo,
    chosenAssetId,
    chooseAsset,
    error,
    isLoading,
    isPairCommitted,
    isSubmitting,
    pair,
    retry,
    skipPair,
    undoLastDecision
  } = useComparisonSession({
    assetUpdate,
    folderId,
    mediaType,
    scoreFilter,
    search,
    tagFilters,
    onAssetsUpdated,
    onRankingChanged
  });
  const { choiceFeedback, showChoiceFeedback } = useComparisonChoiceFeedback();
  const handleChoice = useCallback(
    (assetId: string, direction: ComparisonDirection) => {
      showChoiceFeedback(direction);
      void chooseAsset(assetId);
    },
    [chooseAsset, showChoiceFeedback]
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        hasShortcutModifier(event) ||
        isEditableKeyboardTarget(event.target) ||
        hasOpenKeyboardLayer()
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onExit();
        return;
      }

      if (!pair || isSubmitting || isLoading || isPairCommitted) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleChoice(pair.left.id, "left");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleChoice(pair.right.id, "right");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleChoice, isLoading, isPairCommitted, isSubmitting, onExit, pair]);

  return (
    <section className="comparison-view" aria-label="Rank media">
      <div className="comparison-stage">
        {choiceFeedback ? (
          <ComparisonChoiceFeedback feedback={choiceFeedback} />
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Comparison unavailable</AlertTitle>
            <AlertDescription>
              <span>{friendlyComparisonError(error, isPairCommitted)}</span>
              <span className="comparison-error-actions">
                <Button size="sm" variant="ghost" onClick={onExit}>
                  Leaderboard
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void retry()}
                >
                  <RefreshCw aria-hidden="true" />
                  Try again
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        {isLoading && !pair ? (
          <ComparisonSkeleton />
        ) : pair ? (
          <div
            className={[
              "comparison-pair",
              isSubmitting || isLoading || isPairCommitted ? "is-busy" : ""
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <ComparisonCard
              asset={pair.left}
              direction="left"
              disabled={isSubmitting || isLoading || isPairCommitted}
              isChosen={chosenAssetId === pair.left.id}
              playbackPaused={isPlaybackPaused}
              onChoose={() => handleChoice(pair.left.id, "left")}
              onOpenFullscreen={() => onOpenFullscreen(pair.left)}
            />
            <ComparisonCard
              asset={pair.right}
              direction="right"
              disabled={isSubmitting || isLoading || isPairCommitted}
              isChosen={chosenAssetId === pair.right.id}
              playbackPaused={isPlaybackPaused}
              onChoose={() => handleChoice(pair.right.id, "right")}
              onOpenFullscreen={() => onOpenFullscreen(pair.right)}
            />
          </div>
        ) : !isLoading && (!error || canUndo) ? (
          <ComparisonEmptyState
            canUndo={canUndo}
            isSubmitting={isSubmitting}
            onExit={onExit}
            onUndo={() => void undoLastDecision()}
          />
        ) : null}
      </div>

      {pair ? (
        <ComparisonSessionFooter
          canUndo={canUndo}
          isLoading={isLoading}
          isPairCommitted={isPairCommitted}
          isSubmitting={isSubmitting}
          progress={pair.progress}
          onExit={onExit}
          onSkip={skipPair}
          onUndo={() => void undoLastDecision()}
        />
      ) : null}
    </section>
  );
}

function ComparisonEmptyState({
  canUndo,
  isSubmitting,
  onExit,
  onUndo
}: {
  canUndo: boolean;
  isSubmitting: boolean;
  onExit: () => void;
  onUndo: () => void;
}) {
  return (
    <Card className="comparison-empty">
      <CardHeader>
        <CardTitle>
          {canUndo ? "No more pairs available" : "Two items are needed"}
        </CardTitle>
        <CardDescription aria-live="polite">
          {canUndo
            ? "There is not another pair under the current filters. You can undo your last choice or return to the leaderboard."
            : "Adjust the current filters or choose a folder containing at least two media items."}
        </CardDescription>
      </CardHeader>
      <CardContent className="comparison-empty-actions">
        {canUndo ? (
          <Button disabled={isSubmitting} variant="outline" onClick={onUndo}>
            <CornerUpLeft aria-hidden="true" />
            {isSubmitting ? "Undoing…" : "Undo last choice"}
          </Button>
        ) : null}
        <Button onClick={onExit}>Return to leaderboard</Button>
      </CardContent>
    </Card>
  );
}

function ComparisonSkeleton() {
  return (
    <div
      className="comparison-pair"
      role="status"
      aria-label="Loading comparison"
    >
      {["left", "right"].map((side) => (
        <Card className="comparison-card" key={side}>
          <Skeleton className="comparison-media" />
        </Card>
      ))}
    </div>
  );
}

function friendlyComparisonError(
  error: string,
  isPairCommitted: boolean
): string {
  if (isPairCommitted) {
    return "Your choice was saved, but the next pair could not be prepared. Try again or undo the choice.";
  }

  switch (error) {
    case "comparison_changed":
      return "That decision changed elsewhere. Load a fresh pair and try again.";
    case "invalid_pair":
      return "The selected pair is no longer valid.";
    default:
      return "The ranking session could not continue. Your saved choices are unchanged.";
  }
}
