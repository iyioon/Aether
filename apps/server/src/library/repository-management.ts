import path from "node:path";
import type { AetherDatabase } from "../db/database.js";
import { getAsset, upsertAsset } from "./repository.js";
import { ASSET_SOURCE_SELECT_COLUMNS } from "./asset-query.js";
import { mapAssetRow, mapTagRow } from "./repository-mappers.js";
import { getPresentationsByAssetId } from "./repository-presentation.js";
import { getFolder } from "./repository-folders.js";
import { recomputeAssetRankings } from "./repository-rankings.js";
import type {
  AssetRecord,
  AssetRow,
  AssetSourceRecord,
  FolderRecord,
  TagRow,
  UpsertAssetInput
} from "./repository-types.js";
import { searchNgramText } from "./search-text.js";
import { sourceVersion } from "./source-version.js";
import { FileOperationBody } from "./file-operation-model.js";

export class ManagementConflictError extends Error {
  constructor(public readonly code = "source_changed") {
    super(code);
    this.name = "ManagementConflictError";
  }
}

export interface ManagedAsset {
  id: string;
  rootId: string;
  rootRealPath: string;
  folderId: string | null;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtimeMs: number;
  contentSha256: string | null;
  fsDeviceId: string | null;
  fsInode: string | null;
  fsBirthtimeNs: string | null;
  fsCtimeNs: string | null;
  lifecycle: "active" | "trashed";
  sourceVersion: string;
}

export interface ManagedFolder extends FolderRecord {
  rootRealPath: string;
  sourceVersion: string;
  fsDeviceId: string | null;
  fsInode: string | null;
}

export interface ManagedFileIdentity {
  sizeBytes: number;
  mtimeMs: number;
  fsDeviceId: string | null;
  fsInode: string | null;
  fsBirthtimeNs: string | null;
  fsCtimeNs: string | null;
}

export function getLibraryRevision(db: AetherDatabase): string {
  return String(
    (
      db.prepare("SELECT revision FROM library_state WHERE id = 1").get() as {
        revision: number;
      }
    ).revision
  );
}

export function getWriteReconciliationRequired(db: AetherDatabase): boolean {
  return (
    (
      db
        .prepare("SELECT writes_need_scan FROM library_state WHERE id = 1")
        .get() as { writes_need_scan: number }
    ).writes_need_scan === 1
  );
}

export function getManagedAsset(
  db: AetherDatabase,
  id: string
): ManagedAsset | null {
  return getManagedAssetsByIds(db, [id]).get(id) ?? null;
}

export function getManagedAssetsByIds(
  db: AetherDatabase,
  ids: readonly string[]
): Map<string, ManagedAsset> {
  const selected = boundedManagedIds(ids);
  if (!selected.length) return new Map();
  const rows = db
    .prepare(
      `SELECT a.id, a.root_id AS rootId, r.real_path AS rootRealPath,
    a.folder_id AS folderId, a.relative_path AS relativePath, a.name,
    a.size_bytes AS sizeBytes, a.mtime_ms AS mtimeMs, a.content_sha256 AS contentSha256,
    a.fs_device_id AS fsDeviceId, a.fs_inode AS fsInode,
    a.fs_birthtime_ns AS fsBirthtimeNs, a.fs_ctime_ns AS fsCtimeNs,
    a.lifecycle, a.source_revision AS revision FROM assets a JOIN roots r ON r.id = a.root_id WHERE a.id IN (${selected.map(() => "?").join(",")})`
    )
    .all(...selected) as Array<
    Omit<ManagedAsset, "sourceVersion"> & { revision: number }
  >;
  return new Map(
    rows.map(({ revision, ...record }) => [
      record.id,
      {
        ...record,
        sourceVersion: sourceVersion(record.id, revision)
      }
    ])
  );
}

export function getManagedFolder(
  db: AetherDatabase,
  id: string
): ManagedFolder | null {
  return getManagedFoldersByIds(db, [id]).get(id) ?? null;
}

export function getManagedFoldersByIds(
  db: AetherDatabase,
  ids: readonly string[]
): Map<string, ManagedFolder> {
  const selected = boundedManagedIds(ids);
  if (!selected.length) return new Map();
  const rows = db
    .prepare(
      `SELECT f.id, f.root_id AS rootId, f.parent_id AS parentId, f.relative_path AS relativePath,
     f.name, f.asset_count AS assetCount, f.source_revision AS revision, r.real_path AS rootRealPath,
     f.fs_device_id AS fsDeviceId, f.fs_inode AS fsInode FROM folders f JOIN roots r ON r.id = f.root_id
     WHERE f.id IN (${selected.map(() => "?").join(",")})`
    )
    .all(...selected) as Array<
    Omit<ManagedFolder, "sourceVersion"> & { revision: number }
  >;
  return new Map(
    rows.map(({ revision, ...record }) => [
      record.id,
      {
        ...record,
        sourceVersion: sourceVersion(record.id, revision)
      }
    ])
  );
}

function boundedManagedIds(ids: readonly string[]): string[] {
  const selected = [...new Set(ids)];
  if (selected.length > 100)
    throw new ManagementConflictError("invalid_request");
  return selected;
}

/** Missing indexed entries still reserve their active location until scanning
 * reconciles them; publishing there must not collide with another record. */
export function createManagedDestinationProbe(
  db: AetherDatabase
): (rootId: string, relativePath: string) => boolean {
  const statement = db.prepare(
    `SELECT 1 FROM assets WHERE root_id = @rootId AND relative_path = @relativePath AND lifecycle = 'active'
     UNION ALL SELECT 1 FROM folders WHERE root_id = @rootId AND relative_path = @relativePath LIMIT 1`
  );
  return (rootId, relativePath) => !!statement.get({ rootId, relativePath });
}

export function createManagedFolder(
  db: AetherDatabase,
  input: {
    id: string;
    rootId: string;
    parentId: string;
    relativePath: string;
    name: string;
    identity?: { fsDeviceId: string | null; fsInode: string | null };
    now?: string;
  }
): FolderRecord {
  return db.transaction(() => {
    assertDestination(
      db,
      input.rootId,
      input.parentId,
      input.relativePath,
      input.name
    );
    const now = input.now ?? new Date().toISOString();
    db.prepare(
      `INSERT INTO folders (id, root_id, parent_id, relative_path, name, asset_count, created_at, updated_at)
      VALUES (@id, @rootId, @parentId, @relativePath, @name, 0, @now, @now)`
    ).run({ ...input, now });
    if (input.identity)
      db.prepare(
        "UPDATE folders SET fs_device_id = @fsDeviceId, fs_inode = @fsInode WHERE id = @id"
      ).run({ ...input.identity, id: input.id });
    return getFolder(db, input.id)!;
  })();
}

export function commitAssetLocation(
  db: AetherDatabase,
  input: {
    assetId: string;
    expectedVersion: string;
    rootId: string;
    folderId: string;
    relativePath: string;
    name: string;
    identity?: ManagedFileIdentity;
    now?: string;
  }
): AssetRecord {
  return db.transaction(() => {
    requireAsset(db, input.assetId, input.expectedVersion, "active");
    assertDestination(
      db,
      input.rootId,
      input.folderId,
      input.relativePath,
      input.name
    );
    writeAssetLocation(db, input);
    refreshManagedCounts(db);
    return getAsset(db, input.assetId)!;
  })();
}

