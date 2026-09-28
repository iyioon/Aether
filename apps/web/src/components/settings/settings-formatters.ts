import type { MediaTypeFilter, ScoreFilter } from "../../api/client";
import { mediaFilters, scoreFilters } from "../toolbar/library-control-options";
import type {
  AppearanceAccent,
  AppearanceAccentOption
} from "./useAppearanceSettings";

export function accentLabel(
  value: AppearanceAccent,
  options: AppearanceAccentOption[]
): string {
  return options.find((option) => option.value === value)?.label ?? "Graphite";
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

export function scoreFilterLabel(value: ScoreFilter): string {
  return (
    scoreFilters.find((option) => option.value === value)?.label ?? "All scores"
  );
}
