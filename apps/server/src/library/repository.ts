import type { AetherDatabase } from "../db/database.js";
import {
  ASSET_SOURCE_SELECT_COLUMNS,
  ASSET_SELECT_COLUMNS,
  buildAssetFilterQuery,
  FINAL_SCORE_SQL
} from "./asset-query.js";
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
import { getAssetTags, getTagsByAssetId } from "./repository-tags.js";
export {
  resetLibraryData,
  type LibraryDataResetOptions,
  type LibraryDataResetResult
} from "./repository-reset.js";
export {
  getAssetTags,
  InvalidTagError,
  setAssetTags,
  suggestTags,
  updateAssetTagsBatch
} from "./repository-tags.js";
export {
  ComparisonConflictError,
  getNextComparisonPair,
  recordComparisonDecision,
  resetAssetComparisons,
  undoComparisonDecision
} from "./repository-comparisons.js";
import type {
  AssetListOptions,
  AssetPage,
  AssetRecord,
  AssetRow,
  AssetSourceRecord,
  BatchScoreUpdateInput,
  BatchScoreUpdateResult,
  ScoreUpdateInput,
  UpsertAssetInput
} from "./repository-types.js";
export type {
  AssetListOptions,
  AssetMediaMetadataInput,
  AssetPage,
  AssetRankingRecord,
  AssetRecord,
  AssetSourceRecord,
  BatchScoreUpdateInput,
  BatchScoreUpdateResult,
  BatchTagUpdateInput,
  BatchTagUpdateResult,
  ComparisonDecisionInput,
  ComparisonDecisionResult,
  ComparisonPairResult,
  ComparisonUndoResult,
  DerivativeRecord,
  FolderRecord,
  ScoreUpdateInput,
  TagRecord,
  UpsertAssetInput,
  UpsertDerivativeInput,
  UpsertFolderInput
} from "./repository-types.js";
import { searchNgramText } from "./search-text.js";

export function assetIdFor(rootId: string, relativePath: string): string {
  return stableId("asset", rootId, relativePath);
}

export function upsertAsset(
  db: AetherDatabase,
  input: UpsertAssetInput
): string {
  const id = assetIdFor(input.rootId, input.relativePath);
  const upsert = db.prepare(
    `
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
  `
  );
  const transaction = db.transaction(() => {
    upsert.run({
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
  });
  transaction();

  return id;
}

/**
 * Marks an indexed asset as seen without rebuilding its search row when none
 * of the searchable or media-identifying fields changed. Returning the stored
 * dimensions lets repeat scans avoid decoding unchanged images again.
 */
export function touchAssetIfUnchanged(
  db: AetherDatabase,
  input: UpsertAssetInput
): { id: string; width: number | null; height: number | null } | null {
  const id = assetIdFor(input.rootId, input.relativePath);
  const existing = db
    .prepare(
      `SELECT id, width, height
       FROM assets
       WHERE id = @id
         AND root_id = @rootId
         AND folder_id = @folderId
         AND relative_path = @relativePath
         AND name = @name
         AND extension = @extension
         AND media_type = @mediaType
         AND mime_type IS @mimeType
         AND size_bytes = @sizeBytes
         AND mtime_ms = @mtimeMs
         AND fingerprint IS @fingerprint`
    )
    .get({
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
      fingerprint: input.fingerprint
    }) as
    { id: string; width: number | null; height: number | null } | undefined;

  if (!existing) {
    return null;
  }

  db.prepare(
    `UPDATE assets
     SET indexed_at = @seenAt, status = 'indexed', error = NULL
     WHERE id = @id`
  ).run({ id, seenAt: input.seenAt });

  return existing;
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
  db.prepare(
    `
    INSERT INTO asset_search
      (asset_id, root_id, folder_id, name, relative_path, search_ngrams)
    VALUES
      (@id, @rootId, @folderId, @name, @relativePath, @searchNgrams)
  `
  ).run({
    id: input.id,
    rootId: input.rootId,
    folderId: input.folderId,
    name: input.name,
    relativePath: input.relativePath,
    searchNgrams: searchNgramText(`${input.name} ${input.relativePath}`)
  });
}

/**
 * Repairs search rows left incomplete by an interrupted scan from an older
 * release. Current asset/search writes are transactional, so the inexpensive
 * count check is sufficient during normal scans and avoids per-asset FTS work.
 */
export function repairAssetSearchIndexForRoot(
  db: AetherDatabase,
  rootId: string
): void {
  const assetCount = db
    .prepare("SELECT COUNT(*) AS count FROM assets WHERE root_id = ?")
    .get(rootId) as { count: number };
  const searchCount = db
    .prepare("SELECT COUNT(*) AS count FROM asset_search WHERE root_id = ?")
    .get(rootId) as { count: number };

  if (assetCount.count === searchCount.count) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM asset_search WHERE root_id = ?").run(rootId);
    db.prepare(
      `INSERT INTO asset_search
        (asset_id, root_id, folder_id, name, relative_path, search_ngrams)
       SELECT
         id,
         root_id,
         folder_id,
         name,
         relative_path,
         aether_search_ngrams(name || ' ' || relative_path)
       FROM assets
       WHERE root_id = ?`
    ).run(rootId);
  });

  transaction();
}