export function commitFolderLocation(
  db: AetherDatabase,
  input: {
    folderId: string;
    expectedVersion: string;
    rootId: string;
    parentId: string;
    relativePath: string;
    name: string;
    identity?: { fsDeviceId: string | null; fsInode: string | null };
    identities?: Record<string, ManagedFileIdentity>;
    folderIdentities?: Record<
      string,
      { fsDeviceId: string | null; fsInode: string | null }
    >;
    now?: string;
  }
): FolderRecord {
  return db.transaction(() => {
    const source = getManagedFolder(db, input.folderId);
    if (!source || source.sourceVersion !== input.expectedVersion)
      throw new ManagementConflictError();
    if (source.relativePath === "")
      throw new ManagementConflictError("protected_root");
    assertDestination(
      db,
      input.rootId,
      input.parentId,
      input.relativePath,
      input.name
    );
    if (
      source.rootId === input.rootId &&
      (input.relativePath === source.relativePath ||
        input.relativePath.startsWith(`${source.relativePath}/`))
    ) {
      if (
        input.relativePath === source.relativePath &&
        input.parentId === source.parentId &&
        input.name === source.name
      )
        return source;
      throw new ManagementConflictError("invalid_destination");
    }
    const oldPrefix = `${source.relativePath}/`;
    const folders = db
      .prepare(
        `SELECT id, relative_path FROM folders WHERE root_id = ? AND (relative_path = ? OR substr(relative_path, 1, ?) = ?)
      ORDER BY length(relative_path), id`
      )
      .all(
        source.rootId,
        source.relativePath,
        oldPrefix.length,
        oldPrefix
      ) as Array<{ id: string; relative_path: string }>;
    const assets = db
      .prepare(
        `SELECT id, relative_path FROM assets WHERE root_id = ? AND lifecycle = 'active'
      AND substr(relative_path, 1, ?) = ?`
      )
      .all(source.rootId, oldPrefix.length, oldPrefix) as Array<{
      id: string;
      relative_path: string;
    }>;
    const now = input.now ?? new Date().toISOString();
    const temporary = `.aether-operation/${input.folderId}`;
    const parkFolder = db.prepare(
      "UPDATE folders SET relative_path = ? WHERE id = ?"
    );
    const parkAsset = db.prepare(
      "UPDATE assets SET relative_path = ? WHERE id = ?"
    );
    for (const folder of folders)
      parkFolder.run(`${temporary}/${folder.id}`, folder.id);
    for (const asset of assets)
      parkAsset.run(`${temporary}/${asset.id}`, asset.id);
    const updateFolder = db.prepare(
      "UPDATE folders SET root_id = ?, relative_path = ?, updated_at = ? WHERE id = ?"
    );
    for (const folder of folders)
      updateFolder.run(
        input.rootId,
        `${input.relativePath}${folder.relative_path.slice(source.relativePath.length)}`,
        now,
        folder.id
      );
    for (const folder of folders) {
      const identity =
        folder.id === input.folderId
          ? input.identity
          : input.folderIdentities?.[
              folder.relative_path.slice(oldPrefix.length)
            ];
      if (identity)
        db.prepare(
          "UPDATE folders SET fs_device_id = @fsDeviceId, fs_inode = @fsInode WHERE id = @id"
        ).run({ ...identity, id: folder.id });
    }
    db.prepare("UPDATE folders SET parent_id = ?, name = ? WHERE id = ?").run(
      input.parentId,
      input.name,
      input.folderId
    );
    const updateAsset = db.prepare(
      "UPDATE assets SET root_id = ?, relative_path = ? WHERE id = ?"
    );
    for (const asset of assets) {
      updateAsset.run(
        input.rootId,
        `${input.relativePath}${asset.relative_path.slice(source.relativePath.length)}`,
        asset.id
      );
      const identity =
        input.identities?.[asset.relative_path.slice(oldPrefix.length)];
      if (identity)
        db.prepare(
          `UPDATE assets SET size_bytes = @sizeBytes, mtime_ms = @mtimeMs, fs_device_id = @fsDeviceId, fs_inode = @fsInode, fs_birthtime_ns = @fsBirthtimeNs, fs_ctime_ns = @fsCtimeNs WHERE id = @assetId`
        ).run({ ...identity, assetId: asset.id });
      syncManagedSearch(db, asset.id);
    }
    refreshManagedCounts(db);
    return getFolder(db, input.folderId)!;
  })();
}

export interface TrashRecord {
  id: string;
  assetId: string;
  originalRootId: string;
  originalFolderId: string | null;
  originalRelativePath: string;
  originalName: string;
  physicalRelativePath: string;
  identity: ManagedAsset;
  trashedAt: string;
  expiresAt: string;
  rootRealPath: string;
  sourceVersion: string;
}

type TrashRow = Omit<TrashRecord, "identity" | "sourceVersion"> & {
  identityJson: string;
  revision: number;
};
const TRASH_SELECT = `SELECT t.id, t.asset_id AS assetId, t.original_root_id AS originalRootId,
  t.original_folder_id AS originalFolderId, t.original_relative_path AS originalRelativePath,
  t.original_name AS originalName, t.physical_relative_path AS physicalRelativePath,
  t.identity_json AS identityJson, t.trashed_at AS trashedAt, t.expires_at AS expiresAt,
  r.real_path AS rootRealPath, a.source_revision AS revision
  FROM trash_records t JOIN assets a ON a.id = t.asset_id JOIN roots r ON r.id = a.root_id`;

function mapTrashRow(row: TrashRow): TrashRecord {
  const { identityJson, revision, ...record } = row;
  return {
    ...record,
    identity: JSON.parse(identityJson) as ManagedAsset,
    sourceVersion: sourceVersion(row.assetId, revision)
  };
}

export function getTrashRecord(
  db: AetherDatabase,
  id: string
): TrashRecord | null {
  return getTrashRecordsByIds(db, [id]).get(id) ?? null;
}

export function getTrashRecordsByIds(
  db: AetherDatabase,
  ids: readonly string[]
): Map<string, TrashRecord> {
  const selected = boundedManagedIds(ids);
  if (!selected.length) return new Map();
  const rows = db
    .prepare(
      `${TRASH_SELECT}
    WHERE t.id IN (${selected.map(() => "?").join(",")}) AND a.lifecycle = 'trashed'`
    )
    .all(...selected) as TrashRow[];
  return new Map(rows.map((row) => [row.id, mapTrashRow(row)]));
}

export function getTrashNamesByIds(
  db: AetherDatabase,
  trashIds: string[]
): Array<{ id: string; name: string }> {
  const ids = [...new Set(trashIds)].slice(0, 100);
  if (!ids.length) return [];
  return db
    .prepare(
      `SELECT id, original_name AS name FROM trash_records WHERE id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as Array<{ id: string; name: string }>;
}

export function listTrash(
  db: AetherDatabase,
  limit = 100,
  offset = 0,
  search = ""
): TrashRecord[] {
  const rows = db
    .prepare(
      `${TRASH_SELECT}
       WHERE a.lifecycle = 'trashed' AND (t.original_name LIKE @search ESCAPE '\\' OR t.original_relative_path LIKE @search ESCAPE '\\')
       ORDER BY t.trashed_at DESC, t.id LIMIT @limit OFFSET @offset`
    )
    .all({
      limit: Math.max(1, Math.min(100, limit)),
      offset: Math.max(0, offset),
      search: trashSearch(search)
    }) as TrashRow[];
  return rows.map(mapTrashRow);
}

export function countTrash(db: AetherDatabase, search = ""): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM trash_records t JOIN assets a ON a.id = t.asset_id
    WHERE a.lifecycle = 'trashed' AND (t.original_name LIKE @search ESCAPE '\\' OR t.original_relative_path LIKE @search ESCAPE '\\')`
      )
      .get({ search: trashSearch(search) }) as { count: number }
  ).count;
}

