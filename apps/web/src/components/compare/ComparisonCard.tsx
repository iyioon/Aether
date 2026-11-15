import type { CSSProperties } from "react";
import { Maximize2 } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { MediaPreview } from "../media/MediaPreview";
import { formatSignedScore } from "../media/score-format";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type { AspectMode } from "../library-state";
import {
  galleryAspectRatio,
  mediaAspectRatio
} from "../gallery/gallery-layout";
import type { ComparisonDirection } from "./comparison-types";

import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { MediaCardInfo } from "../media/MediaCardInfo";

interface ComparisonCardProps {
  measuredAspectRatio?: string;
  onMediaDimensionsKnown: (
    assetId: string,
    width: number,
    height: number
  ) => void;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  aspect: AspectMode;
  asset: AssetRecord;
  direction: ComparisonDirection;
  disabled: boolean;
  isChosen: boolean;
  playbackPaused: boolean;
  onChoose: () => void;
  onOpenFullscreen: () => void;
}

export function ComparisonCard({
  measuredAspectRatio,
  onMediaDimensionsKnown,
  aspect,
  metadataFields,
  asset,
  direction,
  disabled,
  isChosen,
  playbackPaused,
  onChoose,
  onOpenFullscreen
}: ComparisonCardProps) {
  return (
    <Card
      className="comparison-card"
      data-asset-id={asset.id}
      data-chosen={isChosen ? "true" : "false"}
      data-aspect={aspect}
      style={
        {
          "--comparison-aspect":
            aspect === "Original"
              ? mediaAspectRatio(asset, measuredAspectRatio)
              : galleryAspectRatio(aspect)
        } as CSSProperties
      }
    >
      <CardContent className="comparison-media">
        <MediaPreview
          asset={asset}
          onDimensionsKnown={onMediaDimensionsKnown}
          playbackPaused={playbackPaused || disabled}
          applyPlaybackPreferences={false}
          defaultFit={aspect === "Original" ? "contain" : "cover"}
          framingAspect={aspect}
          muted
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
        {metadataFields.size > Number(metadataFields.has("score")) ? (
          <div className="comparison-card-info">
            <MediaCardInfo
              asset={asset}
              fields={metadataFields}
              includeScore={false}
            />
          </div>
        ) : null}
        {metadataFields.has("score") ? <ComparisonScore asset={asset} /> : null}
      </CardContent>
    </Card>
  );
}

function ComparisonScore({ asset }: { asset: AssetRecord }) {
  return (
    <Popover key={asset.id} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="comparison-score"
          aria-label={`Final score ${asset.score}. Show score breakdown.`}
          title="Score breakdown"
        >
          <span className="sr-only">Score</span>
          <strong>{asset.score}</strong>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="comparison-score-details w-auto text-sm"
        side="top"
        align="end"
        sideOffset={6}
        aria-label="Score breakdown"
      >
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
      </PopoverContent>
    </Popover>
  );
}
