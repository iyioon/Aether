import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CornerUpLeft,
  Maximize2,
  RefreshCw,
  Shuffle
} from "lucide-react";
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
import { MediaPreview } from "../media/MediaPreview";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Progress } from "../ui/progress";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useComparisonSession } from "./useComparisonSession";

type ComparisonDirection = "left" | "right";

interface ChoiceFeedback {
  direction: ComparisonDirection;
  id: number;
  isExiting: boolean;
}

const CHOICE_FEEDBACK_IDLE_MS = 750;
const CHOICE_FEEDBACK_EXIT_MS = 150;

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
  const { choiceFeedback, showChoiceFeedback } =
    useComparisonChoiceFeedback();
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

  const rankedPercent = pair
    ? (pair.progress.rankedCount / pair.progress.candidateCount) * 100
    : 0;

  return (
    <section className="comparison-view" aria-label="Compare and rank media">
      <div className="comparison-stage">
        {choiceFeedback ? (
          <div
            className={[
              "comparison-choice-feedback",
              `is-${choiceFeedback.direction}`,
              choiceFeedback.isExiting ? "is-exiting" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            role="status"
            aria-label={`${
              choiceFeedback.direction === "left" ? "Left" : "Right"
            } item selected`}
          >
            <span
              className="comparison-choice-arrow"
              key={choiceFeedback.id}
              aria-hidden="true"
            >
              {choiceFeedback.direction === "left" ? (
                <ArrowLeft />
              ) : (
                <ArrowRight />
              )}
            </span>
            <span aria-hidden="true">Selected</span>
          </div>
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
            className={[
              "comparison-pair",
              isSubmitting ? "is-submitting" : ""
            ]
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
                Adjust the current filters or choose a folder containing at least
                two media items.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      {pair ? (
        <footer className="comparison-session-footer">
          <div className="comparison-progress" aria-label="Ranking coverage">
            <div className="comparison-progress-track">
              <Progress value={rankedPercent} />
              <span className="comparison-progress-mobile-count">
                {pair.progress.rankedCount}/{pair.progress.candidateCount}
              </span>
            </div>
            <div className="comparison-progress-details">
              <Badge variant="secondary">
                {pair.progress.rankedCount} of {pair.progress.candidateCount}{" "}
                ranked
              </Badge>
              <span>{pair.progress.decidedPairCount} pair decisions</span>
            </div>
          </div>
          <div className="comparison-session-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Undo last choice"
                  disabled={!canUndo || isSubmitting}
                  size="icon-sm"
                  variant="outline"
                  onClick={() => void undoLastDecision()}
                >
                  <CornerUpLeft aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo last choice</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Skip this pair"
                  disabled={isSubmitting || isLoading}
                  size="icon-sm"
                  variant="ghost"
                  onClick={skipPair}
                >
                  <Shuffle aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Skip pair</TooltipContent>
            </Tooltip>
          </div>
        </footer>
      ) : null}

    </section>
  );
}

interface ComparisonCardProps {
  asset: AssetRecord;
  direction: ComparisonDirection;
  disabled: boolean;
  isChosen: boolean;
  onChoose: () => void;
  onOpenFullscreen: () => void;
}

function ComparisonCard({
  asset,
  direction,
  disabled,
  isChosen,
  onChoose,
  onOpenFullscreen
}: ComparisonCardProps) {
  return (
    <Card
      className="comparison-card"
      data-chosen={isChosen ? "true" : "false"}
    >
      <CardContent className="comparison-media">
        <MediaPreview asset={asset} playbackPaused />
        <button
          className="comparison-choose-surface"
          type="button"
          aria-label={`Choose ${asset.name}`}
          aria-keyshortcuts={direction === "left" ? "ArrowLeft" : "ArrowRight"}
          disabled={disabled}
          onClick={onChoose}
        />
        <Button
          className="comparison-fullscreen-button media-overlay-button"
          size="icon"
          type="button"
          variant="outline"
          aria-label={`Open ${asset.name} fullscreen`}
          onClick={onOpenFullscreen}
        >
          <Maximize2 aria-hidden="true" />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="comparison-score"
              tabIndex={0}
              aria-label={`Final score ${asset.score}. Show score breakdown.`}
            >
              <span className="sr-only">Score</span>
              <strong>{asset.score}</strong>
            </span>
          </TooltipTrigger>
          <TooltipContent className="comparison-score-tooltip" sideOffset={6}>
            {asset.ranking ? (
              <>
                <span>
                  Comparison <strong>{asset.ranking.comparisonScore}</strong>
                </span>
                <span>
                  Manual adjustment{" "}
                  <strong>
                    {formatSignedScore(asset.ranking.manualAdjustment)}
                  </strong>
                </span>
                <span>
                  Final <strong>{asset.score}</strong>
                </span>
              </>
            ) : (
              <>
                <span>Not ranked by comparisons</span>
                <span>
                  Manual score <strong>{asset.score}</strong>
                </span>
              </>
            )}
          </TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  );
}

function formatSignedScore(value: number): string {
  return value > 0 ? `+${value}` : String(value);
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

function useComparisonChoiceFeedback() {
  const feedbackIdRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);
  const removalTimerRef = useRef<number | null>(null);
  const [choiceFeedback, setChoiceFeedback] =
    useState<ChoiceFeedback | null>(null);

  const showChoiceFeedback = useCallback(
    (direction: ComparisonDirection) => {
      feedbackIdRef.current += 1;
      const feedbackId = feedbackIdRef.current;

      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      if (removalTimerRef.current !== null) {
        window.clearTimeout(removalTimerRef.current);
        removalTimerRef.current = null;
      }

      setChoiceFeedback({
        direction,
        id: feedbackId,
        isExiting: false
      });

      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        setChoiceFeedback((current) =>
          current?.id === feedbackId
            ? { ...current, isExiting: true }
            : current
        );
        removalTimerRef.current = window.setTimeout(() => {
          removalTimerRef.current = null;
          setChoiceFeedback((current) =>
            current?.id === feedbackId ? null : current
          );
        }, CHOICE_FEEDBACK_EXIT_MS);
      }, CHOICE_FEEDBACK_IDLE_MS);
    },
    []
  );

  useEffect(
    () => () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      if (removalTimerRef.current !== null) {
        window.clearTimeout(removalTimerRef.current);
      }
    },
    []
  );

  return { choiceFeedback, showChoiceFeedback };
}
