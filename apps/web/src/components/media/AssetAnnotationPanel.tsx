import { useEffect, useState } from "react";
import { Heart, Plus, Sparkles, X } from "lucide-react";
import {
  ApiError,
  getAiAssetTagSuggestions,
  getAssetTags,
  getAssetTagSuggestions,
  setAssetTags,
  suggestTags,
  updateAssetRating,
  type AiStatus,
  type AssetRecord,
  type TagRecord,
  type TagSuggestion
} from "../../api/client";
import { normalizeTagDraft } from "../library-state";
import { RatingSlider } from "../RatingSlider";
import { uniqueTagNames } from "../tags/tag-utils";

interface AssetAnnotationPanelProps {
  aiStatus: AiStatus | null;
  asset: AssetRecord;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}

export function AssetAnnotationPanel({
  aiStatus,
  asset,
  onAssetUpdated,
  onAssetTagsUpdated
}: AssetAnnotationPanelProps) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<TagRecord[]>([]);
  const [smartTagSuggestions, setSmartTagSuggestions] = useState<
    TagSuggestion[]
  >([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [isSavingRating, setIsSavingRating] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [isLoadingSmartTags, setIsLoadingSmartTags] = useState(false);
  const [isLoadingAiTags, setIsLoadingAiTags] = useState(false);

  useEffect(() => {
    let active = true;
    setTags([]);
    setTagInput("");
    setTagSuggestions([]);
    setSmartTagSuggestions([]);
    setAnnotationError(null);

    getAssetTags(asset.id)
      .then((response) => {
        if (active) {
          setTags(response.tags);
        }
      })
      .catch(() => {
        if (active) {
          setAnnotationError("Unable to load tags.");
        }
      });

    return () => {
      active = false;
    };
  }, [asset.id]);

  useEffect(() => {
    const query = tagInput.trim();

    if (!query) {
      setTagSuggestions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      suggestTags({ query, limit: 8 })
        .then((response) => {
          if (active) {
            const selectedNames = new Set(
              tags.map((tag) => tag.normalizedName)
            );
            setTagSuggestions(
              response.tags.filter(
                (tag) => !selectedNames.has(tag.normalizedName)
              )
            );
          }
        })
        .catch(() => {
          if (active) {
            setTagSuggestions([]);
          }
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tagInput, tags]);

  async function saveRating(input: {
    rating?: number | null;
    favorite?: boolean;
  }) {
    setIsSavingRating(true);
    setAnnotationError(null);

    try {
      const { asset: updatedAsset } = await updateAssetRating(asset.id, input);
      onAssetUpdated(updatedAsset);
    } catch {
      setAnnotationError("Unable to save rating.");
    } finally {
      setIsSavingRating(false);
    }
  }

  async function saveTags(nextTagNames: string[]) {
    setIsSavingTags(true);
    setAnnotationError(null);

    try {
      const response = await setAssetTags(asset.id, uniqueTagNames(nextTagNames));
      setTags(response.tags);
      onAssetTagsUpdated(asset.id, response.tags);
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(currentSuggestions, response.tags)
      );
      setTagInput("");
      setTagSuggestions([]);
    } catch {
      setAnnotationError("Unable to save tags.");
    } finally {
      setIsSavingTags(false);
    }
  }

  function addTag(rawTagName: string) {
    const tagName = normalizeTagDraft(rawTagName);

    if (!tagName) {
      return;
    }

    void saveTags([...tags.map((tag) => tag.displayName), tagName]);
  }

  function removeTag(tagId: string) {
    void saveTags(
      tags
        .filter((tag) => tag.id !== tagId)
        .map((tag) => tag.displayName)
    );
  }

  async function loadSmartTagSuggestions() {
    setIsLoadingSmartTags(true);
    setAnnotationError(null);

    try {
      const response = await getAssetTagSuggestions(asset.id, 8);
      setSmartTagSuggestions(filterSavedSuggestions(response.suggestions, tags));
    } catch {
      setAnnotationError("Unable to load suggestions.");
    } finally {
      setIsLoadingSmartTags(false);
    }
  }

  async function loadAiTagSuggestions() {
    setIsLoadingAiTags(true);
    setAnnotationError(null);

    try {
      const response = await getAiAssetTagSuggestions(asset.id, 8);
      setSmartTagSuggestions((currentSuggestions) =>
        filterSavedSuggestions(
          mergeTagSuggestions(currentSuggestions, response.suggestions),
          tags
        )
      );
    } catch (caught) {
      setAnnotationError(aiSuggestionErrorMessage(caught));
    } finally {
      setIsLoadingAiTags(false);
    }
  }

  return (
    <section className="annotation-panel" aria-label="Media annotations">
      <div className="annotation-row">
        <span className="annotation-label">Rating</span>
        <div className="rating-controls">
          <RatingSlider
            className="annotation-rating-slider"
            disabled={isSavingRating}
            label={`Rating for ${asset.name}`}
            value={asset.rating}
            onClear={() => void saveRating({ rating: null })}
            onCommit={(rating) => void saveRating({ rating })}
          />
        </div>
        <button
          className={asset.favorite ? "favorite-button active" : "favorite-button"}
          type="button"
          aria-label="Favorite"
          title="Favorite"
          aria-pressed={asset.favorite}
          disabled={isSavingRating}
          onClick={() => void saveRating({ favorite: !asset.favorite })}
        >
          <span className="favorite-button-glyph" aria-hidden="true">
            <Heart size={18} strokeWidth={2.1} />
          </span>
        </button>
      </div>

      <div className="tag-editor">
        <div className="tag-editor-heading">
          <span className="annotation-label">Tags</span>
          <div className="tag-editor-actions">
            <button
              className="suggest-tags-button"
              type="button"
              disabled={isLoadingSmartTags || isSavingTags}
              onClick={() => void loadSmartTagSuggestions()}
            >
              <Sparkles size={14} />
              <span>{isLoadingSmartTags ? "Suggesting" : "Suggest tags"}</span>
            </button>
            {aiStatus?.enabled ? (
              <button
                className="suggest-tags-button"
                type="button"
                disabled={isLoadingAiTags || isSavingTags}
                onClick={() => void loadAiTagSuggestions()}
              >
                <Sparkles size={14} />
                <span>{isLoadingAiTags ? "Analyzing" : "Vision tags"}</span>
              </button>
            ) : null}
          </div>
        </div>
        <div className="tag-chip-list">
          {tags.map((tag) => (
            <span className="tag-chip" key={tag.id}>
              {tag.displayName}
              <button
                type="button"
                aria-label={`Remove ${tag.displayName}`}
                disabled={isSavingTags}
                onClick={() => removeTag(tag.id)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          <div className="tag-input-wrap">
            <input
              value={tagInput}
              maxLength={48}
              placeholder="Add tag"
              disabled={isSavingTags}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagInput);
                }
              }}
            />
            <button
              type="button"
              aria-label="Add tag"
              title="Add tag"
              disabled={isSavingTags || !tagInput.trim()}
              onClick={() => addTag(tagInput)}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>

        {smartTagSuggestions.length ? (
          <div
            className="tag-suggestions smart-suggestions"
            aria-label="Suggested tags"
          >
            {smartTagSuggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion.normalizedName}
                title={`${suggestion.reason}; confidence ${Math.round(
                  suggestion.confidence * 100
                )}%`}
                disabled={isSavingTags}
                onClick={() => addTag(suggestion.displayName)}
              >
                <Sparkles size={13} />
                {suggestion.displayName}
              </button>
            ))}
          </div>
        ) : null}

        {tagSuggestions.length ? (
          <div className="tag-suggestions">
            {tagSuggestions.map((tag) => (
              <button
                type="button"
                key={tag.id}
                disabled={isSavingTags}
                onClick={() => addTag(tag.displayName)}
              >
                {tag.displayName}
              </button>
            ))}
          </div>
        ) : null}

        {annotationError ? (
          <span className="annotation-error">{annotationError}</span>
        ) : null}
      </div>
    </section>
  );
}

function aiSuggestionErrorMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return "Unable to analyze media.";
  }

  switch (caught.code) {
    case "ai_disabled":
      return "AI suggestions are disabled.";
    case "ai_not_supported":
      return "Vision suggestions support images first.";
    case "ai_provider_failed":
      return "Local AI provider did not respond.";
    default:
      return "Unable to analyze media.";
  }
}

function filterSavedSuggestions(
  suggestions: TagSuggestion[],
  savedTags: TagRecord[]
): TagSuggestion[] {
  const savedTagNames = new Set(savedTags.map((tag) => tag.normalizedName));

  return suggestions.filter(
    (suggestion) => !savedTagNames.has(suggestion.normalizedName)
  );
}

function mergeTagSuggestions(
  currentSuggestions: TagSuggestion[],
  nextSuggestions: TagSuggestion[]
): TagSuggestion[] {
  const suggestions = new Map<string, TagSuggestion>();

  for (const suggestion of [...currentSuggestions, ...nextSuggestions]) {
    if (!suggestions.has(suggestion.normalizedName)) {
      suggestions.set(suggestion.normalizedName, suggestion);
    }
  }

  return [...suggestions.values()];
}
