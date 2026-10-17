import type { SortDirection, SortMode } from "../../api/client";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { sortDirectionOptions, sortOptions } from "./library-control-options";

export interface SortControlsProps {
  sort: SortMode;
  sortDirection: SortDirection;
  onSetSort: (sort: SortMode) => void;
  onSetSortDirection: (sortDirection: SortDirection) => void;
}

export function SortControls({
  sort,
  sortDirection,
  onSetSort,
  onSetSortDirection
}: SortControlsProps) {
  return (
    <div className="view-options-fields">
      <fieldset>
        <legend>Sort by</legend>
        <RadioGroup
          className="view-options-choices"
          aria-label="Sort by"
          value={sort}
          onValueChange={(value) => onSetSort(value as SortMode)}
        >
          {sortOptions.map((option) => (
            <Label className="view-options-choice" key={option.value}>
              <RadioGroupItem value={option.value} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      {sort !== "random" ? (
        <fieldset>
          <legend>Direction</legend>
          <RadioGroup
            className="view-options-choices"
            aria-label="Sort direction"
            value={sortDirection}
            onValueChange={(value) =>
              onSetSortDirection(value as SortDirection)
            }
          >
            {sortDirectionOptions.map((option) => (
              <Label className="view-options-choice" key={option.value}>
                <RadioGroupItem value={option.value} />
                {option.label}
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}
    </div>
  );
}
