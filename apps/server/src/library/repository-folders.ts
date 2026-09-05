import type { MediaRootConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
import { mapFolderRow } from "./repository-mappers.js";
import type {
  FolderRecord,
  FolderRow,
  UpsertFolderInput
} from "./repository-types.js";

export function folderIdFor(rootId: string, relativePath: string): string {
  return stableId("folder", rootId, relativePath);
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

export function refreshFolderAssetCounts(
  db: AetherDatabase,
  rootId: string
): void {
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

export function getFolder(
  db: AetherDatabase,
  folderId: string
): FolderRecord | null {
  const row = db
    .prepare(
      `SELECT id, root_id, parent_id, relative_path, name, asset_count
       FROM folders
       WHERE id = ?`
    )
    .get(folderId) as FolderRow | undefined;

  return row ? mapFolderRow(row) : null;
}
