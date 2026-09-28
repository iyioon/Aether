import type { MediaType } from "./media-types.js";

export interface FolderRecord {
  id: string;
  rootId: string;
  parentId: string | null;
  relativePath: string;
  name: string;
  assetCount: number;
}

export interface AssetRecord {
  id: string;
  folderId: string | null;
  name: string;
  extension: string;
  mediaType: MediaType;
  mimeType: string | null;
  sizeBytes: number;
  mtimeMs: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  codec: string | null;
  status: string;
  error: string | null;
  score: number;
  ranking: AssetRankingRecord | null;
  favorite: boolean;
  tags: TagRecord[];
}

export interface AssetRankingRecord {
  skill: number;
  comparisonScore: number;
  manualAdjustment: number;
  comparisonCount: number;
}

export interface AssetSourceRecord extends AssetRecord {
  rootId: string;
  rootRealPath: string;
  relativePath: string;
}

export interface AssetPage {
  items: AssetRecord[];
  page: {
    offset: number;
    limit: number;
    total: number;
  };
}

export interface DerivativeRecord {
  id: string;
  assetId: string;
  kind: string;
  width: number | null;
  height: number | null;
  path: string;
  sourceMtimeMs: number;
  status: string;
  error: string | null;
}

export interface UpsertDerivativeInput {
  id: string;
  assetId: string;
  kind: string;
  width: number | null;
  height: number | null;
  path: string;
  sourceMtimeMs: number;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface TagRecord {
  id: string;
  normalizedName: string;
  displayName: string;
  usageCount: number;
}

export interface ScoreUpdateInput {
  assetId: string;
  score?: number;
  favorite?: boolean;
  updatedAt: string;
}

export interface BatchScoreUpdateInput {
  assetIds: string[];
  score?: number;
  favorite?: boolean;
  updatedAt: string;
}

export interface BatchScoreUpdateResult {
  assets: AssetRecord[];
  updated: number;
}

export interface BatchTagUpdateInput {
  assetIds: string[];
  tags: string[];
  mode: "add" | "replace";
  now?: string;
}

export interface BatchTagUpdateResult {
  tags: TagRecord[];
  updated: number;
}

export interface AssetMediaMetadataInput {
  assetId: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  codec: string | null;
}

export interface AssetListOptions {
  folderId: string;
  offset: number;
  limit: number;
  sort: "date" | "filename" | "score" | "random";
  sortDirection?: "desc" | "asc";
  type: "all" | MediaType;
  recursive: boolean;
  search?: string;
  tags?: string[];
  scoreFilter?: "all" | "favorites" | "ranked" | "unranked";
}

export interface UpsertFolderInput {
  rootId: string;
  parentId: string | null;
  relativePath: string;
  name: string;
  seenAt: string;
}

export interface UpsertAssetInput {
  rootId: string;
  folderId: string;
  relativePath: string;
  name: string;
  extension: string;
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  fingerprint: string;
  seenAt: string;
}

export interface FolderRow {
  id: string;
  root_id: string;
  parent_id: string | null;
  relative_path: string;
  name: string;
  asset_count: number;
}

export interface AssetRow {
  id: string;
  root_id?: string;
  root_real_path?: string;
  relative_path?: string;
  folder_id: string | null;
  name: string;
  extension: string;
  media_type: MediaType;
  mime_type: string | null;
  size_bytes: number;
  mtime_ms: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  codec: string | null;
  status: string;
  error: string | null;
  final_score: number;
  ranking_skill: number | null;
  ranking_comparison_score: number | null;
  ranking_manual_adjustment: number | null;
  ranking_comparison_count: number | null;
  favorite: number;
}

export interface ComparisonDecisionInput {
  leftAssetId: string;
  rightAssetId: string;
  winnerAssetId: string;
  createdAt: string;
}

export interface ComparisonDecisionResult {
  eventId: string;
  assetIds: [string, string];
  replacedDecision: boolean;
}

export interface ComparisonUndoResult {
  eventId: string;
  assetIds: [string, string];
  restoredDecision: boolean;
}

export interface ComparisonPairResult {
  leftAssetId: string;
  rightAssetId: string;
  progress: {
    candidateCount: number;
    rankedCount: number;
    decidedPairCount: number;
  };
}

export interface DerivativeRow {
  id: string;
  asset_id: string;
  kind: string;
  width: number | null;
  height: number | null;
  path: string;
  source_mtime_ms: number;
  status: string;
  error: string | null;
}

export interface TagRow {
  id: string;
  normalized_name: string;
  display_name: string;
  usage_count: number;
}

export interface AssetTagRow extends TagRow {
  asset_id: string;
}

export interface NormalizedTag {
  id: string;
  normalizedName: string;
  displayName: string;
}
