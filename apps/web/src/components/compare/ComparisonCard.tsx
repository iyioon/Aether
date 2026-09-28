import { Maximize2 } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { MediaPreview } from "../media/MediaPreview";
import { formatSignedScore } from "../media/score-format";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { ComparisonDirection } from "./comparison-types";

interface ComparisonCardProps {
  asset: AssetRecord;
  direction: ComparisonDirection;
  disabled: boolean;
  isChosen: boolean;
  onChoose: () => void;
  onOpenFullscreen: () => void;
}

export function ComparisonCard({
  asset,
  direction,
  disabled,
  isChosen,
  onChoose,
  onOpenFullscreen
}: ComparisonCardProps) {
  return (
    <Card className="comparison-card" data-chosen={isChosen ? "true" : "false"}>
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
        <ComparisonScore asset={asset} />
      </CardContent>
    </Card>
  );
}

function ComparisonScore({ asset }: { asset: AssetRecord }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="comparison-score"
          aria-label={`Final score ${asset.score}. Show score breakdown.`}
        >
          <span className="sr-only">Score</span>
          <strong>{asset.score}</strong>
        </button>
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
  );
}
