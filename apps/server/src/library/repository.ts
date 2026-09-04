import type { MediaRootConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
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
  rating: number | null;
  favorite: boolean;
  tags: TagRecord[];
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

export interface RatingUpdateInput {
  assetId: string;
  rating?: number | null;
  favorite?: boolean;
  updatedAt: string;
}

export interface BatchRatingUpdateInput {
  assetIds: string[];
  rating?: number | null;
  favorite?: boolean;
  updatedAt: string;
}

export interface BatchRatingUpdateResult {
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
  sort: "newest" | "oldest" | "filename" | "rating" | "random";
  type: "all" | MediaType;
  recursive: boolean;
  search?: string;
  tag?: string;
  ratingFilter?: "all" | "favorites" | "rated" | "unrated";
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

interface FolderRow {
  id: string;
  root_id: string;
  parent_id: string | null;
  relative_path: string;
  name: string;
  asset_count: number;
}

interface AssetRow {
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
  rating: number | null;
  favorite: number;
}

interface DerivativeRow {
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

interface TagRow {
  id: string;
  normalized_name: string;
  display_name: string;
  usage_count: number;
}

interface AssetTagRow extends TagRow {
  asset_id: string;
}

interface NormalizedTag {
  id: string;
  normalizedName: string;
  displayName: string;
}

const MAX_TAGS_PER_ASSET = 50;
const MAX_TAG_LENGTH = 48;

export function folderIdFor(rootId: string, relativePath: string): string {
  return stableId("folder", rootId, relativePath);
}

export function assetIdFor(rootId: string, relativePath: string): string {
  return stableId("asset", rootId, relativePath);
}

export function syncConfiguredRoots(
  db: AetherDatabase,
  roots: MediaRootConfig[],
  now = new Date().toISOString()
): void {
  const upsertRoot = db.prepare(`
    INSERT INTO roots (id, label, real_path, created_at)
    VALUES (@id, @label, @realPath, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      real_path = excluded.real_path
  `);

  const upsertRootFolder = db.prepare(`
    INSERT INTO folders (id, root_id, parent_id, relative_path, name, asset_count, created_at, updated_at)
    VALUES (@id, @rootId, NULL, '', @name, 0, @createdAt, @updatedAt)
    ON CONFLICT(root_id, relative_path) DO UPDATE SET
      name = excluded.name,
      parent_id = NULL,
      updated_at = excluded.updated_at
  `);

  const configuredIds = new Set(roots.map((root) => root.id));
  const transaction = db.transaction(() => {
    for (const root of roots) {
      upsertRoot.run({
        id: root.id,
        label: root.label,
        realPath: root.realPath,
        createdAt: now
      });
      upsertRootFolder.run({
        id: folderIdFor(root.id, ""),
        rootId: root.id,
        name: root.label,
        createdAt: now,
        updatedAt: now
      });
    }

    const existingRoots = db.prepare("SELECT id FROM roots").all() as Array<{
      id: string;
    }>;
    const deleteRoot = db.prepare("DELETE FROM roots WHERE id = ?");

    for (const row of existingRoots) {
      if (!configuredIds.has(row.id)) {
        deleteRoot.run(row.id);
      }
    }
  });

  transaction();
}

export function upsertFolder(
  db: AetherDatabase,
  input: UpsertFolderInput
): string {
  const id = folderIdFor(input.rootId, input.relativePath);
  db.prepare(`
    INSERT INTO folders
      (id, root_id, parent_id, relative_path, name, asset_count, created_at, updated_at)
    VALUES
      (@id, @rootId, @parentId, @relativePath, @name, 0, @seenAt, @seenAt)
    ON CONFLICT(root_id, relative_path) DO UPDATE SET
      parent_id = excluded.parent_id,
      name = excluded.name,
      updated_at = excluded.updated_at
  `).run({
    id,
    rootId: input.rootId,
    parentId: input.parentId,
    relativePath: input.relativePath,
    name: input.name,
    seenAt: input.seenAt
  });

  return id;
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
    INSERT INTO asset_search (asset_id, root_id, folder_id, name, relative_path)
    VALUES (@id, @rootId, @folderId, @name, @relativePath)
  `).run({
    id: input.id,
    rootId: input.rootId,
    folderId: input.folderId,
    name: input.name,
    relativePath: input.relativePath
  });
}

export function removeUnseenRootEntries(
  db: AetherDatabase,
  rootId: string,
  seenAt: string
): { removedAssets: number; removedFolders: number } {
  db.prepare(
    `DELETE FROM asset_search
     WHERE asset_id IN (
       SELECT id
       FROM assets
       WHERE root_id = ? AND indexed_at <> ?
     )`
  ).run(rootId, seenAt);

  const removedAssets = db
    .prepare("DELETE FROM assets WHERE root_id = ? AND indexed_at <> ?")
    .run(rootId, seenAt).changes;

  const removedFolders = db
    .prepare(
      "DELETE FROM folders WHERE root_id = ? AND relative_path <> '' AND updated_at <> ?"
    )
    .run(rootId, seenAt).changes;

  return { removedAssets, removedFolders };
}

export function refreshFolderAssetCounts(db: AetherDatabase, rootId: string): void {
  db.prepare(`
    UPDATE folders
    SET asset_count = (
      SELECT COUNT(*)
      FROM assets
      WHERE assets.folder_id = folders.id
    )
    WHERE root_id = ?
  `).run(rootId);
}

export function listFolders(db: AetherDatabase): FolderRecord[] {
  const rows = db
    .prepare(
      `SELECT id, root_id, parent_id, relative_path, name, asset_count
       FROM folders
       ORDER BY root_id, relative_path COLLATE NOCASE`
    )
    .all() as FolderRow[];

  return rows.map(mapFolderRow);
}

export function getFolder(db: AetherDatabase, folderId: string): FolderRecord | null {
  const row = db
    .prepare(
      `SELECT id, root_id, parent_id, relative_path, name, asset_count
       FROM folders
       WHERE id = ?`
    )
    .get(folderId) as FolderRow | undefined;

  return row ? mapFolderRow(row) : null;
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

export function getDerivative(
  db: AetherDatabase,
  id: string
): DerivativeRecord | null {
  const row = db
    .prepare(
      `SELECT id, asset_id, kind, width, height, path, source_mtime_ms, status, error
       FROM derivatives
       WHERE id = ?`
    )
    .get(id) as DerivativeRow | undefined;

  return row ? mapDerivativeRow(row) : null;
}

export function upsertDerivative(
  db: AetherDatabase,
  input: UpsertDerivativeInput
): void {
  db.prepare(`
    INSERT INTO derivatives
      (id, asset_id, kind, width, height, path, source_mtime_ms, status, error, created_at)
    VALUES
      (@id, @assetId, @kind, @width, @height, @path, @sourceMtimeMs, @status, @error, @createdAt)
    ON CONFLICT(asset_id, kind, width, height) DO UPDATE SET
      id = excluded.id,
      path = excluded.path,
      source_mtime_ms = excluded.source_mtime_ms,
      status = excluded.status,
      error = excluded.error
  `).run({
    id: input.id,
    assetId: input.assetId,
    kind: input.kind,
    width: input.width,
    height: input.height,
    path: input.path,
    sourceMtimeMs: input.sourceMtimeMs,
    status: input.status,
    error: input.error,
    createdAt: input.createdAt
  });
}

export function updateAssetDimensions(
  db: AetherDatabase,
  assetId: string,
  width: number | null,
  height: number | null
): void {
  db.prepare("UPDATE assets SET width = ?, height = ? WHERE id = ?").run(
    width,
    height,
    assetId
  );
}

export function updateAssetMediaMetadata(
  db: AetherDatabase,
  input: AssetMediaMetadataInput
): void {
  db.prepare(
    `UPDATE assets
     SET width = ?,
         height = ?,
         duration_ms = ?,
         codec = ?
     WHERE id = ?`
  ).run(input.width, input.height, input.durationMs, input.codec, input.assetId);
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

export function getAssetTags(
  db: AetherDatabase,
  assetId: string
): TagRecord[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.normalized_name, t.display_name, t.usage_count
       FROM tags t
       JOIN asset_tags at ON at.tag_id = t.id
       WHERE at.asset_id = ?
       ORDER BY t.display_name COLLATE NOCASE ASC`
    )
    .all(assetId) as TagRow[];

  return rows.map(mapTagRow);
}

export function setAssetTags(
  db: AetherDatabase,
  assetId: string,
  tagNames: string[],
  now = new Date().toISOString()
): TagRecord[] | null {
  const asset = db
    .prepare("SELECT id FROM assets WHERE id = ?")
    .get(assetId) as { id: string } | undefined;

  if (!asset) {
    return null;
  }

  const tags = normalizeTagInputs(tagNames);

  const transaction = db.transaction(() => {
    const upsertTag = db.prepare(`
      INSERT INTO tags (id, normalized_name, display_name, usage_count, created_at)
      VALUES (@id, @normalizedName, @displayName, 0, @createdAt)
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name = excluded.display_name
    `);
    const linkTag = db.prepare(`
      INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, created_at)
      VALUES (@assetId, @tagId, @createdAt)
    `);

    db.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);

    for (const tag of tags) {
      upsertTag.run({
        id: tag.id,
        normalizedName: tag.normalizedName,
        displayName: tag.displayName,
        createdAt: now
      });
      linkTag.run({
        assetId,
        tagId: tag.id,
        createdAt: now
      });
    }

    refreshTagUsageCounts(db);
    db.prepare("DELETE FROM tags WHERE usage_count = 0").run();
  });

  transaction();

  return getAssetTags(db, assetId);
}

export function updateAssetTagsBatch(
  db: AetherDatabase,
  input: BatchTagUpdateInput
): BatchTagUpdateResult | null {
  const assetIds = uniqueAssetIds(input.assetIds);

  if (!allAssetsExist(db, assetIds)) {
    return null;
  }

  const now = input.now ?? new Date().toISOString();
  const tags = normalizeTagInputs(input.tags);

  if (input.mode === "add" && tags.length === 0) {
    throw new InvalidTagError("At least one tag is required.");
  }

  const transaction = db.transaction(() => {
    for (const assetId of assetIds) {
      const nextTags =
        input.mode === "replace"
          ? tags
          : mergeNormalizedTags(getNormalizedAssetTags(db, assetId), tags);

      if (nextTags.length > MAX_TAGS_PER_ASSET) {
        throw new InvalidTagError(`Use ${MAX_TAGS_PER_ASSET} tags or fewer.`);
      }

      replaceAssetTags(db, assetId, nextTags, now);
    }

    refreshTagUsageCounts(db);
    db.prepare("DELETE FROM tags WHERE usage_count = 0").run();
  });

  transaction();

  return {
    tags: tags
      .map((tag) => getTagById(db, tag.id))
      .filter((tag): tag is TagRecord => Boolean(tag)),
    updated: assetIds.length
  };
}

export function suggestTags(
  db: AetherDatabase,
  options: { query: string; limit: number }
): TagRecord[] {
  const query = normalizeTagSearch(options.query);

  if (!query) {
    const rows = db
      .prepare(
        `SELECT id, normalized_name, display_name, usage_count
         FROM tags
         ORDER BY usage_count DESC, display_name COLLATE NOCASE ASC
         LIMIT @limit`
      )
      .all({ limit: options.limit }) as TagRow[];

    return rows.map(mapTagRow);
  }

  const rows = db
    .prepare(
      `SELECT id, normalized_name, display_name, usage_count
       FROM tags
       WHERE normalized_name LIKE @query ESCAPE '\\'
       ORDER BY usage_count DESC, display_name COLLATE NOCASE ASC
       LIMIT @limit`
    )
    .all({ query: `${escapeLike(query)}%`, limit: options.limit }) as TagRow[];

  return rows.map(mapTagRow);
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

function mapFolderRow(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    parentId: row.parent_id,
    relativePath: row.relative_path,
    name: row.name,
    assetCount: row.asset_count
  };
}

function mapAssetRow(row: AssetRow): AssetRecord {
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

function getTagsByAssetId(
  db: AetherDatabase,
  assetIds: string[]
): Map<string, TagRecord[]> {
  const uniqueAssetIds = [...new Set(assetIds)];
  const tagsByAssetId = new Map<string, TagRecord[]>();

  if (uniqueAssetIds.length === 0) {
    return tagsByAssetId;
  }

  const placeholders = uniqueAssetIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT
         at.asset_id,
         t.id,
         t.normalized_name,
         t.display_name,
         t.usage_count
       FROM asset_tags at
       JOIN tags t ON t.id = at.tag_id
       WHERE at.asset_id IN (${placeholders})
       ORDER BY t.display_name COLLATE NOCASE ASC`
    )
    .all(...uniqueAssetIds) as AssetTagRow[];

  for (const row of rows) {
    const tags = tagsByAssetId.get(row.asset_id) ?? [];
    tags.push(mapTagRow(row));
    tagsByAssetId.set(row.asset_id, tags);
  }

  return tagsByAssetId;
}

function mapDerivativeRow(row: DerivativeRow): DerivativeRecord {
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

function mapTagRow(row: TagRow): TagRecord {
  return {
    id: row.id,
    normalizedName: row.normalized_name,
    displayName: row.display_name,
    usageCount: row.usage_count
  };
}

function normalizeTagInputs(tagNames: string[]): NormalizedTag[] {
  if (tagNames.length > MAX_TAGS_PER_ASSET) {
    throw new InvalidTagError(`Use ${MAX_TAGS_PER_ASSET} tags or fewer.`);
  }

  const tags = new Map<string, NormalizedTag>();

  for (const tagName of tagNames) {
    const tag = normalizeTagInput(tagName);

    if (!tag) {
      continue;
    }

    if (!tags.has(tag.normalizedName)) {
      tags.set(tag.normalizedName, tag);
    }
  }

  return [...tags.values()];
}

function replaceAssetTags(
  db: AetherDatabase,
  assetId: string,
  tags: NormalizedTag[],
  now: string
): void {
  const upsertTag = db.prepare(`
    INSERT INTO tags (id, normalized_name, display_name, usage_count, created_at)
    VALUES (@id, @normalizedName, @displayName, 0, @createdAt)
    ON CONFLICT(normalized_name) DO UPDATE SET
      display_name = excluded.display_name
  `);
  const linkTag = db.prepare(`
    INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, created_at)
    VALUES (@assetId, @tagId, @createdAt)
  `);

  db.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);

  for (const tag of tags) {
    upsertTag.run({
      id: tag.id,
      normalizedName: tag.normalizedName,
      displayName: tag.displayName,
      createdAt: now
    });
    linkTag.run({
      assetId,
      tagId: tag.id,
      createdAt: now
    });
  }
}

function getNormalizedAssetTags(
  db: AetherDatabase,
  assetId: string
): NormalizedTag[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.normalized_name, t.display_name
       FROM tags t
       JOIN asset_tags at ON at.tag_id = t.id
       WHERE at.asset_id = ?
       ORDER BY t.display_name COLLATE NOCASE ASC`
    )
    .all(assetId) as Array<{
    id: string;
    normalized_name: string;
    display_name: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    normalizedName: row.normalized_name,
    displayName: row.display_name
  }));
}

