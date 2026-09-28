import { useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CornerUpLeft,
  RefreshCw,
  Shuffle
} from "lucide-react";
import type {
  AssetRecord,
  MediaTypeFilter,
  RatingFilter
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
  CardFooter,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Progress } from "../ui/progress";
import { Skeleton } from "../ui/skeleton";
import { useComparisonSession } from "./useComparisonSession";

interface ComparisonViewProps {
  folderId: string | null;
  mediaType: MediaTypeFilter;
  ratingFilter: RatingFilter;
  search: string;
  tagFilters: string[];
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onRankingChanged: () => void;
}

export function ComparisonView({
  folderId,
  mediaType,
  ratingFilter,
  search,
  tagFilters,
  onAssetsUpdated,
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
    folderId,
    mediaType,
    ratingFilter,
    search,
    tagFilters,
    onAssetsUpdated,
    onRankingChanged
  });

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
        void chooseAsset(pair.left.id);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void chooseAsset(pair.right.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chooseAsset, isLoading, isSubmitting, pair]);

  const rankedPercent = pair
    ? (pair.progress.rankedCount / pair.progress.candidateCount) * 100
    : 0;

  return (
    <section className="comparison-view" aria-labelledby="comparison-heading">
      <header className="comparison-header">
        <div className="comparison-heading-copy">
          <p className="comparison-eyebrow">Pairwise ranking</p>
          <h1 id="comparison-heading">Which should rank higher?</h1>
          <p>
            Choose the stronger item. Repeated choices refine the ordering over
            time.
          </p>
        </div>
        <div className="comparison-header-actions">
          <Button
            disabled={!canUndo || isSubmitting}
            size="sm"
            variant="outline"
            onClick={() => void undoLastDecision()}
          >
            <CornerUpLeft aria-hidden="true" />
            Undo last choice
          </Button>
          <Button
            disabled={!pair || isSubmitting || isLoading}
            size="sm"
            variant="ghost"
            onClick={skipPair}
          >
            <Shuffle aria-hidden="true" />
            Skip pair
          </Button>
        </div>
      </header>

      {pair ? (
        <div className="comparison-progress" aria-label="Ranking coverage">
          <div>
            <Badge variant="secondary">
              {pair.progress.rankedCount} of {pair.progress.candidateCount} ranked
            </Badge>
            <span>{pair.progress.decidedPairCount} pair decisions</span>
          </div>
          <Progress value={rankedPercent} />
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
            onChoose={() => void chooseAsset(pair.left.id)}
          />
          <div className="comparison-versus" aria-hidden="true">
            <span>or</span>
          </div>
          <ComparisonCard
            asset={pair.right}
            direction="right"
            disabled={isSubmitting || isLoading}
            isChosen={chosenAssetId === pair.right.id}
            onChoose={() => void chooseAsset(pair.right.id)}
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

      <p className="sr-only" aria-live="polite">
        {chosenAssetId ? "Choice saved. Loading another pair." : ""}
      </p>
    </section>
  );
}

interface ComparisonCardProps {
  asset: AssetRecord;
  direction: "left" | "right";
  disabled: boolean;
  isChosen: boolean;
  onChoose: () => void;
}

function ComparisonCard({
  asset,
  direction,
  disabled,
  isChosen,
  onChoose
}: ComparisonCardProps) {
  const DirectionIcon = direction === "left" ? ArrowLeft : ArrowRight;

  return (
    <Card
      className="comparison-card"
      data-chosen={isChosen ? "true" : "false"}
    >
      <CardContent className="comparison-media">
        <MediaPreview asset={asset} playbackPaused />
        {isChosen ? (
          <span className="comparison-choice-confirmation" aria-hidden="true">
            <Check />
          </span>
        ) : null}
      </CardContent>
      <CardHeader>
        <CardTitle title={asset.name}>{asset.name}</CardTitle>
        <CardDescription>
          {asset.mediaType === "video" ? "Video" : "Image"}
          {asset.ranking ? (
            <>
              <span aria-hidden="true"> · </span>
              {asset.ranking.comparisonCount} comparisons
            </>
          ) : (
            <>
              <span aria-hidden="true"> · </span>
              Not ranked yet
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <span className="comparison-score">
          <span>Score</span>
          <strong>{asset.rating ?? "—"}</strong>
        </span>
        <Button
          aria-label={`Choose ${asset.name}`}
          aria-keyshortcuts={direction === "left" ? "ArrowLeft" : "ArrowRight"}
          disabled={disabled}
          onClick={onChoose}
        >
          {direction === "left" ? <DirectionIcon aria-hidden="true" /> : null}
          Choose
          {direction === "right" ? <DirectionIcon aria-hidden="true" /> : null}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ComparisonSkeleton() {
  return (
    <div className="comparison-pair" aria-label="Loading comparison">
      {["left", "right"].map((side) => (
        <Card className="comparison-card" key={side}>
          <Skeleton className="comparison-media" />
          <CardHeader>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </CardHeader>
          <CardFooter>
            <Skeleton className="h-9 w-full" />
          </CardFooter>
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
