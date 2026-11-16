import type {
  MediaTypeFilter,
  ScoreFilter,
  SortDirection,
  SortField
} from "../../api/client";

export const sortFieldOptions: Array<{
  label: string;
  value: SortField;
  defaultDirection: SortDirection;
  asc: string;
  desc: string;
}> = [
  {
    label: "Date modified",
    value: "date",
    defaultDirection: "desc",
    asc: "Oldest first",
    desc: "Newest first"
  },
  {
    label: "Filename",
    value: "filename",
    defaultDirection: "asc",
    asc: "A to Z",
    desc: "Z to A"
  },
  {
    label: "Score",
    value: "score",
    defaultDirection: "desc",
    asc: "Lowest first",
    desc: "Highest first"
  },
  {
    label: "Favorites",
    value: "favorite",
    defaultDirection: "desc",
    asc: "Not favorites first",
    desc: "Favorites first"
  },
  {
    label: "Tags",
    value: "tags",
    defaultDirection: "asc",
    asc: "A to Z",
    desc: "Z to A"
  },
  {
    label: "File size",
    value: "size",
    defaultDirection: "desc",
    asc: "Smallest first",
    desc: "Largest first"
  },
  {
    label: "Duration",
    value: "duration",
    defaultDirection: "desc",
    asc: "Shortest first",
    desc: "Longest first"
  },
  {
    label: "Media type",
    value: "type",
    defaultDirection: "asc",
    asc: "Images first",
    desc: "Videos first"
  }
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