function mergeNormalizedTags(
  existingTags: NormalizedTag[],
  addedTags: NormalizedTag[]
): NormalizedTag[] {
  const tags = new Map<string, NormalizedTag>();

  for (const tag of existingTags) {
    tags.set(tag.normalizedName, tag);
  }

  for (const tag of addedTags) {
    if (!tags.has(tag.normalizedName)) {
      tags.set(tag.normalizedName, tag);
    }
  }

  return [...tags.values()];
}

function getTagById(db: AetherDatabase, tagId: string): TagRecord | null {
  const row = db
    .prepare(
      `SELECT id, normalized_name, display_name, usage_count
       FROM tags
       WHERE id = ?`
    )
    .get(tagId) as TagRow | undefined;

  return row ? mapTagRow(row) : null;
}

function normalizeTagInput(input: string): NormalizedTag | null {
  const displayName = input.normalize("NFKC").trim().replace(/\s+/g, " ");

  if (!displayName) {
    return null;
  }

  if (displayName.length > MAX_TAG_LENGTH) {
    throw new InvalidTagError(`Tags must be ${MAX_TAG_LENGTH} characters or fewer.`);
  }

  const normalizedName = displayName.toLocaleLowerCase("en-US");

  return {
    id: stableId("tag", normalizedName),
    normalizedName,
    displayName
  };
}

function normalizeTagSearch(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(
    "en-US"
  );
}

function assetSearchQuery(query: string): string {
  const terms =
    query
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 8) ?? [];

  return terms.map((term) => `${term}*`).join(" AND ");
}

function refreshTagUsageCounts(db: AetherDatabase): void {
  db.prepare(`
    UPDATE tags
    SET usage_count = (
      SELECT COUNT(*)
      FROM asset_tags
      WHERE asset_tags.tag_id = tags.id
    )
  `).run();
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

function uniqueAssetIds(assetIds: string[]): string[] {
  return [...new Set(assetIds)];
}

function allAssetsExist(db: AetherDatabase, assetIds: string[]): boolean {
  const findAsset = db.prepare("SELECT id FROM assets WHERE id = ?");

  return assetIds.every((assetId) => Boolean(findAsset.get(assetId)));
}

export class InvalidTagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTagError";
  }
}
