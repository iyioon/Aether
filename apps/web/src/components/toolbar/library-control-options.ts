import type {
  MediaTypeFilter,
  ScoreFilter,
  SortDirection,
  SortMode
} from "../../api/client";

export const sortOptions: Array<{ label: string; value: SortMode }> = [
  { label: "Date", value: "date" },
  { label: "Filename", value: "filename" },
  { label: "Score", value: "score" },
  { label: "Random", value: "random" }
];

export const sortDirectionOptions: Array<{
  label: string;
  value: SortDirection;
}> = [
  { label: "Descending", value: "desc" },
  { label: "Ascending", value: "asc" }
];

export const mediaFilters: Array<{
  label: string;
  value: MediaTypeFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Images", value: "image" },
  { label: "Videos", value: "video" }
];

export const scoreFilters: Array<{
  label: string;
  value: ScoreFilter;
}> = [
  { label: "All scores", value: "all" },
  { label: "Favorites", value: "favorites" },
  { label: "Ranked", value: "ranked" },
  { label: "Unranked", value: "unranked" }
];