export function getTrashedAssetMetadata(
  db: AetherDatabase,
  trashId: string
): AssetSourceRecord | null {
  const row = db
    .prepare(
      `SELECT ${ASSET_SOURCE_SELECT_COLUMNS} FROM assets a
    JOIN trash_records t ON t.asset_id = a.id JOIN roots ON roots.id = a.root_id
    LEFT JOIN asset_annotations aa ON aa.asset_id = a.id
    LEFT JOIN asset_rankings ar ON ar.asset_id = a.id
    WHERE t.id = ? AND a.lifecycle = 'trashed'`
    )
    .get(trashId) as AssetRow | undefined;
  if (!row || !row.root_id || !row.root_real_path || !row.relative_path)
    return null;
  const asset = mapAssetRow(row);
  const tags = db
    .prepare(
      `SELECT t.id, t.normalized_name, t.display_name, t.usage_count FROM tags t JOIN asset_tags at ON at.tag_id = t.id WHERE at.asset_id = ? ORDER BY t.display_name COLLATE NOCASE`
    )
    .all(asset.id) as TagRow[];
  return {
    ...asset,
    tags: tags.map(mapTagRow),
    presentation: getPresentationsByAssetId(db, [asset]).get(asset.id)!,
    rootId: row.root_id,
    rootRealPath: row.root_real_path,
    relativePath: row.relative_path
  };
}

export function commitUploadedAsset(
  db: AetherDatabase,
  input: UpsertAssetInput
): AssetRecord {
  return db.transaction(() => {
    assertDestination(
      db,
      input.rootId,
      input.folderId,
      input.relativePath,
      input.name
    );
    const occupied = db
      .prepare(
        "SELECT id, content_sha256 FROM assets WHERE root_id = ? AND relative_path = ?"
      )
      .get(input.rootId, input.relativePath) as
      { id: string; content_sha256: string | null } | undefined;
    if (occupied) {
      if (
        occupied.id !== input.id ||
        occupied.content_sha256 !== input.contentSha256
      )
        throw new ManagementConflictError("destination_exists");
      const current = getAsset(db, input.id);
      if (!current) throw new ManagementConflictError();
      return current;
    }
    upsertAsset(db, input);
    refreshManagedCounts(db);
    return getAsset(db, input.id)!;
  })();
}

function trashSearch(search: string): string {
  return `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

export function markTrashed(
  db: AetherDatabase,
  input: {
    assetId: string;
    expectedVersion: string;
    trashId: string;
    physicalRelativePath: string;
    expiresAt: string;
    identity?: ManagedFileIdentity;
    contentSha256?: string;
    now?: string;
  }
): TrashRecord {
  return db.transaction(() => {
    const asset = requireAsset(
      db,
      input.assetId,
      input.expectedVersion,
      "active"
    );
    if (
      !input.physicalRelativePath.startsWith(".aether-trash/") ||
      !validRelativePath(input.physicalRelativePath)
    )
      throw new ManagementConflictError("invalid_trash_path");
    const now = input.now ?? new Date().toISOString();
    db.prepare(
      `INSERT INTO trash_records (id, asset_id, original_root_id, original_folder_id, original_relative_path, original_name, physical_relative_path, identity_json, trashed_at, expires_at)
      VALUES (@trashId, @assetId, @rootId, @folderId, @relativePath, @name, @physicalRelativePath, @identity, @now, @expiresAt)`
    ).run({
      ...asset,
      ...input,
      identity: JSON.stringify({
        ...asset,
        ...input.identity,
        contentSha256: input.contentSha256 ?? asset.contentSha256
      }),
      now
    });
    db.prepare(
      "UPDATE assets SET lifecycle = 'trashed', folder_id = NULL, relative_path = ? WHERE id = ?"
    ).run(input.physicalRelativePath, input.assetId);
    if (input.identity)
      db.prepare(
        `UPDATE assets SET size_bytes = @sizeBytes, mtime_ms = @mtimeMs, fs_device_id = @fsDeviceId, fs_inode = @fsInode, fs_birthtime_ns = @fsBirthtimeNs, fs_ctime_ns = @fsCtimeNs WHERE id = @assetId`
      ).run({ ...input.identity, assetId: input.assetId });
    if (input.contentSha256)
      db.prepare("UPDATE assets SET content_sha256 = ? WHERE id = ?").run(
        input.contentSha256,
        input.assetId
      );
    db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(
      input.assetId
    );
    recomputeAssetRankings(db, now);
    refreshManagedCounts(db);
    return getTrashRecord(db, input.trashId)!;
  })();
}

export function restoreTrashedAsset(
  db: AetherDatabase,
  input: {
    trashId: string;
    expectedVersion: string;
    rootId: string;
    folderId: string;
    relativePath: string;
    name: string;
    identity?: ManagedFileIdentity;
    now?: string;
  }
): AssetRecord {
  return db.transaction(() => {
    const record = getTrashRecord(db, input.trashId);
    if (!record || record.sourceVersion !== input.expectedVersion)
      throw new ManagementConflictError();
    assertDestination(
      db,
      input.rootId,
      input.folderId,
      input.relativePath,
      input.name
    );
    db.prepare("UPDATE assets SET lifecycle = 'active' WHERE id = ?").run(
      record.assetId
    );
    writeAssetLocation(db, { ...input, assetId: record.assetId });
    db.prepare("DELETE FROM trash_records WHERE id = ?").run(input.trashId);
    recomputeAssetRankings(db, input.now ?? new Date().toISOString());
    refreshManagedCounts(db);
    return getAsset(db, record.assetId)!;
  })();
}

export function purgeTrashedAsset(
  db: AetherDatabase,
  trashId: string,
  expectedVersion: string
): boolean {
  return db.transaction(() => {
    const record = getTrashRecord(db, trashId);
    if (!record) return false;
    if (record.sourceVersion !== expectedVersion)
      throw new ManagementConflictError();
    db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(
      record.assetId
    );
    db.prepare("DELETE FROM assets WHERE id = ? AND lifecycle = 'trashed'").run(
      record.assetId
    );
    recomputeAssetRankings(db, new Date().toISOString());
    refreshManagedCounts(db);
    return true;
  })();
}

export interface ManagedOperationRecord {
  id: string;
  requestJson: string;
  status: string;
  stateJson: string;
  createdAt: string;
  updatedAt: string;
}

export function getManagedOperation(
  db: AetherDatabase,
  id: string
): ManagedOperationRecord | null {
  return (
    (db
      .prepare(
        `SELECT id, request_json AS requestJson, status, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt FROM file_operations WHERE id = ?`
      )
      .get(id) as ManagedOperationRecord | undefined) ?? null
  );
}

export function listManagedOperations(
  db: AetherDatabase,
  limit = 100
): ManagedOperationRecord[] {
  return db
    .prepare(
      `SELECT id, request_json AS requestJson, status, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt FROM file_operations ORDER BY CASE WHEN status NOT IN ('completed','partial','cancelled','failed') THEN 0 ELSE 1 END, created_at DESC, id LIMIT ?`
    )
    .all(Math.max(1, Math.min(100, limit))) as ManagedOperationRecord[];
}

export function listPendingManagedOperations(
  db: AetherDatabase
): ManagedOperationRecord[] {
  return db
    .prepare(
      `SELECT id, request_json AS requestJson, status, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt FROM file_operations
    WHERE status NOT IN ('completed', 'partial', 'cancelled', 'failed') ORDER BY created_at, id`
    )
    .all() as ManagedOperationRecord[];
}

export function listExpiredTrash(
  db: AetherDatabase,
  now: string,
  limit = 100
): TrashRecord[] {
  const rows = db
    .prepare(
      `${TRASH_SELECT} WHERE a.lifecycle = 'trashed' AND t.expires_at <= ? ORDER BY t.expires_at, t.id LIMIT ?`
    )
    .all(now, Math.max(1, Math.min(100, limit))) as TrashRow[];
  return rows.map(mapTrashRow);
}

export function listPrunableManagedOperations(
  db: AetherDatabase,
  before: string,
  limit = 100
): ManagedOperationRecord[] {
  const threshold = new Date(
    Math.min(new Date(before).getTime(), Date.now() - 7 * 86400_000)
  ).toISOString();
  return db
    .prepare(
      `SELECT id, request_json AS requestJson, status, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt FROM file_operations
    WHERE status IN ('completed','partial','cancelled','failed') AND updated_at < @threshold
    AND NOT EXISTS (SELECT 1 FROM managed_uploads u WHERE u.operation_id = file_operations.id)
    AND NOT EXISTS (SELECT 1 FROM trash_records t WHERE substr(t.id, 1, length(file_operations.id) + 1) = file_operations.id || '-')
    ORDER BY created_at,id LIMIT @limit`
    )
    .all({
      threshold,
      limit: Math.max(1, Math.min(100, limit))
    }) as ManagedOperationRecord[];
}

export function pruneManagedOperationReceipts(
  db: AetherDatabase,
  before: string,
  ids?: string[]
): number {
  if (ids?.length === 0) return 0;
  const selected = ids?.slice(0, 100);
  const threshold = new Date(
    Math.min(new Date(before).getTime(), Date.now() - 7 * 86400_000)
  ).toISOString();
  return db
    .prepare(
      `DELETE FROM file_operations WHERE status IN ('completed','partial','cancelled','failed') AND updated_at < ?
    AND NOT EXISTS (SELECT 1 FROM managed_uploads u WHERE u.operation_id = file_operations.id)
    AND NOT EXISTS (SELECT 1 FROM trash_records t WHERE substr(t.id, 1, length(file_operations.id) + 1) = file_operations.id || '-')
    ${selected ? `AND id IN (${selected.map(() => "?").join(",")})` : ""}`
    )
    .run(threshold, ...(selected ?? [])).changes;
}

export function createManagedOperation(
  db: AetherDatabase,
  input: { id: string; requestJson: string; stateJson: string }
): { created: boolean; record: ManagedOperationRecord } {
  assertJson(input.requestJson);
  assertJson(input.stateJson, 16 * 1024 * 1024);
  return db.transaction(() => {
    const previous = getManagedOperation(db, input.id);
    if (previous) {
      if (previous.requestJson !== input.requestJson)
        throw new ManagementConflictError("request_id_conflict");
      return { created: false, record: previous };
    }
    const request = JSON.parse(input.requestJson) as { type?: unknown };
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO file_operations (id, request_id, type, request_json, status, state_json, created_at, updated_at)
      VALUES (@id, @id, @type, @requestJson, 'queued', @stateJson, @now, @now)`
    ).run({
      ...input,
      type: typeof request.type === "string" ? request.type : "file_operation",
      now
    });
    return { created: true, record: getManagedOperation(db, input.id)! };
  })();
}

