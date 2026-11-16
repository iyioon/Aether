import { useId, useLayoutEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import type {
  MediaTypeFilter,
  ScoreFilter,
  TagRecord,
  TagMatch,
  TagStatus
} from "../../api/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "../ui/select";
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
  tagMatch: TagMatch;
  tagStatus: TagStatus;
  onSetTagMatch: (value: TagMatch) => void;
  onSetTagStatus: (value: TagStatus) => void;
  tagFilterDraft: string;
  onAddTagFilter: (tagName: string) => void;
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
  tagMatch,
  tagStatus,
  onSetTagMatch,
  onSetTagStatus,
  tagFilterDraft,
  onAddTagFilter,
  onSetMediaType,
  onRemoveTagFilter,
  onSetScoreFilter,
  onSetTagFilterDraft
}: FilterControlsProps) {
  const tagInputId = useId();
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const removedTagRef = useRef<{ removed: string; neighbor?: string } | null>(
    null
  );
  useLayoutEffect(() => {
    const pending = removedTagRef.current;
    if (!pending || tagFilters.includes(pending.removed)) return;
    removedTagRef.current = null;
    if (document.activeElement && document.activeElement !== document.body)
      return;
    const target = pending.neighbor
      ? tagButtonsRef.current.get(pending.neighbor)
      : null;
    (target ?? tagInputRef.current)?.focus({ preventScroll: true });
  }, [tagFilters]);
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

  function addTagFilter(tagName: string) {
    onAddTagFilter(tagName);
    tagInputRef.current?.focus();
  }

  return (
    <div className="view-options-fields">
      <div className="view-options-tags">
        <div className="view-options-field-heading">
          <Label htmlFor={tagInputId}>Tags</Label>
        </div>
        <Select
          value={tagStatus}
          onValueChange={(value) => onSetTagStatus(value as TagStatus)}
        >
          <SelectTrigger
            className="view-options-filter-select"
            aria-label="Tag status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="view-options-select-menu">
            <SelectItem value="all">All media</SelectItem>
            <SelectItem value="tagged">Tagged</SelectItem>
            <SelectItem value="untagged">Untagged</SelectItem>
          </SelectContent>
        </Select>
        {tagStatus !== "untagged" ? (
          <>
            {tagFilters.length > 1 ? (
              <Select
                value={tagMatch}
                onValueChange={(value) => onSetTagMatch(value as TagMatch)}
              >
                <SelectTrigger
                  className="view-options-filter-select"
                  aria-label="Tag matching"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="view-options-select-menu">
                  <SelectItem value="all">Match all tags</SelectItem>
                  <SelectItem value="any">Match any tag</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {tagFilters.length ? (
              <div className="view-options-tag-list" aria-label="Selected tags">
                {tagFilters.map((tag, index) => (
                  <Button
                    ref={(button) => {
                      if (button) tagButtonsRef.current.set(tag, button);
                      else tagButtonsRef.current.delete(tag);
                    }}
                    className="view-options-tag"
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label={`Remove ${tag} tag filter`}
                    key={tag}
                    onClick={(event) => {
                      if (document.activeElement === event.currentTarget)
                        removedTagRef.current = {
                          removed: tag,
                          neighbor:
                            tagFilters[index + 1] ?? tagFilters[index - 1]
                        };
                      onRemoveTagFilter(tag);
                    }}
                  >
                    <span>#{tag}</span>
                    <X aria-hidden="true" />
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="view-options-tag-input">
              <Input
                id={tagInputId}
                ref={tagInputRef}
                value={tagFilterDraft}
                placeholder={isAtTagLimit ? "Tag limit reached" : "Type a tag"}
                maxLength={MAX_TAG_FILTER_LENGTH}
                disabled={isAtTagLimit}
                onChange={(event) => onSetTagFilterDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!event.nativeEvent.isComposing && canAddTag)
                      addTagFilter(tagFilterDraft);
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
              <div
                className="view-options-suggestions"
                aria-label="Suggested tags"
              >
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
          </>
        ) : null}
      </div>
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
    </div>
  );
}
