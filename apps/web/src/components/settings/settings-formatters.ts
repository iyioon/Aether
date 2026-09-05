import type { MediaTypeFilter, RatingFilter } from "../../api/client";
import {
  mediaFilters,
  ratingFilters
} from "../toolbar/library-control-options";
import type {
  AppearanceAccent,
  AppearanceAccentOption
} from "./useAppearanceSettings";

export function accentLabel(
  value: AppearanceAccent,
  options: AppearanceAccentOption[]
): string {
  return options.find((option) => option.value === value)?.label ?? "Sage";
}

export function boolLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return "-";
  }

  return value ? "Enabled" : "Disabled";
}

export function mediaTypeLabel(value: MediaTypeFilter): string {
  return mediaFilters.find((option) => option.value === value)?.label ?? "All";
}

export function ratingFilterLabel(value: RatingFilter): string {
  return (
    ratingFilters.find((option) => option.value === value)?.label ??
    "All ratings"
  );
}
