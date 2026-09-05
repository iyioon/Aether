import { CheckCircle2, Rows3 } from "lucide-react";
import type { SortMode } from "../../api/client";
import { ToolbarMenu } from "./ToolbarMenu";
import { sortOptions } from "./library-control-options";

interface SortControlMenuProps {
  isOpen: boolean;
  sort: SortMode;
  sortLabel: string;
  onOpenChange: (isOpen: boolean) => void;
  onSetSort: (sort: SortMode) => void;
}

export function SortControlMenu({
  isOpen,
  sort,
  sortLabel,
  onOpenChange,
  onSetSort
}: SortControlMenuProps) {
  return (
    <ToolbarMenu
      icon={Rows3}
      isOpen={isOpen}
      label="Sort"
      menuId="sort"
      valueLabel={sortLabel}
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
                {sort === option.value ? <CheckCircle2 size={15} /> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </ToolbarMenu>
  );
}