export interface ManagedOperationItemRecord {
  id: string;
  itemIndex: number;
  assetId: string;
  status: string;
  phase: string;
  journalJson: string;
}

export interface ManagedOperationSummary {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  needsAttention: number;
}

/** Snapshot the reviewed Trash in SQLite, without loading an unbounded request
 * or journal into memory. The immutable receipt and item rows commit together. */
export function createEmptyTrashOperation(
  db: AetherDatabase,
  input: {
    id: string;
    requestJson: string;
    expectedRevision: string;
    expectedCount: number;
  }
): { created: boolean; record: ManagedOperationRecord } {
  return db
    .transaction(() => {
      const previous = getManagedOperation(db, input.id);
      if (previous) {
        if (previous.requestJson !== input.requestJson)
          throw new ManagementConflictError("request_id_conflict");
        return { created: false, record: previous };
      }
      if (
        getLibraryRevision(db) !== input.expectedRevision ||
        countTrash(db) !== input.expectedCount
      )
        throw new ManagementConflictError("snapshot_changed");
      const result = createManagedOperation(db, {
        id: input.id,
        requestJson: input.requestJson,
        stateJson: JSON.stringify({ items: [], cancelRequested: false })
      });
      db.prepare(
        `INSERT INTO file_operation_items (id, operation_id, item_index, asset_id, status, journal_json, updated_at)
       SELECT @id || ':' || t.id, @id, ROW_NUMBER() OVER (ORDER BY t.trashed_at, t.id) - 1,
       t.asset_id, 'queued', json_object('input', json_object('trashId', t.id), 'name', t.original_name, 'sourceRevision', a.source_revision, 'snapshotRootId', a.root_id, 'status', 'queued'), @now
       FROM trash_records t JOIN assets a ON a.id = t.asset_id WHERE a.lifecycle = 'trashed'`
      ).run({ id: input.id, now: new Date().toISOString() });
      return result;
    })
    .immediate();
}

export function listManagedOperationItems(
  db: AetherDatabase,
  operationId: string,
  pendingOnly = false,
  limit = 100,
  afterIndex = -1
): ManagedOperationItemRecord[] {
  return db
    .prepare(
      `SELECT id, item_index AS itemIndex, asset_id AS assetId, status, phase, journal_json AS journalJson FROM file_operation_items
     WHERE operation_id = @operationId ${pendingOnly ? "AND status NOT IN ('completed','failed','cancelled') AND item_index > @afterIndex" : ""}
     ORDER BY item_index ${pendingOnly ? "ASC" : "DESC"} LIMIT @limit`
    )
    .all({
      operationId,
      afterIndex,
      limit: Math.max(1, Math.min(100, limit))
    }) as ManagedOperationItemRecord[];
}

