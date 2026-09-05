import type {
  AssetRecord,
  AssetRow,
  DerivativeRecord,
  DerivativeRow,
  FolderRecord,
  FolderRow,
  TagRecord,
  TagRow
} from "./repository-types.js";

export function mapFolderRow(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    parentId: row.parent_id,
    relativePath: row.relative_path,
    name: row.name,
    assetCount: row.asset_count
  };
}

export function mapAssetRow(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    extension: row.extension,
    mediaType: row.media_type,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    codec: row.codec,
    status: row.status,
    error: row.error,
    rating: row.rating,
    favorite: row.favorite === 1,
    tags: []
  };
}

export function mapDerivativeRow(row: DerivativeRow): DerivativeRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    kind: row.kind,
    width: row.width,
    height: row.height,
    path: row.path,
    sourceMtimeMs: row.source_mtime_ms,
    status: row.status,
    error: row.error
  };
}

export function mapTagRow(row: TagRow): TagRecord {
  return {
    id: row.id,
    normalizedName: row.normalized_name,
    displayName: row.display_name,
    usageCount: row.usage_count
  };
}
