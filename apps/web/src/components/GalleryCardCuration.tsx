import type { AssetRecord, TagRecord } from "../api/client";
import {
  MediaFavoriteButton,
  MediaScoreControl
} from "./MediaCurationControls";

interface GalleryCardCurationProps {
  asset: AssetRecord;
  disabled: boolean;
  hiddenTagCount: number;
  isBusy?: boolean;
  showFavorite: boolean;
  showRating: boolean;
  tags: TagRecord[];
  onFavoriteChange: (asset: AssetRecord, favorite: boolean) => void;
  onScoreChange: (asset: AssetRecord, score: number | null) => void;
}

export function GalleryCardCuration({
  asset,
  disabled,
  hiddenTagCount,
  isBusy = false,
  showFavorite,
  showRating,
  tags,
  onFavoriteChange,
  onScoreChange
}: GalleryCardCurationProps) {
  const hasTags = tags.length > 0 || hiddenTagCount > 0;

  if (!showRating && !showFavorite && !hasTags) {
    return null;
  }

  return (
    <div className="tile-curation-row" aria-busy={isBusy || undefined}>
      {showRating ? (
        <MediaScoreControl
          disabled={disabled}
          mediaName={asset.name}
          score={asset.rating}
          onChange={(score) => onScoreChange(asset, score)}
        />
      ) : null}

      {showFavorite ? (
        <MediaFavoriteButton
          disabled={disabled}
          favorite={asset.favorite}
          mediaName={asset.name}
          onChange={(favorite) => onFavoriteChange(asset, favorite)}
        />
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