export function managedOperationItemSummary(
  db: AetherDatabase,
  operationId: string
): ManagedOperationSummary {
  return db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'completed'), 0) AS completed,
     COALESCE(SUM(status = 'failed'), 0) AS failed, COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
     COALESCE(SUM(status = 'needs_attention'), 0) AS needsAttention FROM file_operation_items WHERE operation_id = ?`
    )
    .get(operationId) as ManagedOperationSummary;
}

export function hasCancellableManagedOperationItems(
  db: AetherDatabase,
  operationId: string
): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM file_operation_items WHERE operation_id = ? AND status NOT IN ('completed','failed','cancelled') AND phase IN ('queued','prepared','copied') LIMIT 1"
    )
    .get(operationId);
}

export function cancelEmptyTrashOperation(
  db: AetherDatabase,
  operationId: string,
  operation: { status: string; stateJson: string }
): ManagedOperationRecord {
  return db.transaction(() => {
    db.prepare(
      `UPDATE file_operation_items SET status = 'cancelled', journal_json = json_set(journal_json, '$.status', 'cancelled'), updated_at = ?
       WHERE operation_id = ? AND status = 'queued' AND phase = 'queued'`
    ).run(new Date().toISOString(), operationId);
    return updateManagedOperation(db, operationId, operation);
  })();
}

export function updateManagedOperationItem(
  db: AetherDatabase,
  operationId: string,
  itemId: string,
  input: {
    status: string;
    phase?: string;
    journalJson: string;
    errorCode?: string;
  },
  operation: { status: string; stateJson: string }
): ManagedOperationRecord {
  assertJson(input.journalJson, 16 * 1024 * 1024);
  return db.transaction(() => {
    if (
      db
        .prepare(
          "UPDATE file_operation_items SET status = @status, phase = @phase, journal_json = @journalJson, error = @errorCode, updated_at = @now WHERE id = @itemId AND operation_id = @operationId"
        )
        .run({
          ...input,
          phase: input.phase ?? "queued",
          errorCode: input.errorCode ?? null,
          now: new Date().toISOString(),
          itemId,
          operationId
        }).changes !== 1
    )
      throw new ManagementConflictError("operation_not_found");
    return updateManagedOperation(db, operationId, operation);
  })();
}

export function updateManagedOperation(
  db: AetherDatabase,
  id: string,
  input: { status: string; stateJson: string }
): ManagedOperationRecord {
  assertJson(input.stateJson, 16 * 1024 * 1024);
  if (
    db
      .prepare(
        "UPDATE file_operations SET status = ?, state_json = ?, updated_at = ? WHERE id = ?"
      )
      .run(input.status, input.stateJson, new Date().toISOString(), id)
      .changes !== 1
  )
    throw new ManagementConflictError("operation_not_found");
  return getManagedOperation(db, id)!;
}

export interface ManagedRootOwnership {
  rootId: string;
  deviceId: string;
  inode: string;
  trashInode?: string;
  stageInode?: string;
}

export function getManagedRootOwnership(
  db: AetherDatabase,
  rootId: string
): ManagedRootOwnership | null {
  const record = db
    .prepare(
      "SELECT identity_json FROM managed_root_ownership WHERE root_id = ?"
    )
    .get(rootId) as { identity_json: string } | undefined;
  return record
    ? (JSON.parse(record.identity_json) as ManagedRootOwnership)
    : null;
}

export function getManagedRootLocation(
  db: AetherDatabase,
  rootId: string
): string | null {
  const row = db
    .prepare("SELECT real_path FROM roots WHERE id = ?")
    .get(rootId) as { real_path: string } | undefined;
  return row?.real_path ?? null;
}

export function saveManagedRootOwnership(
  db: AetherDatabase,
  record: ManagedRootOwnership
): void {
  const previous = getManagedRootOwnership(db, record.rootId);
  if (
    previous &&
    (previous.deviceId !== record.deviceId ||
      previous.inode !== record.inode ||
      (previous.trashInode !== undefined &&
        previous.trashInode !== record.trashInode) ||
      (previous.stageInode !== undefined &&
        previous.stageInode !== record.stageInode))
  )
    throw new ManagementConflictError("root_identity_changed");
  db.prepare(
    `INSERT INTO managed_root_ownership (root_id, identity_json, created_at) VALUES (?, ?, ?)
    ON CONFLICT(root_id) DO UPDATE SET identity_json = excluded.identity_json`
  ).run(record.rootId, JSON.stringify(record), new Date().toISOString());
}

export interface MediaLossAcknowledgement {
  id: string;
  rootId: string;
  trashIds: string[];
  operationIds: string[];
  acknowledgedAt: string;
}

export interface MediaRecoveryRecord {
  kind: "trash" | "operation";
  id: string;
  rootIds: string[];
  status: string;
}

export function listMediaRecoveryRecords(
  db: AetherDatabase,
  after = "",
  limit = 100
): { records: MediaRecoveryRecord[]; nextCursor: string | null } {
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const rows = db
    .prepare(
      `SELECT * FROM (
       SELECT 'trash' AS kind, t.id, a.root_id AS rootId, 'trashed' AS status, NULL AS destinationRootId
       FROM trash_records t JOIN assets a ON a.id = t.asset_id
       UNION ALL
       SELECT 'operation', o.id, NULL, o.status, f.root_id
       FROM file_operations o LEFT JOIN folders f ON f.id = json_extract(o.request_json, '$.destinationFolderId')
       WHERE o.status NOT IN ('completed','partial','cancelled','failed')
     ) WHERE kind || ':' || id > @after ORDER BY kind, id LIMIT @limit`
    )
    .all({ after, limit: boundedLimit + 1 }) as Array<{
    kind: "trash" | "operation";
    id: string;
    rootId: string | null;
    status: string;
    destinationRootId: string | null;
  }>;
  const page = rows.slice(0, boundedLimit);
  const operationIds = page
    .filter((row) => row.kind === "operation")
    .map((row) => row.id);
  const batchRoots = new Map<string, string[]>();
  if (operationIds.length) {
    const roots = db
      .prepare(
        `WITH selected AS (SELECT id, request_json, state_json FROM file_operations WHERE id IN (${operationIds.map(() => "?").join(",")})),
         locations AS (
           SELECT o.id AS operationId, location.value AS rootId FROM selected o
           JOIN json_each(o.state_json, '$.items') item
           JOIN json_each(json_array(json_extract(item.value, '$.source.rootId'), json_extract(item.value, '$.destination.rootId'), json_extract(item.value, '$.stage.rootId'), json_extract(item.value, '$.quarantine.rootId'))) location
           UNION ALL
           SELECT o.id, COALESCE(a.root_id, f.root_id, ta.root_id) FROM selected o JOIN json_each(o.request_json, '$.items') item
           LEFT JOIN assets a ON a.id = json_extract(item.value, '$.assetId')
           LEFT JOIN folders f ON f.id = json_extract(item.value, '$.folderId')
           LEFT JOIN trash_records t ON t.id = json_extract(item.value, '$.trashId') LEFT JOIN assets ta ON ta.id = t.asset_id
           UNION ALL
           SELECT i.operation_id, a.root_id FROM file_operation_items i JOIN selected o ON o.id = i.operation_id JOIN assets a ON a.id = i.asset_id
         ) SELECT operationId, json_group_array(DISTINCT rootId) AS rootIds FROM locations WHERE typeof(rootId) = 'text' GROUP BY operationId`
      )
      .all(...operationIds) as Array<{ operationId: string; rootIds: string }>;
    for (const row of roots)
      batchRoots.set(row.operationId, JSON.parse(row.rootIds) as string[]);
  }
  const records = page.map((row) => {
    const roots = new Set(
      [
        row.rootId,
        row.destinationRootId,
        ...(batchRoots.get(row.id) ?? [])
      ].filter((id): id is string => !!id)
    );
    return {
      kind: row.kind,
      id: row.id,
      rootIds: [...roots].sort(),
      status: row.status
    };
  });
  const last = page.at(-1);
  return {
    records,
    nextCursor:
      rows.length > boundedLimit && last ? `${last.kind}:${last.id}` : null
  };
}

/** Filesystem absence and offline ownership are checked by the maintenance
 * caller. This transaction forgets only the explicitly named lost records. */
export function acknowledgeLostManagedRecords(
  db: AetherDatabase,
  acknowledgement: MediaLossAcknowledgement
): void {
  db.transaction(() => {
    const { rootId, trashIds, operationIds } = acknowledgement;
    if (
      (!trashIds.length && !operationIds.length) ||
      trashIds.length + operationIds.length > 100 ||
      new Set(trashIds).size !== trashIds.length ||
      new Set(operationIds).size !== operationIds.length
    )
      throw new ManagementConflictError("lost_media_record_mismatch");
    if (trashIds.length) {
      const placeholders = trashIds.map(() => "?").join(",");
      const records = db
        .prepare(
          `SELECT t.id, a.root_id, a.lifecycle FROM trash_records t JOIN assets a ON a.id = t.asset_id WHERE t.id IN (${placeholders})`
        )
        .all(...trashIds) as Array<{
        id: string;
        root_id: string;
        lifecycle: string;
      }>;
      if (
        records.length !== trashIds.length ||
        records.some(
          (record) =>
            record.root_id !== rootId || record.lifecycle !== "trashed"
        )
      )
        throw new ManagementConflictError("lost_media_record_mismatch");
    }
    const operations = operationIds.length
      ? (db
          .prepare(
            `SELECT id, request_json AS requestJson, status, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt FROM file_operations WHERE id IN (${operationIds.map(() => "?").join(",")})`
          )
          .all(...operationIds) as ManagedOperationRecord[])
      : [];
    if (operations.length !== operationIds.length)
      throw new ManagementConflictError("lost_media_record_mismatch");
    const emptyTrashOperations = new Set<string>();
    if (trashIds.length) {
      const claims = db
        .prepare(
          `SELECT DISTINCT i.operation_id AS operationId FROM file_operation_items i
           JOIN file_operations o ON o.id = i.operation_id
           WHERE json_extract(i.journal_json, '$.input.trashId') IN (${trashIds.map(() => "?").join(",")})
           AND i.status NOT IN ('completed','failed','cancelled') AND o.status NOT IN ('completed','partial','failed','cancelled')`
        )
        .all(...trashIds) as Array<{ operationId: string }>;
      if (claims.some((claim) => !operationIds.includes(claim.operationId)))
        throw new ManagementConflictError("lost_media_record_mismatch");
    }
    for (const operation of operations) {
      const request = FileOperationBody.safeParse(
        JSON.parse(operation.requestJson)
      );
      if (
        !request.success ||
        request.data.type === "add-media" ||
        request.data.uploadId ||
        !["queued", "running", "needs_attention"].includes(operation.status)
      )
        throw new ManagementConflictError("lost_media_operation_unsupported");
      if (request.data.type === "empty-trash") {
        validateLostEmptyTrashOperation(db, operation, rootId, trashIds);
        emptyTrashOperations.add(operation.id);
        continue;
      }
      if (
        db
          .prepare(
            "SELECT 1 FROM file_operation_items WHERE operation_id = ? LIMIT 1"
          )
          .get(operation.id)
      )
        throw new ManagementConflictError("lost_media_operation_unsupported");
      if (
        request.data.destinationFolderId &&
        getManagedFolder(db, request.data.destinationFolderId)?.rootId !==
          rootId
      )
        throw new ManagementConflictError("lost_media_operation_crosses_roots");
      const journal = JSON.parse(operation.stateJson) as {
        items?: Array<Record<string, unknown>>;
      };
      if (
        !Array.isArray(journal.items) ||
        !journal.items.length ||
        journal.items.length > 100
      )
        throw new ManagementConflictError("lost_media_operation_unsupported");
      for (const item of journal.items) {
        if (!validOperationItemName(item.name))
          throw new ManagementConflictError("lost_media_operation_unsupported");
        let locations = 0;
        for (const key of ["source", "destination", "stage", "quarantine"]) {
          const location = item[key];
          if (location === undefined) continue;
          if (
            !location ||
            typeof location !== "object" ||
            !("rootId" in location) ||
            location.rootId !== rootId ||
            !("relativePath" in location) ||
            typeof location.relativePath !== "string"
          )
            throw new ManagementConflictError(
              "lost_media_operation_crosses_roots"
            );
          locations += 1;
        }
        if (!locations)
          throw new ManagementConflictError("lost_media_operation_unsupported");
      }
    }
    for (const operation of listPendingManagedOperations(db))
      if (!operationIds.includes(operation.id))
        assertUnclaimedForReconciliation(db, operation);
    if (trashIds.length) {
      const placeholders = trashIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM asset_search WHERE asset_id IN (SELECT asset_id FROM trash_records WHERE id IN (${placeholders}))`
      ).run(...trashIds);
      db.prepare(
        `DELETE FROM assets WHERE lifecycle = 'trashed' AND id IN (SELECT asset_id FROM trash_records WHERE id IN (${placeholders}))`
      ).run(...trashIds);
    }
    for (const operation of operations) {
      const state = JSON.parse(operation.stateJson) as {
        items: Array<Record<string, unknown>>;
      };
      if (emptyTrashOperations.has(operation.id)) {
        db.prepare(
          `UPDATE file_operation_items SET
           status = CASE WHEN phase IN ('published','committed') AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = file_operation_items.asset_id) THEN 'completed' ELSE 'failed' END,
           error = CASE WHEN phase IN ('published','committed') AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = file_operation_items.asset_id) THEN NULL ELSE 'media_lost' END,
           journal_json = CASE WHEN phase IN ('published','committed') AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = file_operation_items.asset_id)
             THEN json_remove(json_set(journal_json, '$.status', 'completed'), '$.errorCode')
             ELSE json_set(journal_json, '$.status', 'failed', '$.errorCode', 'media_lost') END,
           updated_at = @now
           WHERE operation_id = @operationId AND status NOT IN ('completed','failed','cancelled')
           AND json_extract(journal_json, '$.snapshotRootId') = @rootId`
        ).run({
          operationId: operation.id,
          rootId,
          now: acknowledgement.acknowledgedAt
        });
        const pending = db
          .prepare(
            "SELECT 1 FROM file_operation_items WHERE operation_id = ? AND status NOT IN ('completed','failed','cancelled') LIMIT 1"
          )
          .get(operation.id);
        const summary = managedOperationItemSummary(db, operation.id);
        updateManagedOperation(db, operation.id, {
          status: pending
            ? "queued"
            : summary.completed === summary.total
              ? "completed"
              : summary.completed
                ? "partial"
                : "failed",
          stateJson: JSON.stringify({
            ...state,
            lossAcknowledgement: acknowledgement
          })
        });
        continue;
      }
      updateManagedOperation(db, operation.id, {
        status: "failed",
        stateJson: JSON.stringify({
          ...state,
          items: state.items.map((item) =>
            ["completed", "failed", "cancelled"].includes(String(item.status))
              ? item
              : { ...item, status: "failed", errorCode: "media_lost" }
          ),
          lossAcknowledgement: acknowledgement
        })
      });
    }
    cancelUnclaimedOperationsForReconciliation(db, acknowledgement.id);
    db.prepare(
      "INSERT INTO media_loss_acknowledgements (id, root_id, records_json, created_at) VALUES (?, ?, ?, ?)"
    ).run(
      acknowledgement.id,
      rootId,
      JSON.stringify({ trashIds, operationIds }),
      acknowledgement.acknowledgedAt
    );
    recomputeAssetRankings(db, acknowledgement.acknowledgedAt);
    refreshManagedCounts(db);
    db.prepare(
      "UPDATE library_state SET writes_need_scan = 1, revision = revision + 1 WHERE id = 1"
    ).run();
  })();
}

