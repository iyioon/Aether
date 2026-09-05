import { ShieldCheck } from "lucide-react";
import type { MediaTypeFilter, RatingFilter } from "../../api/client";
import {
  mediaFilters,
  ratingFilters
} from "../toolbar/library-control-options";
import {
  mediaTypeLabel,
  ratingFilterLabel
} from "./settings-formatters";
import { ChoiceGroup, IconChoice } from "./SettingsChoiceControls";
import { SettingsSection } from "./SettingsSection";

interface FilterSettingsSectionProps {
  mediaType: MediaTypeFilter;
  ratingFilter: RatingFilter;
  onSetMediaType: (mediaType: MediaTypeFilter) => void;
  onSetRatingFilter: (ratingFilter: RatingFilter) => void;
}

export function FilterSettingsSection({
  mediaType,
  ratingFilter,
  onSetMediaType,
  onSetRatingFilter
}: FilterSettingsSectionProps) {
  return (
    <SettingsSection
      icon={ShieldCheck}
      title="Filters"
      value={`${mediaTypeLabel(mediaType)} · ${ratingFilterLabel(ratingFilter)}`}
    >
      <ChoiceGroup label="Media" columns="three">
        {mediaFilters.map((filter) => {
          const Icon = filter.icon;
          return (
            <IconChoice
              active={mediaType === filter.value}
              icon={Icon}
              key={filter.value}
              label={filter.label}
              onClick={() => onSetMediaType(filter.value)}
            />
          );
        })}
      </ChoiceGroup>

      <ChoiceGroup label="Rating" columns="two">
        {ratingFilters.map((filter) => {
          const Icon = filter.icon;
          return (
            <IconChoice
              active={ratingFilter === filter.value}
              icon={Icon}
              key={filter.value}
              label={filter.label}
              onClick={() => onSetRatingFilter(filter.value)}
            />
          );
        })}
      </ChoiceGroup>
    </SettingsSection>
  );
}
