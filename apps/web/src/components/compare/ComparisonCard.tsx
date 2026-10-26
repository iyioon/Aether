import type { CSSProperties } from "react";
import { Maximize2, SlidersVertical } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { IconButton } from "../IconButton";
import { MediaPreview } from "../media/MediaPreview";
import { formatSignedScore } from "../media/score-format";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { AspectMode } from "../library-state";
import { galleryAspectRatio } from "../gallery/gallery-layout";
import type { ComparisonDirection } from "./comparison-types";

interface ComparisonCardProps {
  aspect: AspectMode;
  asset: AssetRecord;
  direction: ComparisonDirection;
  disabled: boolean;
  isChosen: boolean;
  playbackPaused: boolean;
  onChoose: () => void;
  onOpenFullscreen: () => void;
  onEditAsset?: () => void;
}

export function ComparisonCard({
  aspect,
  asset,
  direction,
  disabled,
  isChosen,
  playbackPaused,
  onChoose,
  onEditAsset,
  onOpenFullscreen
}: ComparisonCardProps) {
  return (
    <Card
      className="comparison-card"
      data-asset-id={asset.id}
      data-chosen={isChosen ? "true" : "false"}
      data-aspect={aspect}
      style={
        { "--comparison-aspect": galleryAspectRatio(aspect) } as CSSProperties
      }
    >
      <CardContent className="comparison-media">
        <MediaPreview
          key={asset.id}
          asset={asset}
          playbackPaused={playbackPaused || disabled}
          presentationPlayback={false}
          defaultFit="contain"
          useOriginalVideo
        />
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
        {onEditAsset ? (
          <IconButton
            className="comparison-edit-button media-overlay-button"
            icon={SlidersVertical}
            label={`Edit ${asset.name}`}
            title="Edit media"
            aria-haspopup="dialog"
            disabled={disabled}
            onClick={onEditAsset}
          />
        ) : null}
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
