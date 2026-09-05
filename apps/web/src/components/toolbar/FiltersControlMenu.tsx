import { Check, SlidersHorizontal, Tags, X } from "lucide-react";
import type {
  MediaTypeFilter,
  RatingFilter,
  TagRecord
} from "../../api/client";
import { ToolbarMenu } from "./ToolbarMenu";
import {
  mediaFilters,
  ratingFilters
} from "./library-control-options";

interface FiltersControlMenuProps {
  activeFilterLabels: string[];
  filterSummary: string;
  filterTagSuggestions: TagRecord[];
  isOpen: boolean;
  mediaType: MediaTypeFilter;
  mediaTypeLabel: string;
  ratingFilter: RatingFilter;
  ratingFilterLabel: string;
  tagFilter: string;
  tagFilterDraft: string;
  onApplyTagFilter: (tagName: string) => void;
  onClearLibraryFilters: () => void;
  onClearTagFilter: () => void;
  onOpenChange: (isOpen: boolean) => void;
  onSetMediaType: (mediaType: MediaTypeFilter) => void;
  onSetOpenControlMenu: (menu: null) => void;
  onSetRatingFilter: (ratingFilter: RatingFilter) => void;
  onSetTagFilterDraft: (value: string) => void;
}

export function FiltersControlMenu({
  activeFilterLabels,
  filterSummary,
  filterTagSuggestions,
  isOpen,
  mediaType,
  mediaTypeLabel,
  ratingFilter,
  ratingFilterLabel,
  tagFilter,
  tagFilterDraft,
  onApplyTagFilter,
  onClearLibraryFilters,
  onClearTagFilter,
  onOpenChange,
  onSetMediaType,
  onSetOpenControlMenu,
  onSetRatingFilter,
  onSetTagFilterDraft
}: FiltersControlMenuProps) {
  function applyTagFilterAndClose(tagName: string) {
    onApplyTagFilter(tagName);
    onSetOpenControlMenu(null);
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
      {activeFilterLabels.length ? (
        <div className="menu-section active-filter-section">
          <div className="menu-section-heading">
            <div className="menu-section-title">Active</div>
            <small>{activeFilterLabels.length}</small>
          </div>
          <div className="active-filter-summary" aria-label="Active filters">
            {mediaType !== "all" ? (
              <button
                type="button"
                className="active-filter-token"
                aria-label={`Clear ${mediaTypeLabel} filter`}
                onClick={() => onSetMediaType("all")}
              >
                <span>{mediaTypeLabel}</span>
                <X size={13} />
              </button>
            ) : null}
            {ratingFilter !== "all" ? (
              <button
                type="button"
                className="active-filter-token"
                aria-label={`Clear ${ratingFilterLabel} filter`}
                onClick={() => onSetRatingFilter("all")}
              >
                <span>{ratingFilterLabel}</span>
                <X size={13} />
              </button>
            ) : null}
            {tagFilter ? (
              <button
                type="button"
                className="active-filter-token"
                aria-label={`Clear tag filter ${tagFilter}`}
                onClick={onClearTagFilter}
              >
                <span>#{tagFilter}</span>
                <X size={13} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="menu-section">
        <div className="menu-section-heading">
          <div className="menu-section-title">Media</div>
          <small>{mediaTypeLabel}</small>
        </div>
        <div
          className="filter-option-list"
          role="radiogroup"
          aria-label="Media filters"
        >
          {mediaFilters.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={mediaType === filter.value}
                className={
                  mediaType === filter.value
                    ? "filter-option active"
                    : "filter-option"
                }
                key={filter.value}
                onClick={() => onSetMediaType(filter.value)}
              >
                <span className="filter-option-leading">
                  <span className="filter-option-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className="filter-option-label">{filter.label}</span>
                </span>
                <span className="filter-option-state" aria-hidden="true">
                  {mediaType === filter.value ? <Check size={13} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="menu-section">
        <div className="menu-section-heading">
          <div className="menu-section-title">Rating</div>
          <small>{ratingFilterLabel}</small>
        </div>
        <div
          className="filter-option-list"
          role="radiogroup"
          aria-label="Rating filters"
        >
          {ratingFilters.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={ratingFilter === filter.value}
                className={
                  ratingFilter === filter.value
                    ? "filter-option active"
                    : "filter-option"
                }
                key={filter.value}
                onClick={() => onSetRatingFilter(filter.value)}
              >
                <span className="filter-option-leading">
                  <span className="filter-option-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className="filter-option-label">{filter.label}</span>
                </span>
                <span className="filter-option-state" aria-hidden="true">
                  {ratingFilter === filter.value ? <Check size={13} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="menu-section tag-filter-section">
        <div className="menu-section-heading">
          <div className="menu-section-title">Tag</div>
          <small>{tagFilter ? `#${tagFilter}` : "Any tag"}</small>
        </div>
        {tagFilter ? (
          <button
            type="button"
            className="active-filter-token selected-tag-token"
            aria-label={`Clear tag filter ${tagFilter}`}
            onClick={onClearTagFilter}
          >
            <span>#{tagFilter}</span>
            <X size={13} />
          </button>
        ) : null}
        <div className="tag-filter-control menu-field">
          <label htmlFor="library-tag-filter-input">Find tag</label>
          <div className="filter-input-wrap">
            <Tags size={15} />
            <input
              id="library-tag-filter-input"
              value={tagFilterDraft}
              placeholder="Any tag"
              maxLength={48}
              onChange={(event) => onSetTagFilterDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyTagFilterAndClose(tagFilterDraft);
                }
              }}
            />
            {tagFilter ? (
              <button
                type="button"
                aria-label="Clear tag filter"
                title="Clear tag filter"
                onClick={onClearTagFilter}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          {filterTagSuggestions.length ? (
            <div className="filter-suggestions">
              {filterTagSuggestions.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => applyTagFilterAndClose(tag.displayName)}
                >
                  {tag.displayName}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="control-menu-footer">
        <button
          className="menu-secondary-action"
          type="button"
          disabled={!activeFilterLabels.length}
          onClick={onClearLibraryFilters}
        >
          Clear all
        </button>
        <button
          className="menu-primary-action"
          type="button"
          onClick={() => onSetOpenControlMenu(null)}
        >
          Done
        </button>
      </div>
    </ToolbarMenu>
  );
}
