import type { MediaRootConfig } from "../config/config.js";
import { randomUUID } from "node:crypto";
import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
import { mapFolderRow } from "./repository-mappers.js";
import { recomputeAssetRankings } from "./repository-rankings.js";
import type {
  FolderRecord,
  FolderRow,
  UpsertFolderInput
} from "./repository-types.js";

export function folderIdFor(rootId: string, relativePath: string): string {
  return stableId("folder", rootId, relativePath);
}

export function storedFolderIdFor(
  db: AetherDatabase,
  rootId: string,
  relativePath: string
): string {
  const stored = db
    .prepare("SELECT id FROM folders WHERE root_id = ? AND relative_path = ?")
    .get(rootId, relativePath) as { id: string } | undefined;
  if (stored) return stored.id;
  const candidate = folderIdFor(rootId, relativePath);
  return db.prepare("SELECT 1 FROM folders WHERE id = ?").get(candidate)
    ? stableId("folder", rootId, relativePath, randomUUID())
    : candidate;
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
      label = excluded.label
  `);

  const upsertRootFolder = db.prepare(`
    INSERT INTO folders (id, root_id, parent_id, relative_path, name, asset_count, created_at, updated_at)
    VALUES (@id, @rootId, NULL, '', @name, 0, @createdAt, @updatedAt)
    ON CONFLICT(root_id, relative_path) DO UPDATE SET
      name = excluded.name,
      parent_id = NULL,
      updated_at = excluded.updated_at
  `);

  const findPathConflict = db.prepare(
    "SELECT id FROM roots WHERE real_path = ? AND id <> ?"
  );
  const transaction = db.transaction(() => {
    for (const root of roots) {
      const conflict = findPathConflict.get(root.realPath, root.id) as
        { id: string } | undefined;

      // A complete scan resolves root-ID/path transitions atomically. Startup
      // synchronization is deliberately additive so configuration changes can
      // never delete the previous library before media reconciliation runs.
      if (conflict) {
        continue;
      }

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
  });

  transaction();
}

export function upsertFolder(
  db: AetherDatabase,
  input: UpsertFolderInput
): string {
  const id =
    input.id ?? storedFolderIdFor(db, input.rootId, input.relativePath);
  db.prepare(
    `
    INSERT INTO folders
      (id, root_id, parent_id, relative_path, name, asset_count, created_at, updated_at)
    VALUES
      (@id, @rootId, @parentId, @relativePath, @name, 0, @seenAt, @seenAt)
    ON CONFLICT(root_id, relative_path) DO UPDATE SET
      parent_id = excluded.parent_id,
      name = excluded.name,
      updated_at = excluded.updated_at
  `
  ).run({
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
  const transaction = db.transaction(() => {
    db.prepare(
      `DELETE FROM asset_search
       WHERE asset_id IN (
         SELECT id
         FROM assets
         WHERE root_id = ? AND lifecycle = 'active' AND indexed_at <> ?
       )`
    ).run(rootId, seenAt);

    const removedAssets = db
      .prepare(
        "DELETE FROM assets WHERE root_id = ? AND lifecycle = 'active' AND indexed_at <> ?"
      )
      .run(rootId, seenAt).changes;

    const removedFolders = db
      .prepare(
        "DELETE FROM folders WHERE root_id = ? AND relative_path <> '' AND updated_at <> ?"
      )
      .run(rootId, seenAt).changes;

    if (removedAssets > 0) {
      recomputeAssetRankings(db, seenAt);
    }

    return { removedAssets, removedFolders };
  });

  return transaction();
}

export function refreshFolderAssetCounts(
  db: AetherDatabase,
  rootId: string
): void {
  db.prepare(
    `
    UPDATE folders
    SET asset_count = (
      SELECT COUNT(*)
      FROM assets
      WHERE assets.folder_id = folders.id AND assets.lifecycle = 'active'
    )
    WHERE root_id = ?
  `
  ).run(rootId);
}

export function listFolders(db: AetherDatabase): FolderRecord[] {
  const rows = db
    .prepare(
      `SELECT id, root_id, parent_id, relative_path, name, asset_count, source_revision
       FROM folders
       ORDER BY root_id, relative_path COLLATE NOCASE`
    )
    .all() as FolderRow[];

  return rows.map(mapFolderRow);
}

export function getFoldersByIds(
  db: AetherDatabase,
  folderIds: string[]
): FolderRecord[] {
  const ids = [...new Set(folderIds)].slice(0, 100);
  if (!ids.length) return [];
  const rows = db
    .prepare(
      `SELECT id, root_id, parent_id, relative_path, name, asset_count, source_revision FROM folders WHERE id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as FolderRow[];
  const byId = new Map(rows.map((row) => [row.id, mapFolderRow(row)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export function getFolder(
  db: AetherDatabase,
  folderId: string
): FolderRecord | null {
  const row = db
    .prepare(
      `SELECT id, root_id, parent_id, relative_path, name, asset_count, source_revision
       FROM folders
       WHERE id = ?`
    )
    .get(folderId) as FolderRow | undefined;

  return row ? mapFolderRow(row) : null;
}
