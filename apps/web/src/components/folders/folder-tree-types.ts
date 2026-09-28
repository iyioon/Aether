export type FolderScanState =
  "idle" | "starting" | "running" | "completed" | "failed";

export type FolderSortMode =
  "name-asc" | "name-desc" | "items-desc" | "items-asc";

export interface FolderTreeItem {
  id: string;
  parentId: string | null;
  label: string;
  assetCount: number;
  depth: number;
  hasChildren: boolean;
}
