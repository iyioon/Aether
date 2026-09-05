export type FolderScanState =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed";

export interface FolderTreeItem {
  id: string;
  parentId: string | null;
  label: string;
  assetCount: number;
  depth: number;
  hasChildren: boolean;
}