function assertUnclaimedForReconciliation(
  db: AetherDatabase,
  operation: ManagedOperationRecord
): void {
  const request = FileOperationBody.safeParse(
    JSON.parse(operation.requestJson)
  );
  const state = JSON.parse(operation.stateJson) as {
    items?: Array<Record<string, unknown>>;
  };
  const refuse = () => {
    throw new ManagementConflictError("recovery_other_work_pending");
  };
  if (
    !request.success ||
    request.data.type === "add-media" ||
    !Array.isArray(state.items)
  )
    return refuse();
  if (request.data.type === "empty-trash") {
    if (
      state.items.length ||
      managedOperationItemSummary(db, operation.id).total !==
        request.data.expectedCount
    )
      return refuse();
    let afterIndex = -1;
    while (true) {
      const items = listManagedOperationItems(
        db,
        operation.id,
        true,
        100,
        afterIndex
      );
      if (!items.length) break;
      for (const stored of items) {
        const item = JSON.parse(stored.journalJson) as Record<string, unknown>;
        if (
          stored.phase !== "queued" ||
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          !validOperationItemName(item.name) ||
          Object.keys(item).some(
            (key) =>
              ![
                "input",
                "name",
                "sourceRevision",
                "snapshotRootId",
                "status",
                "errorCode"
              ].includes(key)
          )
        )
          return refuse();
        afterIndex = stored.itemIndex;
      }
    }
    return;
  }
  if (
    !state.items.length ||
    state.items.length > 100 ||
    db
      .prepare(
        "SELECT 1 FROM file_operation_items WHERE operation_id = ? LIMIT 1"
      )
      .get(operation.id)
  )
    return refuse();
  for (const item of state.items) {
    if (["completed", "failed", "cancelled"].includes(String(item.status)))
      continue;
    if (
      !["queued", "running", "needs_attention"].includes(String(item.status)) ||
      !item.input ||
      typeof item.input !== "object" ||
      !validOperationItemName(item.name) ||
      Object.keys(item).some(
        (key) => !["input", "name", "status", "errorCode"].includes(key)
      )
    )
      return refuse();
  }
}

