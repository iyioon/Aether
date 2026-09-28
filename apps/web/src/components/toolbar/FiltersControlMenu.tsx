import { useRef } from "react";
import { Plus, SlidersHorizontal, Tags, X } from "lucide-react";
import type {
  MediaTypeFilter,
  ScoreFilter,
  TagRecord
} from "../../api/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  MAX_TAG_FILTER_LENGTH,
  MAX_TAG_FILTERS,
  normalizeTagIdentity
} from "../library-state";
import { ToolbarMenu } from "./ToolbarMenu";
import {
  mediaFilters,
  scoreFilters
} from "./library-control-options";

interface FiltersControlMenuProps {
  filterSummary: string;
  filterTagSuggestions: TagRecord[];
  isOpen: boolean;
  mediaType: MediaTypeFilter;
  mediaTypeLabel: string;
  scoreFilter: ScoreFilter;
  scoreFilterLabel: string;
  tagFilters: string[];
  tagFilterDraft: string;
  onAddTagFilter: (tagName: string) => void;
  onClearTagFilters: () => void;
  onOpenChange: (isOpen: boolean) => void;
  onSetMediaType: (mediaType: MediaTypeFilter) => void;
  onRemoveTagFilter: (tagName: string) => void;
  onSetScoreFilter: (scoreFilter: ScoreFilter) => void;
  onSetTagFilterDraft: (value: string) => void;
}

export function FiltersControlMenu({
  filterSummary,
  filterTagSuggestions,
  isOpen,
  mediaType,
  mediaTypeLabel,
  scoreFilter,
  scoreFilterLabel,
  tagFilters,
  tagFilterDraft,
  onAddTagFilter,
  onClearTagFilters,
  onOpenChange,
  onSetMediaType,
  onRemoveTagFilter,
  onSetScoreFilter,
  onSetTagFilterDraft
}: FiltersControlMenuProps) {
  const tagInputRef = useRef<HTMLInputElement>(null);
  const normalizedSelectedTags = new Set(
    tagFilters.map(normalizeTagIdentity)
  );
  const normalizedDraft = normalizeTagIdentity(tagFilterDraft);
  const isAtTagLimit = tagFilters.length >= MAX_TAG_FILTERS;
  const canAddTag =
    Boolean(normalizedDraft) &&
    !isAtTagLimit &&
    !normalizedSelectedTags.has(normalizedDraft);
  const availableSuggestions = isAtTagLimit
    ? []
    : filterTagSuggestions.filter(
        (tag) => !normalizedSelectedTags.has(normalizeTagIdentity(tag.displayName))
      );

  function addTagFilter(tagName: string) {
    onAddTagFilter(tagName);
    tagInputRef.current?.focus();
  }

  return (
    <ToolbarMenu
      align="end"
      className="filters-control"
      icon={SlidersHorizontal}
      isOpen={isOpen}
      label="Filters"
      menuId="filters"
      valueLabel={filterSummary}
      onOpenChange={onOpenChange}
    >
      <div className="mt-5 grid gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <Label>Media</Label>
          <small className="text-muted-foreground">{mediaTypeLabel}</small>
        </div>
        <RadioGroup
          className="gap-3"
          aria-label="Media filters"
          value={mediaType}
          onValueChange={(value) => onSetMediaType(value as MediaTypeFilter)}
        >
          {mediaFilters.map((filter) => {
            const Icon = filter.icon;
            return (
              <div className="flex items-center gap-3" key={filter.value}>
                <RadioGroupItem id={`media-${filter.value}`} value={filter.value} />
                <Label className="flex items-center gap-2" htmlFor={`media-${filter.value}`}>
                  <Icon className="size-4" />
                  {filter.label}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </div>

      <div className="mt-5 grid gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <Label>Score</Label>
          <small className="text-muted-foreground">{scoreFilterLabel}</small>
        </div>
        <RadioGroup
          className="gap-3"
          aria-label="Score filters"
          value={scoreFilter}
          onValueChange={(value) =>
            onSetScoreFilter(value as ScoreFilter)
          }
        >
          {scoreFilters.map((filter) => {
            const Icon = filter.icon;
            return (
              <div className="flex items-center gap-3" key={filter.value}>
                <RadioGroupItem id={`score-${filter.value}`} value={filter.value} />
                <Label className="flex items-center gap-2" htmlFor={`score-${filter.value}`}>
                  <Icon className="size-4" />
                  {filter.label}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </div>

      <div className="mt-5 grid gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="library-tag-filter-input">Tags</Label>
          <div className="flex items-center gap-2">
            <small className="text-muted-foreground">
              {tagFilters.length
                ? `${tagFilters.length} selected · Match all`
                : "Any tag"}
            </small>
            {tagFilters.length ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={onClearTagFilters}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid gap-2">
          {tagFilters.length ? (
            <div className="flex flex-wrap gap-1.5" aria-label="Selected tags">
              {tagFilters.map((tag) => (
                <Button
                  className="h-7 gap-1 rounded-full px-2 text-xs"
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={`Remove ${tag} tag filter`}
                  key={tag}
                  onClick={() => onRemoveTagFilter(tag)}
                >
                  #{tag}
                  <X />
                </Button>
              ))}
            </div>
          ) : null}
          <div className="relative">
            <Tags className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pr-10 pl-9 text-sm font-normal"
              id="library-tag-filter-input"
              ref={tagInputRef}
              value={tagFilterDraft}
              placeholder={isAtTagLimit ? "Tag limit reached" : "Type a tag"}
              maxLength={MAX_TAG_FILTER_LENGTH}
              disabled={isAtTagLimit}
              onChange={(event) => onSetTagFilterDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (canAddTag) {
                    addTagFilter(tagFilterDraft);
                  }
                }
              }}
            />
            <Button
              type="button"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              size="icon-sm"
              variant="ghost"
              aria-label="Add tag filter"
              disabled={!canAddTag}
              onClick={() => addTagFilter(tagFilterDraft)}
            >
              <Plus />
            </Button>
          </div>
          {availableSuggestions.length ? (
            <div className="grid gap-1">
              {availableSuggestions.map((tag) => (
                <Button
                  className="justify-start"
                  type="button"
                  variant="ghost"
                  size="sm"
                  key={tag.id}
                  onClick={() => addTagFilter(tag.displayName)}
                >
                  <Plus />
                  {tag.displayName}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

    </ToolbarMenu>
  );
}
