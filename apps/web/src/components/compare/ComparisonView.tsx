import { useCallback, useEffect } from "react";
import { RefreshCw } from "lucide-react";
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
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { ComparisonCard } from "./ComparisonCard";
import { ComparisonChoiceFeedback } from "./ComparisonChoiceFeedback";
import { ComparisonSessionFooter } from "./ComparisonSessionFooter";
import type { ComparisonDirection } from "./comparison-types";
import { useComparisonChoiceFeedback } from "./useComparisonChoiceFeedback";
import { useComparisonSession } from "./useComparisonSession";

interface ComparisonViewProps {
  assetUpdate: AssetRecord | null;
  folderId: string | null;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onOpenFullscreen: (asset: AssetRecord) => void;
  onRankingChanged: () => void;
}

export function ComparisonView({
  assetUpdate,
  folderId,
  mediaType,
  scoreFilter,
  search,
  tagFilters,
  onAssetsUpdated,
  onOpenFullscreen,
  onRankingChanged
}: ComparisonViewProps) {
  const {
    canUndo,
    chosenAssetId,
    chooseAsset,
    error,
    isLoading,
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
        hasOpenKeyboardLayer() ||
        !pair ||
        isSubmitting ||
        isLoading
      ) {
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
  }, [handleChoice, isLoading, isSubmitting, pair]);

  return (
    <section className="comparison-view" aria-label="Compare and rank media">
      <div className="comparison-stage">
        {choiceFeedback ? (
          <ComparisonChoiceFeedback feedback={choiceFeedback} />
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Comparison unavailable</AlertTitle>
            <AlertDescription>
              <span>{friendlyComparisonError(error)}</span>
              <Button size="sm" variant="outline" onClick={() => void retry()}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {isLoading && !pair ? (
          <ComparisonSkeleton />
        ) : pair ? (
          <div
            className={["comparison-pair", isSubmitting ? "is-submitting" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <ComparisonCard
              asset={pair.left}
              direction="left"
              disabled={isSubmitting || isLoading}
              isChosen={chosenAssetId === pair.left.id}
              onChoose={() => handleChoice(pair.left.id, "left")}
              onOpenFullscreen={() => onOpenFullscreen(pair.left)}
            />
            <ComparisonCard
              asset={pair.right}
              direction="right"
              disabled={isSubmitting || isLoading}
              isChosen={chosenAssetId === pair.right.id}
              onChoose={() => handleChoice(pair.right.id, "right")}
              onOpenFullscreen={() => onOpenFullscreen(pair.right)}
            />
          </div>
        ) : !error && !isLoading ? (
          <Card className="comparison-empty">
            <CardHeader>
              <CardTitle>Two items are needed</CardTitle>
              <CardDescription>
                Adjust the current filters or choose a folder containing at
                least two media items.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      {pair ? (
        <ComparisonSessionFooter
          canUndo={canUndo}
          isLoading={isLoading}
          isSubmitting={isSubmitting}
          progress={pair.progress}
          onSkip={skipPair}
          onUndo={() => void undoLastDecision()}
        />
      ) : null}
    </section>
  );
}

function ComparisonSkeleton() {
  return (
    <div className="comparison-pair" aria-label="Loading comparison">
      {["left", "right"].map((side) => (
        <Card className="comparison-card" key={side}>
          <Skeleton className="comparison-media" />
        </Card>
      ))}
    </div>
  );
}

function friendlyComparisonError(error: string): string {
  switch (error) {
    case "comparison_changed":
      return "That decision changed elsewhere. Load a fresh pair and try again.";
    case "invalid_pair":
      return "The selected pair is no longer valid.";
    default:
      return "The ranking session could not continue. Your saved choices are unchanged.";
  }
}
