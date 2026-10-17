import { useRef } from "react";
import { Plus, X } from "lucide-react";
import type { MediaTypeFilter, ScoreFilter, TagRecord } from "../../api/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  MAX_TAG_FILTER_LENGTH,
  MAX_TAG_FILTERS,
  normalizeTagIdentity
} from "../library-state";
import { mediaFilters, scoreFilters } from "./library-control-options";

export interface FilterControlsProps {
  filterTagSuggestions: TagRecord[];
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  tagFilters: string[];
  tagFilterDraft: string;
  onAddTagFilter: (tagName: string) => void;
  onClearFilters: () => void;
  onSetMediaType: (mediaType: MediaTypeFilter) => void;
  onRemoveTagFilter: (tagName: string) => void;
  onSetScoreFilter: (scoreFilter: ScoreFilter) => void;
  onSetTagFilterDraft: (value: string) => void;
}

export function FilterControls({
  filterTagSuggestions,
  mediaType,
  scoreFilter,
  tagFilters,
  tagFilterDraft,
  onAddTagFilter,
  onClearFilters,
  onSetMediaType,
  onRemoveTagFilter,
  onSetScoreFilter,
  onSetTagFilterDraft
}: FilterControlsProps) {
  const tagInputRef = useRef<HTMLInputElement>(null);
  const normalizedSelectedTags = new Set(tagFilters.map(normalizeTagIdentity));
  const normalizedDraft = normalizeTagIdentity(tagFilterDraft);
  const isAtTagLimit = tagFilters.length >= MAX_TAG_FILTERS;
  const canAddTag =
    Boolean(normalizedDraft) &&
    !isAtTagLimit &&
    !normalizedSelectedTags.has(normalizedDraft);
  const availableSuggestions = isAtTagLimit
    ? []
    : filterTagSuggestions.filter(
        (tag) =>
          !normalizedSelectedTags.has(normalizeTagIdentity(tag.displayName))
      );
  const hasFilters =
    mediaType !== "all" || scoreFilter !== "all" || tagFilters.length > 0;

  function addTagFilter(tagName: string) {
    onAddTagFilter(tagName);
    tagInputRef.current?.focus();
  }

  return (
    <div className="view-options-fields">
      <fieldset>
        <legend>Media</legend>
        <RadioGroup
          className="view-options-choices view-options-media"
          aria-label="Media filters"
          value={mediaType}
          onValueChange={(value) => onSetMediaType(value as MediaTypeFilter)}
        >
          {mediaFilters.map((filter) => (
            <Label className="view-options-choice" key={filter.value}>
              <RadioGroupItem value={filter.value} />
              {filter.label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <fieldset>
        <legend>Score</legend>
        <RadioGroup
          className="view-options-choices"
          aria-label="Score filters"
          value={scoreFilter}
          onValueChange={(value) => onSetScoreFilter(value as ScoreFilter)}
        >
          {scoreFilters.map((filter) => (
            <Label className="view-options-choice" key={filter.value}>
              <RadioGroupItem value={filter.value} />
              {filter.label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="view-options-tags">
        <div className="view-options-field-heading">
          <Label htmlFor="library-tag-filter-input">Tags</Label>
          {tagFilters.length > 1 ? <small>Match all</small> : null}
        </div>
        {tagFilters.length ? (
          <div className="view-options-tag-list" aria-label="Selected tags">
            {tagFilters.map((tag) => (
              <Button
                className="view-options-tag"
                type="button"
                size="sm"
                variant="secondary"
                aria-label={`Remove ${tag} tag filter`}
                key={tag}
                onClick={() => onRemoveTagFilter(tag)}
              >
                <span>#{tag}</span>
                <X aria-hidden="true" />
              </Button>
            ))}
          </div>
        ) : null}
        <div className="view-options-tag-input">
          <Input
            id="library-tag-filter-input"
            ref={tagInputRef}
            value={tagFilterDraft}
            placeholder={isAtTagLimit ? "Tag limit reached" : "Type a tag"}
            maxLength={MAX_TAG_FILTER_LENGTH}
            disabled={isAtTagLimit}
            onChange={(event) => onSetTagFilterDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canAddTag) addTagFilter(tagFilterDraft);
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Add tag filter"
            disabled={!canAddTag}
            onClick={() => addTagFilter(tagFilterDraft)}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        {availableSuggestions.length ? (
          <div className="view-options-suggestions" aria-label="Suggested tags">
            {availableSuggestions.map((tag) => (
              <Button
                className="justify-start"
                type="button"
                variant="ghost"
                size="sm"
                key={tag.id}
                onClick={() => addTagFilter(tag.displayName)}
              >
                <Plus aria-hidden="true" />
                {tag.displayName}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {hasFilters ? (
        <Button
          className="view-options-clear"
          type="button"
          variant="ghost"
          onClick={onClearFilters}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
