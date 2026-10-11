import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Heart,
  Image,
  Rows3,
  SlidersHorizontal,
  Star,
  Video,
  type LucideIcon
} from "lucide-react";
import type {
  MediaTypeFilter,
  ScoreFilter,
  SortDirection,
  SortMode
} from "../../api/client";

export type ControlMenuId = "sort" | "layout" | "filters";

export const sortOptions: Array<{ label: string; value: SortMode }> = [
  { label: "Date", value: "date" },
  { label: "Filename", value: "filename" },
  { label: "Score", value: "score" },
  { label: "Random", value: "random" }
];

export const sortDirectionOptions: Array<{
  label: string;
  value: SortDirection;
  icon: LucideIcon;
}> = [
  { label: "Descending", value: "desc", icon: ArrowDownNarrowWide },
  { label: "Ascending", value: "asc", icon: ArrowUpNarrowWide }
];

export const mediaFilters: Array<{
  label: string;
  value: MediaTypeFilter;
  icon: LucideIcon;
}> = [
  { label: "All", value: "all", icon: Rows3 },
  { label: "Images", value: "image", icon: Image },
  { label: "Videos", value: "video", icon: Video }
];

export const scoreFilters: Array<{
  label: string;
  value: ScoreFilter;
  icon: LucideIcon;
}> = [
  { label: "All scores", value: "all", icon: Rows3 },
  { label: "Favorites", value: "favorites", icon: Heart },
  { label: "Ranked", value: "ranked", icon: Star },
  { label: "Unranked", value: "unranked", icon: SlidersHorizontal }
];
