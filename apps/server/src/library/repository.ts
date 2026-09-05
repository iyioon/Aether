import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
export {
  getDerivative,
  updateAssetDimensions,
  updateAssetMediaMetadata,
  upsertDerivative
} from "./repository-derivatives.js";
import { getFolder } from "./repository-folders.js";
export {
  folderIdFor,
  getFolder,
  listFolders,
  refreshFolderAssetCounts,
  removeUnseenRootEntries,
  syncConfiguredRoots,
  upsertFolder
} from "./repository-folders.js";
import { mapAssetRow } from "./repository-mappers.js";
import {
  getAssetTags,
  getTagsByAssetId,
  normalizeTagSearch
} from "./repository-tags.js";
export {
  getAssetTags,
  InvalidTagError,
  setAssetTags,
  suggestTags,
  updateAssetTagsBatch
} from "./repository-tags.js";
import type {
  AssetListOptions,
  AssetPage,
  AssetRecord,
  AssetRow,
  AssetSourceRecord,
  BatchRatingUpdateInput,
  BatchRatingUpdateResult,
  RatingUpdateInput,
  TagRecord,
  UpsertAssetInput
} from "./repository-types.js";
export type {
  AssetListOptions,
  AssetMediaMetadataInput,
  AssetPage,
  AssetRecord,
  AssetSourceRecord,
  BatchRatingUpdateInput,
  BatchRatingUpdateResult,
  BatchTagUpdateInput,
  BatchTagUpdateResult,
  DerivativeRecord,
  FolderRecord,
  RatingUpdateInput,
  TagRecord,
  UpsertAssetInput,
  UpsertDerivativeInput,
  UpsertFolderInput
} from "./repository-types.js";
import { assetSearchQuery, searchNgramText } from "./search-text.js";

export function assetIdFor(rootId: string, relativePath: string): string {
  return stableId("asset", rootId, relativePath);
}

export function upsertAsset(db: AetherDatabase, input: UpsertAssetInput): string {
  const id = assetIdFor(input.rootId, input.relativePath);

  db.prepare(`
    INSERT INTO assets
      (id, root_id, folder_id, relative_path, name, extension, media_type, mime_type,
       size_bytes, mtime_ms, fingerprint, indexed_at, status, error)
    VALUES
      (@id, @rootId, @folderId, @relativePath, @name, @extension, @mediaType,
       @mimeType, @sizeBytes, @mtimeMs, @fingerprint, @seenAt, 'indexed', NULL)
    ON CONFLICT(root_id, relative_path) DO UPDATE SET
      folder_id = excluded.folder_id,
      name = excluded.name,
      extension = excluded.extension,
      media_type = excluded.media_type,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      mtime_ms = excluded.mtime_ms,
      fingerprint = excluded.fingerprint,
      width = CASE WHEN assets.fingerprint = excluded.fingerprint THEN assets.width ELSE NULL END,
      height = CASE WHEN assets.fingerprint = excluded.fingerprint THEN assets.height ELSE NULL END,
      duration_ms = CASE WHEN assets.fingerprint = excluded.fingerprint THEN assets.duration_ms ELSE NULL END,
      codec = CASE WHEN assets.fingerprint = excluded.fingerprint THEN assets.codec ELSE NULL END,
      indexed_at = excluded.indexed_at,
      status = 'indexed',
      error = NULL
  `).run({
    id,
    rootId: input.rootId,
    folderId: input.folderId,
    relativePath: input.relativePath,
    name: input.name,
    extension: input.extension,
    mediaType: input.mediaType,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs,
    fingerprint: input.fingerprint,
    seenAt: input.seenAt
  });
  syncAssetSearchRow(db, {
    id,
    rootId: input.rootId,
    folderId: input.folderId,
    name: input.name,
    relativePath: input.relativePath
  });

  return id;
}

function syncAssetSearchRow(
  db: AetherDatabase,
  input: {
    id: string;
    rootId: string;
    folderId: string;
    name: string;
    relativePath: string;
  }
): void {
  db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(input.id);
  db.prepare(`
    INSERT INTO asset_search
      (asset_id, root_id, folder_id, name, relative_path, search_ngrams)
    VALUES
      (@id, @rootId, @folderId, @name, @relativePath, @searchNgrams)
  `).run({
    id: input.id,
    rootId: input.rootId,
    folderId: input.folderId,
    name: input.name,
    relativePath: input.relativePath,
    searchNgrams: searchNgramText(`${input.name} ${input.relativePath}`)
  });
}

