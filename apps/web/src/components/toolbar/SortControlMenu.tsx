import { Rows3 } from "lucide-react";
import type { SortDirection, SortMode } from "../../api/client";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
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
      <div className="mt-4 grid gap-3">
        <Label>Sort by</Label>
        <RadioGroup
          className="gap-3"
          aria-label="Sort by"
          value={sort}
          onValueChange={(value) => onSetSort(value as SortMode)}
        >
          {sortOptions.map((option) => (
            <div className="flex items-center gap-3" key={option.value}>
              <RadioGroupItem
                id={`sort-${option.value}`}
                value={option.value}
              />
              <Label htmlFor={`sort-${option.value}`}>{option.label}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {sort !== "random" ? (
        <div className="mt-5 grid gap-3 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Direction</Label>
            <small className="text-muted-foreground">{sortLabel}</small>
          </div>
          <RadioGroup
            className="gap-3"
            aria-label="Sort direction"
            value={sortDirection}
            onValueChange={(value) =>
              onSetSortDirection(value as SortDirection)
            }
          >
            {sortDirectionOptions.map((option) => {
              const Icon = option.icon;
              return (
                <div className="flex items-center gap-3" key={option.value}>
                  <RadioGroupItem
                    id={`direction-${option.value}`}
                    value={option.value}
                  />
                  <Label
                    className="flex items-center gap-2"
                    htmlFor={`direction-${option.value}`}
                  >
                    <Icon className="size-4" />
                    {option.label}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>
      ) : null}
    </ToolbarMenu>
  );
}
