import { ChevronDown, ChevronUp } from "lucide-react";

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
      <button
        className="feed-nav-button"
        type="button"
        aria-label="Previous feed item"
        title="Previous"
        disabled={activeIndex <= 0}
        onClick={onPrevious}
      >
        <ChevronUp size={20} />
      </button>
      <button
        className="feed-nav-button"
        type="button"
        aria-label="Next feed item"
        title="Next"
        disabled={activeIndex >= assetCount - 1 && !hasMore}
        onClick={onNext}
      >
        <ChevronDown size={20} />
      </button>
    </div>
  );
}