export function listAssets(
  db: AetherDatabase,
  options: AssetListOptions
): AssetPage | null {
  const folder = getFolder(db, options.folderId);

  if (!folder) {
    return null;
  }

  const parameters: Record<string, string | number> = {
    rootId: folder.rootId,
    folderId: options.folderId,
    limit: options.limit,
    offset: options.offset
  };
  const filters: string[] = ["a.root_id = @rootId"];

  if (options.recursive) {
    if (folder.relativePath !== "") {
      parameters.relativePath = folder.relativePath;
      parameters.relativePrefix = `${folder.relativePath}/%`;
      filters.push(
        "(a.relative_path = @relativePath OR a.relative_path LIKE @relativePrefix)"
      );
    }
  } else {
    filters.push("a.folder_id = @folderId");
  }

  if (options.type !== "all") {
    parameters.mediaType = options.type;
    filters.push("a.media_type = @mediaType");
  }

  const searchQuery = assetSearchQuery(options.search ?? "");
  if (searchQuery) {
    parameters.searchQuery = searchQuery;
    filters.push(
      "a.id IN (SELECT asset_id FROM asset_search WHERE asset_search MATCH @searchQuery)"
    );
  }

  const tagFilter = normalizeTagSearch(options.tag ?? "");
  if (tagFilter) {
    parameters.tagFilter = tagFilter;
    filters.push(
      `EXISTS (
         SELECT 1
         FROM asset_tags at
         JOIN tags t ON t.id = at.tag_id
         WHERE at.asset_id = a.id AND t.normalized_name = @tagFilter
       )`
    );
  }

  switch (options.ratingFilter ?? "all") {
    case "favorites":
      filters.push("COALESCE(r.favorite, 0) = 1");
      break;
    case "rated":
      filters.push("r.rating IS NOT NULL");
      break;
    case "unrated":
      filters.push("r.rating IS NULL");
      break;
    case "all":
    default:
      break;
  }

  const whereClause = filters.join(" AND ");
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM assets a
         LEFT JOIN ratings r ON r.asset_id = a.id
         WHERE ${whereClause}`
      )
      .get(parameters) as { total: number }
  ).total;

  const rows = db
    .prepare(
      `SELECT
        a.id,
        a.folder_id,
        a.name,
        a.extension,
        a.media_type,
        a.mime_type,
        a.size_bytes,
        a.mtime_ms,
        a.width,
        a.height,
        a.duration_ms,
        a.codec,
        a.status,
        a.error,
        r.rating,
        COALESCE(r.favorite, 0) AS favorite
      FROM assets a
      LEFT JOIN ratings r ON r.asset_id = a.id
      WHERE ${whereClause}
      ORDER BY ${orderClauseFor(options.sort)}
      LIMIT @limit OFFSET @offset`
    )
    .all(parameters) as AssetRow[];

  return {
    items: attachTagsToAssets(db, rows.map(mapAssetRow)),
    page: {
      offset: options.offset,
      limit: options.limit,
      total
    }
  };
}

export function getAsset(db: AetherDatabase, assetId: string): AssetRecord | null {
  const row = db
    .prepare(
      `SELECT
        a.id,
        a.folder_id,
        a.name,
        a.extension,
        a.media_type,
        a.mime_type,
        a.size_bytes,
        a.mtime_ms,
        a.width,
        a.height,
        a.duration_ms,
        a.codec,
        a.status,
        a.error,
        r.rating,
        COALESCE(r.favorite, 0) AS favorite
      FROM assets a
      LEFT JOIN ratings r ON r.asset_id = a.id
      WHERE a.id = ?`
    )
    .get(assetId) as AssetRow | undefined;

  return row ? attachTagsToAsset(db, mapAssetRow(row)) : null;
}

export function getAssetSource(
  db: AetherDatabase,
  assetId: string
): AssetSourceRecord | null {
  const row = db
    .prepare(
      `SELECT
        a.id,
        a.root_id,
        roots.real_path AS root_real_path,
        a.relative_path,
        a.folder_id,
        a.name,
        a.extension,
        a.media_type,
        a.mime_type,
        a.size_bytes,
        a.mtime_ms,
        a.width,
        a.height,
        a.duration_ms,
        a.codec,
        a.status,
        a.error,
        r.rating,
        COALESCE(r.favorite, 0) AS favorite
      FROM assets a
      JOIN roots ON roots.id = a.root_id
      LEFT JOIN ratings r ON r.asset_id = a.id
      WHERE a.id = ?`
    )
    .get(assetId) as AssetRow | undefined;

  if (!row || !row.root_id || !row.root_real_path || row.relative_path === undefined) {
    return null;
  }

  return {
    ...mapAssetRow(row),
    tags: getAssetTags(db, row.id),
    rootId: row.root_id,
    rootRealPath: row.root_real_path,
    relativePath: row.relative_path
  };
}

export function updateAssetRating(
  db: AetherDatabase,
  input: RatingUpdateInput
): AssetRecord | null {
  if (!getAsset(db, input.assetId)) {
    return null;
  }

  const current = db
    .prepare("SELECT rating, favorite FROM ratings WHERE asset_id = ?")
    .get(input.assetId) as
    | { rating: number | null; favorite: number }
    | undefined;
  const rating =
    input.rating !== undefined ? input.rating : current?.rating ?? null;
  const favorite =
    input.favorite !== undefined ? input.favorite : current?.favorite === 1;

  db.prepare(`
    INSERT INTO ratings (asset_id, rating, favorite, updated_at)
    VALUES (@assetId, @rating, @favorite, @updatedAt)
    ON CONFLICT(asset_id) DO UPDATE SET
      rating = excluded.rating,
      favorite = excluded.favorite,
      updated_at = excluded.updated_at
  `).run({
    assetId: input.assetId,
    rating,
    favorite: favorite ? 1 : 0,
    updatedAt: input.updatedAt
  });

  return getAsset(db, input.assetId);
}

export function updateAssetRatingsBatch(
  db: AetherDatabase,
  input: BatchRatingUpdateInput
): BatchRatingUpdateResult | null {
  const assetIds = uniqueAssetIds(input.assetIds);

  if (!allAssetsExist(db, assetIds)) {
    return null;
  }

  const transaction = db.transaction(() => {
    for (const assetId of assetIds) {
      updateAssetRating(db, {
        assetId,
        rating: input.rating,
        favorite: input.favorite,
        updatedAt: input.updatedAt
      });
    }
  });

  transaction();

  return {
    assets: assetIds
      .map((assetId) => getAsset(db, assetId))
      .filter((asset): asset is AssetRecord => Boolean(asset)),
    updated: assetIds.length
  };
}

function orderClauseFor(sort: AssetListOptions["sort"]): string {
  switch (sort) {
    case "oldest":
      return "a.mtime_ms ASC, a.name COLLATE NOCASE ASC";
    case "filename":
      return "a.name COLLATE NOCASE ASC, a.mtime_ms DESC";
    case "rating":
      return "COALESCE(r.favorite, 0) DESC, COALESCE(r.rating, 0) DESC, a.mtime_ms DESC";
    case "random":
      return "RANDOM()";
    case "newest":
    default:
      return "a.mtime_ms DESC, a.name COLLATE NOCASE ASC";
  }
}

function attachTagsToAsset(
  db: AetherDatabase,
  asset: AssetRecord
): AssetRecord {
  return {
    ...asset,
    tags: getAssetTags(db, asset.id)
  };
}

function attachTagsToAssets(
  db: AetherDatabase,
  assets: AssetRecord[]
): AssetRecord[] {
  if (assets.length === 0) {
    return assets;
  }

  const tagsByAssetId = getTagsByAssetId(
    db,
    assets.map((asset) => asset.id)
  );

  return assets.map((asset) => ({
    ...asset,
    tags: tagsByAssetId.get(asset.id) ?? []
  }));
}

function uniqueAssetIds(assetIds: string[]): string[] {
  return [...new Set(assetIds)];
}

function allAssetsExist(db: AetherDatabase, assetIds: string[]): boolean {
  const findAsset = db.prepare("SELECT id FROM assets WHERE id = ?");

  return assetIds.every((assetId) => Boolean(findAsset.get(assetId)));
}
