import { ChevronDown, ChevronUp } from "lucide-react";
import { IconButton } from "../IconButton";

interface FeedNavRailProps {
  activeIndex: number;
  assetCount: number;
  hasMore: boolean;
  onNext: () => void;
  onPrevious: () => void;
}

export function FeedNavRail({
  activeIndex,
  assetCount,
  hasMore,
  onNext,
  onPrevious
}: FeedNavRailProps) {
  return (
    <div className="feed-nav-rail" aria-label="Feed navigation">
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
  );
}