/** A scan cannot run through a pending filesystem claim. Stop only work that
 * has never acquired one, so the required reconciliation can run after restart. */
function cancelUnclaimedOperationsForReconciliation(
  db: AetherDatabase,
  acknowledgementId: string
): void {
  for (const operation of listPendingManagedOperations(db)) {
    assertUnclaimedForReconciliation(db, operation);
    const request = FileOperationBody.parse(JSON.parse(operation.requestJson));
    const state = JSON.parse(operation.stateJson) as {
      items: Array<Record<string, unknown>>;
    };
    const next = {
      ...state,
      cancelRequested: true,
      cancelledForReconciliation: acknowledgementId
    };
    if (request.type === "empty-trash") {
      db.prepare(
        `UPDATE file_operation_items SET status = 'cancelled', journal_json = json_set(journal_json, '$.status', 'cancelled'), updated_at = ?
         WHERE operation_id = ? AND status NOT IN ('completed','failed','cancelled') AND phase = 'queued'`
      ).run(new Date().toISOString(), operation.id);
      const summary = managedOperationItemSummary(db, operation.id);
      updateManagedOperation(db, operation.id, {
        status:
          summary.completed === summary.total
            ? "completed"
            : summary.completed
              ? "partial"
              : summary.cancelled === summary.total
                ? "cancelled"
                : "failed",
        stateJson: JSON.stringify(next)
      });
    } else {
      next.items = state.items.map((item) =>
        ["completed", "failed", "cancelled"].includes(String(item.status))
          ? item
          : { ...item, status: "cancelled" }
      );
      const states = next.items.map((item) => item.status);
      updateManagedOperation(db, operation.id, {
        status: states.every((status) => status === "completed")
          ? "completed"
          : states.includes("completed")
            ? "partial"
            : states.every((status) => status === "cancelled")
              ? "cancelled"
              : "failed",
        stateJson: JSON.stringify(next)
      });
    }
  }
}

