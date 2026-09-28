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
  TagRecord,
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
import { assetSearchQuery, searchNgramText } from "./search-text.js";

const FINAL_SCORE_SQL =
  "CASE WHEN ar.asset_id IS NOT NULL THEN MAX(0, ar.comparison_score + ar.manual_adjustment) ELSE COALESCE(aa.manual_score, 0) END";

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

  const tagFilters = [
    ...new Set(
      (options.tags ?? [])
        .map((tag) => normalizeTagSearch(tag))
        .filter(Boolean)
    )
  ];
  tagFilters.forEach((tagFilter, index) => {
    const parameterName = `tagFilter${index}`;
    parameters[parameterName] = tagFilter;
    filters.push(
      `EXISTS (
         SELECT 1
         FROM asset_tags at
         JOIN tags t ON t.id = at.tag_id
         WHERE at.asset_id = a.id AND t.normalized_name = @${parameterName}
       )`
    );
  });

  switch (options.scoreFilter ?? "all") {
    case "favorites":
      filters.push("COALESCE(aa.favorite, 0) = 1");
      break;
    case "ranked":
      filters.push(`${FINAL_SCORE_SQL} > 0`);
      break;
    case "unranked":
      filters.push(`${FINAL_SCORE_SQL} = 0`);
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
         LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
         LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
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
        ${FINAL_SCORE_SQL} AS final_score,
        ar.skill AS ranking_skill,
        ar.comparison_score AS ranking_comparison_score,
        ar.manual_adjustment AS ranking_manual_adjustment,
        ar.comparison_count AS ranking_comparison_count,
        COALESCE(aa.favorite, 0) AS favorite
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
        ${FINAL_SCORE_SQL} AS final_score,
        ar.skill AS ranking_skill,
        ar.comparison_score AS ranking_comparison_score,
        ar.manual_adjustment AS ranking_manual_adjustment,
        ar.comparison_count AS ranking_comparison_count,
        COALESCE(aa.favorite, 0) AS favorite
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
        ${FINAL_SCORE_SQL} AS final_score,
        ar.skill AS ranking_skill,
        ar.comparison_score AS ranking_comparison_score,
        ar.manual_adjustment AS ranking_manual_adjustment,
        ar.comparison_count AS ranking_comparison_count,
        COALESCE(aa.favorite, 0) AS favorite
      FROM assets a
      JOIN roots ON roots.id = a.root_id
      LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
      LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
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

export function updateAssetScore(
  db: AetherDatabase,
  input: ScoreUpdateInput
): AssetRecord | null {
  if (!getAsset(db, input.assetId)) {
    return null;
  }

  const current = db
    .prepare("SELECT manual_score, favorite FROM asset_annotations WHERE asset_id = ?")
    .get(input.assetId) as
    | { manual_score: number; favorite: number }
    | undefined;
  const ranking = db
    .prepare("SELECT comparison_score FROM asset_rankings WHERE asset_id = ?")
    .get(input.assetId) as { comparison_score: number } | undefined;
  const score =
    input.score !== undefined ? input.score : current?.manual_score ?? 0;
  const favorite =
    input.favorite !== undefined ? input.favorite : current?.favorite === 1;

  db.prepare(`
    INSERT INTO asset_annotations (asset_id, manual_score, favorite, updated_at)
    VALUES (@assetId, @score, @favorite, @updatedAt)
    ON CONFLICT(asset_id) DO UPDATE SET
      manual_score = excluded.manual_score,
      favorite = excluded.favorite,
      updated_at = excluded.updated_at
  `).run({
    assetId: input.assetId,
    score,
    favorite: favorite ? 1 : 0,
    updatedAt: input.updatedAt
  });

  if (ranking && input.score !== undefined) {
    db.prepare(`
      UPDATE asset_rankings
      SET manual_adjustment = @manualAdjustment, updated_at = @updatedAt
      WHERE asset_id = @assetId
    `).run({
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
  if (!getAsset(db, assetId)) {
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
    for (const assetId of assetIds) {
      updateAssetScore(db, {
        assetId,
        score: input.score,
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

function defaultSortDirectionFor(sort: AssetListOptions["sort"]): "desc" | "asc" {
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
  const findAsset = db.prepare("SELECT id FROM assets WHERE id = ?");

  return assetIds.every((assetId) => Boolean(findAsset.get(assetId)));
}
