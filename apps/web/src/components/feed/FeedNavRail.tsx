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
  activeRating: number | null;
  assetCount: number;
  hasMore: boolean;
  isRatingSaving: boolean;
  onNext: () => void;
  onFavoriteChange: (favorite: boolean) => void;
  onPrevious: () => void;
  onRatingChange: (rating: number | null) => void;
}

export function FeedNavRail({
  activeIndex,
  activeFavorite,
  activeMediaName,
  activeRating,
  assetCount,
  hasMore,
  isRatingSaving,
  onNext,
  onFavoriteChange,
  onPrevious,
  onRatingChange
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
          disabled={isRatingSaving}
          mediaName={activeMediaName}
          orientation="vertical"
          score={activeRating}
          onChange={onRatingChange}
        />
        <MediaFavoriteButton
          disabled={isRatingSaving}
          favorite={activeFavorite}
          mediaName={activeMediaName}
          overlay
          onChange={onFavoriteChange}
        />
      </div>
    </div>
  );
}
