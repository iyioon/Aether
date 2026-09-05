import { useState } from "react";
import { Heart, Plus, Tags, X } from "lucide-react";
import type { TagRecord } from "../../api/client";
import { selectedMediaLabel } from "../media/media-format";
import { RatingSlider } from "../RatingSlider";

interface BatchActionsBarProps {
  selectedCount: number;
  tagDraft: string;
  tagSuggestions: TagRecord[];
  isSaving: boolean;
  status: string | null;
  error: string | null;
  onClear: () => void;
  onRate: (rating: number) => void;
  onClearRating: () => void;
  onFavorite: () => void;
  onUnfavorite: () => void;
  onTagDraftChange: (value: string) => void;
  onAddTag: () => void;
  onReplaceTags: () => void;
  onClearTags: () => void;
  onUseSuggestion: (tagName: string) => void;
}

export function BatchActionsBar({
  selectedCount,
  tagDraft,
  tagSuggestions,
  isSaving,
  status,
  error,
  onClear,
  onRate,
  onClearRating,
  onFavorite,
  onUnfavorite,
  onTagDraftChange,
  onAddTag,
  onReplaceTags,
  onClearTags,
  onUseSuggestion
}: BatchActionsBarProps) {
  const [batchRatingValue, setBatchRatingValue] = useState(5);

  return (
    <section className="batch-actions-bar" aria-label="Selected media actions">
      <div className="batch-summary">
        <strong>{selectedCount}</strong>
        <span>{selectedMediaLabel(selectedCount)} selected</span>
      </div>

      <div className="batch-action-group batch-rating-group">
        <span className="batch-group-label">Rating</span>
        <div className="batch-rating-actions" aria-label="Batch rating">
          <RatingSlider
            className="batch-rating-slider"
            density="batch"
            disabled={isSaving}
            label="Set rating for selected media"
            value={batchRatingValue}
            onCommit={(rating) => {
              setBatchRatingValue(rating);
              onRate(rating);
            }}
          />
          <button
            className="ghost-action compact-action"
            type="button"
            disabled={isSaving}
            onClick={onClearRating}
          >
            Clear rating
          </button>
          <button
            className="favorite-button"
            type="button"
            aria-label="Favorite selected media"
            title="Favorite selected"
            disabled={isSaving}
            onClick={onFavorite}
          >
            <span className="favorite-button-glyph" aria-hidden="true">
              <Heart size={18} strokeWidth={2.1} />
            </span>
          </button>
          <button
            className="favorite-button"
            type="button"
            aria-label="Remove favorite from selected media"
            title="Unfavorite selected"
            disabled={isSaving}
            onClick={onUnfavorite}
          >
            <span className="favorite-button-glyph" aria-hidden="true">
              <X size={16} />
            </span>
          </button>
        </div>
      </div>

      <div className="batch-action-group batch-tag-group">
        <span className="batch-group-label">Tags</span>
        <div className="batch-tag-row">
          <div className="batch-tag-control">
            <form
              className="batch-tag-entry"
              aria-label="Tag selected media"
              onSubmit={(event) => {
                event.preventDefault();
                onAddTag();
              }}
            >
              <Tags size={15} />
              <input
                value={tagDraft}
                maxLength={48}
                placeholder="Tag selection"
                disabled={isSaving}
                onChange={(event) => onTagDraftChange(event.target.value)}
              />
              <button
                type="submit"
                aria-label="Add tag to selected media"
                title="Add tag"
                disabled={isSaving || !tagDraft.trim()}
              >
                <Plus size={15} />
              </button>
            </form>
            {tagSuggestions.length ? (
              <div className="batch-tag-suggestions">
                {tagSuggestions.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    disabled={isSaving}
                    onClick={() => onUseSuggestion(tag.displayName)}
                  >
                    {tag.displayName}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="batch-tag-actions" aria-label="Batch tag actions">
            <button
              className="ghost-action compact-action"
              type="button"
              disabled={isSaving || !tagDraft.trim()}
              onClick={onReplaceTags}
            >
              Replace tags
            </button>
            <button
              className="ghost-action compact-action"
              type="button"
              disabled={isSaving}
              onClick={onClearTags}
            >
              Clear tags
            </button>
          </div>
        </div>
      </div>

      {status || error ? (
        <span
          className={error ? "batch-message error" : "batch-message"}
          role={error ? "alert" : "status"}
        >
          {error ?? status}
        </span>
      ) : null}

      <button
        className="icon-button batch-clear"
        type="button"
        aria-label="Clear selection"
        title="Clear selection"
        disabled={isSaving}
        onClick={onClear}
      >
        <X size={17} />
      </button>
    </section>
  );
}
