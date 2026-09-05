import {
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
  RatingFilter,
  SortMode
} from "../../api/client";

export type ControlMenuId = "sort" | "layout" | "filters" | "actions";

export const sortOptions: Array<{ label: string; value: SortMode }> = [
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
  { label: "Filename", value: "filename" },
  { label: "Rating", value: "rating" },
  { label: "Random", value: "random" }
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

export const ratingFilters: Array<{
  label: string;
  value: RatingFilter;
  icon: LucideIcon;
}> = [
  { label: "All ratings", value: "all", icon: Rows3 },
  { label: "Favorites", value: "favorites", icon: Heart },
  { label: "Rated", value: "rated", icon: Star },
  { label: "Unrated", value: "unrated", icon: SlidersHorizontal }
];