export function listAssets(
  db: AetherDatabase,
  options: AssetListOptions
): AssetPage | null {
  const folder = getFolder(db, options.folderId);

  if (!folder) {
    return null;
  }

  const { parameters: filterParameters, whereClause } = buildAssetFilterQuery(
    folder,
    options
  );
  const parameters = {
    ...filterParameters,
    limit: options.limit,
    offset: options.offset
  };
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM assets a
         LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
         LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
         WHERE ${whereClause}`
      )
      .get(parameters) as { total: number }
  ).total;

  const rows = db
    .prepare(
      `SELECT
        ${ASSET_SELECT_COLUMNS}
      FROM assets a
      LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
      LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
      WHERE ${whereClause}
      ORDER BY ${orderClauseFor(
        options.sort,
        options.sortDirection ?? defaultSortDirectionFor(options.sort)
      )}
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

export function getAsset(
  db: AetherDatabase,
  assetId: string
): AssetRecord | null {
  const row = db
    .prepare(
      `SELECT
        ${ASSET_SELECT_COLUMNS}
      FROM assets a
      LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
      LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
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
        ${ASSET_SOURCE_SELECT_COLUMNS}
      FROM assets a
      JOIN roots ON roots.id = a.root_id
      LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
      LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
      WHERE a.id = ?`
    )
    .get(assetId) as AssetRow | undefined;

  if (
    !row ||
    !row.root_id ||
    !row.root_real_path ||
    row.relative_path === undefined
  ) {
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

export function updateAssetScore(
  db: AetherDatabase,
  input: ScoreUpdateInput
): AssetRecord | null {
  if (!assetExists(db, input.assetId)) {
    return null;
  }

  const current = db
    .prepare(
      "SELECT manual_score, favorite FROM asset_annotations WHERE asset_id = ?"
    )
    .get(input.assetId) as
    { manual_score: number; favorite: number } | undefined;
  const ranking = db
    .prepare("SELECT comparison_score FROM asset_rankings WHERE asset_id = ?")
    .get(input.assetId) as { comparison_score: number } | undefined;
  const score =
    input.score !== undefined ? input.score : (current?.manual_score ?? 0);
  const favorite =
    input.favorite !== undefined ? input.favorite : current?.favorite === 1;

  db.prepare(
    `
    INSERT INTO asset_annotations (asset_id, manual_score, favorite, updated_at)
    VALUES (@assetId, @score, @favorite, @updatedAt)
    ON CONFLICT(asset_id) DO UPDATE SET
      manual_score = excluded.manual_score,
      favorite = excluded.favorite,
      updated_at = excluded.updated_at
  `
  ).run({
    assetId: input.assetId,
    score,
    favorite: favorite ? 1 : 0,
    updatedAt: input.updatedAt
  });

  if (ranking && input.score !== undefined) {
    db.prepare(
      `
      UPDATE asset_rankings
      SET manual_adjustment = @manualAdjustment, updated_at = @updatedAt
      WHERE asset_id = @assetId
    `
    ).run({
      assetId: input.assetId,
      manualAdjustment: input.score - ranking.comparison_score,
      updatedAt: input.updatedAt
    });
  }

  return getAsset(db, input.assetId);
}

export function clearAssetManualAdjustment(
  db: AetherDatabase,
  assetId: string,
  updatedAt: string
): AssetRecord | null {
  if (!assetExists(db, assetId)) {
    return null;
  }

  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE asset_annotations
       SET manual_score = 0, updated_at = ?
       WHERE asset_id = ?`
    ).run(updatedAt, assetId);
    db.prepare(
      `UPDATE asset_rankings
       SET manual_adjustment = 0, updated_at = ?
       WHERE asset_id = ?`
    ).run(updatedAt, assetId);
  });

  transaction();
  return getAsset(db, assetId);
}

export function updateAssetScoresBatch(
  db: AetherDatabase,
  input: BatchScoreUpdateInput
): BatchScoreUpdateResult | null {
  const assetIds = uniqueAssetIds(input.assetIds);

  if (!allAssetsExist(db, assetIds)) {
    return null;
  }

  const transaction = db.transaction(() => {
    const getAnnotation = db.prepare(
      "SELECT manual_score, favorite FROM asset_annotations WHERE asset_id = ?"
    );
    const getRanking = db.prepare(
      "SELECT comparison_score FROM asset_rankings WHERE asset_id = ?"
    );
    const upsertAnnotation = db.prepare(
      `INSERT INTO asset_annotations (asset_id, manual_score, favorite, updated_at)
       VALUES (@assetId, @score, @favorite, @updatedAt)
       ON CONFLICT(asset_id) DO UPDATE SET
         manual_score = excluded.manual_score,
         favorite = excluded.favorite,
         updated_at = excluded.updated_at`
    );
    const updateRanking = db.prepare(
      `UPDATE asset_rankings
       SET manual_adjustment = @manualAdjustment, updated_at = @updatedAt
       WHERE asset_id = @assetId`
    );

    for (const assetId of assetIds) {
      const current =
        input.score === undefined || input.favorite === undefined
          ? (getAnnotation.get(assetId) as
              { manual_score: number; favorite: number } | undefined)
          : undefined;
      const ranking =
        input.score === undefined
          ? undefined
          : (getRanking.get(assetId) as
              { comparison_score: number } | undefined);
      const score = input.score ?? current?.manual_score ?? 0;
      const favorite = input.favorite ?? current?.favorite === 1;

      upsertAnnotation.run({
        assetId,
        score,
        favorite: favorite ? 1 : 0,
        updatedAt: input.updatedAt
      });

      if (ranking && input.score !== undefined) {
        updateRanking.run({
          assetId,
          manualAdjustment: input.score - ranking.comparison_score,
          updatedAt: input.updatedAt
        });
      }
    }
  });

  transaction();

  return {
    assets: getAssetsByIds(db, assetIds),
    updated: assetIds.length
  };
}

function getAssetsByIds(db: AetherDatabase, assetIds: string[]): AssetRecord[] {
  if (assetIds.length === 0) {
    return [];
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT
        ${ASSET_SELECT_COLUMNS}
       FROM assets a
       LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
       LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
       WHERE a.id IN (${placeholders})`
    )
    .all(...assetIds) as AssetRow[];
  const assetsById = new Map(
    attachTagsToAssets(db, rows.map(mapAssetRow)).map((asset) => [
      asset.id,
      asset
    ])
  );

  return assetIds.flatMap((assetId) => {
    const asset = assetsById.get(assetId);
    return asset ? [asset] : [];
  });
}

function defaultSortDirectionFor(
  sort: AssetListOptions["sort"]
): "desc" | "asc" {
  return sort === "filename" ? "asc" : "desc";
}

function orderClauseFor(
  sort: AssetListOptions["sort"],
  sortDirection: NonNullable<AssetListOptions["sortDirection"]>
): string {
  const direction = sortDirection === "asc" ? "ASC" : "DESC";
  switch (sort) {
    case "filename":
      return `a.name COLLATE NOCASE ${direction}, a.mtime_ms DESC`;
    case "score":
      return `${FINAL_SCORE_SQL} = 0 ASC, ${FINAL_SCORE_SQL} ${direction}, COALESCE(aa.favorite, 0) DESC, a.mtime_ms DESC`;
    case "random":
      return "RANDOM()";
    case "date":
    default:
      return `a.mtime_ms ${direction}, a.name COLLATE NOCASE ASC`;
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
  if (assetIds.length === 0) {
    return true;
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS asset_count
       FROM assets
       WHERE id IN (${placeholders})`
    )
    .get(...assetIds) as { asset_count: number };

  return row.asset_count === assetIds.length;
}

function assetExists(db: AetherDatabase, assetId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM assets WHERE id = ?").get(assetId));
}