function validateLostEmptyTrashOperation(
  db: AetherDatabase,
  operation: ManagedOperationRecord,
  rootId: string,
  trashIds: string[]
): void {
  const ownership = getManagedRootOwnership(db, rootId);
  if (!ownership)
    throw new ManagementConflictError("lost_media_operation_unsupported");
  const operationState = JSON.parse(operation.stateJson) as {
    items?: unknown[];
  };
  if (!Array.isArray(operationState.items) || operationState.items.length)
    throw new ManagementConflictError("lost_media_operation_unsupported");
  const read = db.prepare(
    `SELECT i.id, i.item_index AS itemIndex, i.asset_id AS assetId, i.phase, i.journal_json AS journalJson,
     t.asset_id AS trashAssetId, t.physical_relative_path AS physicalRelativePath,
     a.root_id AS currentRootId, a.lifecycle, a.source_revision AS currentRevision
     FROM file_operation_items i
     LEFT JOIN trash_records t ON t.id = json_extract(i.journal_json, '$.input.trashId')
     LEFT JOIN assets a ON a.id = i.asset_id
     WHERE i.operation_id = ? AND i.item_index > ? AND i.status NOT IN ('completed','failed','cancelled')
     ORDER BY i.item_index LIMIT 100`
  );
  let cursor = -1;
  let matchingTrash = false;
  while (true) {
    const rows = read.all(operation.id, cursor) as Array<{
      id: string;
      itemIndex: number;
      assetId: string;
      phase: string;
      journalJson: string;
      trashAssetId: string | null;
      physicalRelativePath: string | null;
      currentRootId: string | null;
      lifecycle: string | null;
      currentRevision: number | null;
    }>;
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.itemIndex;
      const item = JSON.parse(row.journalJson) as Record<string, unknown>;
      const input = item?.input as Record<string, unknown> | undefined;
      if (
        !item ||
        !input ||
        typeof row.assetId !== "string" ||
        typeof input.trashId !== "string" ||
        Object.keys(input).some(
          (key) => key !== "trashId" && key !== "expectedVersion"
        ) ||
        input.assetId !== undefined ||
        input.folderId !== undefined ||
        !validOperationItemName(item.name) ||
        typeof item.snapshotRootId !== "string" ||
        Object.keys(item).some(
          (key) =>
            ![
              "input",
              "name",
              "sourceRevision",
              "snapshotRootId",
              "status",
              "phase",
              "source",
              "sourceAssetId",
              "manifest",
              "errorCode"
            ].includes(key)
        ) ||
        !["queued", "prepared", "purging", "published", "committed"].includes(
          row.phase
        ) ||
        (row.phase === "queued"
          ? item.phase !== undefined
          : item.phase !== row.phase)
      )
        throw new ManagementConflictError("lost_media_operation_unsupported");
      if (item.snapshotRootId !== rootId) {
        if (row.phase !== "queued" || item.source || item.manifest)
          throw new ManagementConflictError(
            "lost_media_operation_crosses_roots"
          );
        if (
          row.currentRootId !== item.snapshotRootId ||
          row.trashAssetId !== row.assetId ||
          row.lifecycle !== "trashed"
        )
          throw new ManagementConflictError("lost_media_record_mismatch");
        continue;
      }
      const completed =
        ["published", "committed"].includes(row.phase) &&
        !row.currentRootId &&
        !row.trashAssetId &&
        item.sourceAssetId === row.assetId;
      if (!completed) {
        const expectedVersion =
          typeof input.expectedVersion === "string"
            ? input.expectedVersion
            : Number.isSafeInteger(item.sourceRevision)
              ? sourceVersion(row.assetId, item.sourceRevision as number)
              : null;
        if (
          row.trashAssetId !== row.assetId ||
          row.currentRootId !== rootId ||
          row.lifecycle !== "trashed" ||
          row.currentRevision === null ||
          expectedVersion !== sourceVersion(row.assetId, row.currentRevision)
        )
          throw new ManagementConflictError("lost_media_record_mismatch");
        if (trashIds.includes(input.trashId)) matchingTrash = true;
      }
      if (row.phase !== "queued") {
        const source = item.source as Record<string, unknown> | undefined;
        const manifest = item.manifest as
          | {
              totalBytes?: number;
              entries?: Array<{
                relativePath?: string;
                sha256?: string;
                identity?: { kind?: string; dev?: string };
              }>;
            }
          | undefined;
        const entry = manifest?.entries?.[0];
        if (
          !source ||
          source.rootId !== rootId ||
          typeof source.relativePath !== "string" ||
          !source.relativePath.startsWith(".aether-trash/") ||
          !validRelativePath(source.relativePath) ||
          (!completed && source.relativePath !== row.physicalRelativePath) ||
          item.sourceAssetId !== row.assetId ||
          !manifest ||
          !Array.isArray(manifest.entries) ||
          manifest.entries.length !== 1 ||
          !entry ||
          entry.relativePath !== "" ||
          entry.identity?.kind !== "file" ||
          entry.identity.dev !== ownership.deviceId ||
          typeof entry.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(entry.sha256) ||
          typeof manifest.totalBytes !== "number" ||
          !Number.isSafeInteger(manifest.totalBytes) ||
          manifest.totalBytes < 0
        )
          throw new ManagementConflictError("lost_media_operation_unsupported");
      } else if (item.source || item.manifest || item.sourceAssetId)
        throw new ManagementConflictError("lost_media_operation_unsupported");
    }
  }
  if (!matchingTrash)
    throw new ManagementConflictError("lost_media_record_mismatch");
}

function requireAsset(
  db: AetherDatabase,
  id: string,
  version: string,
  lifecycle: ManagedAsset["lifecycle"]
): ManagedAsset {
  const asset = getManagedAsset(db, id);
  if (
    !asset ||
    asset.sourceVersion !== version ||
    asset.lifecycle !== lifecycle
  )
    throw new ManagementConflictError();
  return asset;
}

function validRelativePath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("/") &&
    !relativePath.includes("\\") &&
    relativePath
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          ![...part].some(
            (character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
          )
      )
  );
}

/** A historical label is not a managed destination name or a filesystem claim. */
function validOperationItemName(name: unknown): boolean {
  return (
    name === undefined ||
    (typeof name === "string" &&
      name.length > 0 &&
      name !== "." &&
      name !== ".." &&
      !name.includes("/") &&
      !name.includes("\0") &&
      Buffer.byteLength(name, "utf8") <= 4096)
  );
}

function assertDestination(
  db: AetherDatabase,
  rootId: string,
  folderId: string,
  relativePath: string,
  name: string
): void {
  const folder = getFolder(db, folderId);
  if (
    !folder ||
    folder.rootId !== rootId ||
    !validRelativePath(relativePath) ||
    name.startsWith(".") ||
    path.posix.basename(relativePath) !== name ||
    path.posix.dirname(relativePath) !== (folder.relativePath || ".")
  )
    throw new ManagementConflictError("invalid_destination");
}

function writeAssetLocation(
  db: AetherDatabase,
  input: {
    assetId: string;
    rootId: string;
    folderId: string;
    relativePath: string;
    name: string;
    identity?: ManagedFileIdentity;
    now?: string;
  }
): void {
  db.prepare(
    `UPDATE assets SET root_id = @rootId, folder_id = @folderId, relative_path = @relativePath, name = @name, indexed_at = @now WHERE id = @assetId`
  ).run({ ...input, now: input.now ?? new Date().toISOString() });
  if (input.identity)
    db.prepare(
      `UPDATE assets SET size_bytes = @sizeBytes, mtime_ms = @mtimeMs, fs_device_id = @fsDeviceId, fs_inode = @fsInode, fs_birthtime_ns = @fsBirthtimeNs, fs_ctime_ns = @fsCtimeNs WHERE id = @assetId`
    ).run({ ...input.identity, assetId: input.assetId });
  syncManagedSearch(db, input.assetId);
}

function syncManagedSearch(db: AetherDatabase, id: string): void {
  db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(id);
  const row = db
    .prepare(
      "SELECT id, root_id, folder_id, name, relative_path FROM assets WHERE id = ? AND lifecycle = 'active'"
    )
    .get(id) as
    | {
        id: string;
        root_id: string;
        folder_id: string;
        name: string;
        relative_path: string;
      }
    | undefined;
  if (row)
    db.prepare(
      "INSERT INTO asset_search (asset_id, root_id, folder_id, name, relative_path, search_ngrams) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      row.id,
      row.root_id,
      row.folder_id,
      row.name,
      row.relative_path,
      searchNgramText(`${row.name} ${row.relative_path}`)
    );
}

export function refreshManagedCounts(db: AetherDatabase): void {
  db.prepare(
    "UPDATE folders SET asset_count = (SELECT COUNT(*) FROM assets a WHERE a.folder_id = folders.id AND a.lifecycle = 'active')"
  ).run();
  db.prepare(
    "UPDATE tags SET usage_count = (SELECT COUNT(*) FROM asset_tags at JOIN assets a ON a.id = at.asset_id WHERE at.tag_id = tags.id AND a.lifecycle = 'active')"
  ).run();
  db.prepare(
    "DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM asset_tags WHERE tag_id = tags.id)"
  ).run();
}

function assertJson(value: string, maxBytes = 1024 * 1024): void {
  if (Buffer.byteLength(value) > maxBytes)
    throw new ManagementConflictError("operation_too_large");
  JSON.parse(value);
}
