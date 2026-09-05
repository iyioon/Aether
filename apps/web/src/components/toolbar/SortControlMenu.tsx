import { Check, Rows3 } from "lucide-react";
import type { SortDirection, SortMode } from "../../api/client";
import { ToolbarMenu } from "./ToolbarMenu";
import { sortDirectionOptions, sortOptions } from "./library-control-options";

interface SortControlMenuProps {
  isOpen: boolean;
  sort: SortMode;
  sortDirection: SortDirection;
  sortLabel: string;
  sortSummary: string;
  onOpenChange: (isOpen: boolean) => void;
  onSetSort: (sort: SortMode) => void;
  onSetSortDirection: (sortDirection: SortDirection) => void;
}

export function SortControlMenu({
  isOpen,
  sort,
  sortDirection,
  sortLabel,
  sortSummary,
  onOpenChange,
  onSetSort,
  onSetSortDirection
}: SortControlMenuProps) {
  return (
    <ToolbarMenu
      icon={Rows3}
      isOpen={isOpen}
      label="Sort"
      menuId="sort"
      valueLabel={sortSummary}
      onOpenChange={onOpenChange}
    >
      <div className="menu-section">
        <div className="menu-section-title">Sort by</div>
        <div
          className="menu-option-list"
          role="radiogroup"
          aria-label="Sort by"
        >
          {sortOptions.map((option) => (
            <button
              className={sort === option.value ? "menu-option active" : "menu-option"}
              type="button"
              key={option.value}
              role="radio"
              aria-checked={sort === option.value}
              onClick={() => onSetSort(option.value)}
            >
              <span>{option.label}</span>
              <span className="menu-check" aria-hidden="true">
                {sort === option.value ? <Check size={13} /> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      {sort !== "random" ? (
        <div className="menu-section">
          <div className="menu-section-heading">
            <div className="menu-section-title">Direction</div>
            <small>{sortLabel}</small>
          </div>
          <div
            className="menu-choice-grid sort-direction-choice-grid"
            role="radiogroup"
            aria-label="Sort direction"
          >
            {sortDirectionOptions.map((option) => {
              const Icon = option.icon;
              const isActive = sortDirection === option.value;

              return (
                <button
                  className={
                    isActive
                      ? "menu-choice menu-choice-with-icon active"
                      : "menu-choice menu-choice-with-icon"
                  }
                  type="button"
                  key={option.value}
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onSetSortDirection(option.value)}
                >
                  <span className="menu-choice-leading">
                    <span className="menu-choice-icon" aria-hidden="true">
                      <Icon size={14} />
                    </span>
                    <span>{option.label}</span>
                  </span>
                  <span className="menu-check" aria-hidden="true">
                    {isActive ? <Check size={13} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </ToolbarMenu>
  );
}
