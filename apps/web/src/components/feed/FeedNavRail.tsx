import { ChevronDown, ChevronUp } from "lucide-react";
import { IconButton } from "../IconButton";
import {
  MediaFavoriteButton,
  MediaScoreControl
} from "../MediaCurationControls";
import { Separator } from "../ui/separator";

interface FeedNavRailProps {
  activeIndex: number;
  activeFavorite: boolean;
  activeMediaName: string;
  activeScore: number;
  assetCount: number;
  hasMore: boolean;
  isScoreSaving: boolean;
  onNext: () => void;
  onFavoriteChange: (favorite: boolean) => void;
  onPrevious: () => void;
  onScoreChange: (score: number) => void;
}

export function FeedNavRail({
  activeIndex,
  activeFavorite,
  activeMediaName,
  activeScore,
  assetCount,
  hasMore,
  isScoreSaving,
  onNext,
  onFavoriteChange,
  onPrevious,
  onScoreChange
}: FeedNavRailProps) {
  return (
    <div className="feed-nav-rail" aria-label="Feed navigation" role="group">
      <div className="feed-nav-buttons">
        <IconButton
          className="media-overlay-button feed-nav-button"
          icon={ChevronUp}
          iconSize={18}
          label="Previous feed item"
          size="icon-lg"
          title="Previous"
          disabled={activeIndex <= 0}
          onClick={onPrevious}
        />
        <IconButton
          className="media-overlay-button feed-nav-button"
          icon={ChevronDown}
          iconSize={18}
          label="Next feed item"
          size="icon-lg"
          title="Next"
          disabled={activeIndex >= assetCount - 1 && !hasMore}
          onClick={onNext}
        />
      </div>
      <Separator className="feed-nav-separator" />
      <div className="feed-curation-controls">
        <MediaScoreControl
          disabled={isScoreSaving}
          mediaName={activeMediaName}
          orientation="vertical"
          score={activeScore}
          onChange={onScoreChange}
        />
        <MediaFavoriteButton
          disabled={isScoreSaving}
          favorite={activeFavorite}
          mediaName={activeMediaName}
          overlay
          onChange={onFavoriteChange}
        />
      </div>
    </div>
  );
}
