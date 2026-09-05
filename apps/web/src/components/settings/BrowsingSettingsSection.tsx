import {
  GalleryHorizontalEnd,
  Grid3X3,
  type LucideIcon
} from "lucide-react";
import type { SortDirection, SortMode } from "../../api/client";
import type { ViewMode } from "../library-state";
import {
  sortDirectionOptions,
  sortOptions
} from "../toolbar/library-control-options";
import {
  CheckMark,
  ChoiceGroup,
  IconChoice,
  TextChoice
} from "./SettingsChoiceControls";
import { SettingsSection } from "./SettingsSection";

interface BrowsingSettingsSectionProps {
  sort: SortMode;
  sortDirection: SortDirection;
  sortSummary: string;
  view: ViewMode;
  onSetSort: (sort: SortMode) => void;
  onSetSortDirection: (sortDirection: SortDirection) => void;
  onSetView: (view: ViewMode) => void;
}

const viewChoices: Array<{
  value: ViewMode;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "gallery",
    label: "Gallery",
    description: "Grid library",
    icon: Grid3X3
  },
  {
    value: "feed",
    label: "Feed",
    description: "Full-screen scroll",
    icon: GalleryHorizontalEnd
  }
];

export function BrowsingSettingsSection({
  sort,
  sortDirection,
  sortSummary,
  view,
  onSetSort,
  onSetSortDirection,
  onSetView
}: BrowsingSettingsSectionProps) {
  return (
    <SettingsSection
      icon={GalleryHorizontalEnd}
      title="Browsing"
      value={`${view === "gallery" ? "Gallery" : "Feed"} · ${sortSummary}`}
    >
      <ChoiceGroup label="View mode" columns="two">
        {viewChoices.map((choice) => {
          const Icon = choice.icon;
          return (
            <button
              className={
                view === choice.value
                  ? "settings-choice active"
                  : "settings-choice"
              }
              type="button"
              role="radio"
              aria-checked={view === choice.value}
              key={choice.value}
              onClick={() => onSetView(choice.value)}
            >
              <span className="settings-choice-icon" aria-hidden="true">
                <Icon size={15} />
              </span>
              <span>
                <strong>{choice.label}</strong>
                <small>{choice.description}</small>
              </span>
              <CheckMark active={view === choice.value} />
            </button>
          );
        })}
      </ChoiceGroup>

      <ChoiceGroup label="Sort by">
        {sortOptions.map((option) => (
          <TextChoice
            active={sort === option.value}
            key={option.value}
            label={option.label}
            onClick={() => onSetSort(option.value)}
          />
        ))}
      </ChoiceGroup>

      {sort !== "random" ? (
        <ChoiceGroup label="Direction" columns="two">
          {sortDirectionOptions.map((option) => {
            const Icon = option.icon;

            return (
              <IconChoice
                active={sortDirection === option.value}
                icon={Icon}
                key={option.value}
                label={option.label}
                onClick={() => onSetSortDirection(option.value)}
              />
            );
          })}
        </ChoiceGroup>
      ) : null}
    </SettingsSection>
  );
}
