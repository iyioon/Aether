import { Heart } from "lucide-react";
import type { AssetRecord, TagRecord } from "../api/client";
import { RatingSlider } from "./RatingSlider";

interface GalleryCardCurationProps {
  asset: AssetRecord;
  disabled: boolean;
  hiddenTagCount: number;
  showFavorite: boolean;
  showRating: boolean;
  tags: TagRecord[];
  onFavoriteChange: (asset: AssetRecord, favorite: boolean) => void;
  onRatingChange: (asset: AssetRecord, rating: number | null) => void;
}

export function GalleryCardCuration({
  asset,
  disabled,
  hiddenTagCount,
  showFavorite,
  showRating,
  tags,
  onFavoriteChange,
  onRatingChange
}: GalleryCardCurationProps) {
  const hasTags = tags.length > 0 || hiddenTagCount > 0;

  if (!showRating && !showFavorite && !hasTags) {
    return null;
  }

  return (
    <div className="tile-curation-row" aria-busy={disabled || undefined}>
      {showRating ? (
        <RatingSlider
          className="tile-rating-slider"
          density="compact"
          disabled={disabled}
          label={`Rating for ${asset.name}`}
          value={asset.rating}
          onClear={() => onRatingChange(asset, null)}
          onCommit={(rating) => onRatingChange(asset, rating)}
        />
      ) : null}

      {showFavorite ? (
        <button
          className={
            asset.favorite
              ? "tile-favorite-control active"
              : "tile-favorite-control"
          }
          type="button"
          aria-label={
            asset.favorite
              ? `Remove ${asset.name} from favorites`
              : `Add ${asset.name} to favorites`
          }
          aria-pressed={asset.favorite}
          disabled={disabled}
          title={asset.favorite ? "Favorite" : "Add favorite"}
          onClick={() => onFavoriteChange(asset, !asset.favorite)}
        >
          <span className="tile-favorite-glyph" aria-hidden="true">
            <Heart size={15} strokeWidth={2.1} />
          </span>
        </button>
      ) : null}

      {tags.map((tag) => (
        <span className="tile-badge tag" key={tag.id}>
          {tag.displayName}
        </span>
      ))}
      {hiddenTagCount > 0 ? (
        <span className="tile-badge tag">+{hiddenTagCount}</span>
      ) : null}
    </div>
  );
}
