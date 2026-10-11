import type { MediaRootConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { folderIdFor } from "./repository-folders.js";
import { recomputeAssetRankings } from "./repository-rankings.js";
import type {
  ScannedAssetInput,
  UpsertFolderInput
} from "./repository-types.js";
import { searchNgramText } from "./search-text.js";

export interface ScanReconciliationResult {
  removedAssets: number;
  removedAssetIds: string[];
  removedFolders: number;
}

interface ExistingAssetLocation {
  id: string;
  root_id: string;
  folder_id: string | null;
  relative_path: string;
  name: string;
}

/**
 * Applies one complete filesystem snapshot as a single database transaction.
 * Asset IDs in the snapshot have already been matched by content, so this
 * function only moves those stable identities and removes genuinely unseen
 * rows after every destination is in place.
 */
export function reconcileScannedLibrary(
  db: AetherDatabase,
  roots: MediaRootConfig[],
  folders: UpsertFolderInput[],
  assets: ScannedAssetInput[],
  scanMarker: string
): ScanReconciliationResult {
  const configuredRootIds = new Set(roots.map((root) => root.id));

  const transaction = db.transaction(() => {
    reconcileRoots(db, roots, scanMarker);
    reconcileFolders(db, folders);

    const existingAssets = db
      .prepare(
        `SELECT id, root_id, folder_id, relative_path, name
         FROM assets`
      )
      .all() as ExistingAssetLocation[];
    const existingById = new Map(
      existingAssets.map((asset) => [asset.id, asset])
    );

    const stageLocation = db.prepare(
      `UPDATE assets
       SET folder_id = NULL, relative_path = @temporaryPath
       WHERE id = @id`
    );

    // Moving every matched row out of the way first makes swaps and cycles
    // safe despite UNIQUE(root_id, relative_path).
    for (const asset of assets) {
      const existing = existingById.get(asset.id);
      if (
        existing &&
        (existing.root_id !== asset.rootId ||
          existing.relative_path !== asset.relativePath)
      ) {
        stageLocation.run({
          id: asset.id,
          temporaryPath: `.aether-reconcile/${scanMarker}/${asset.id}`
        });
      }
    }

    const findDestinationOccupant = db.prepare(
      `SELECT id
       FROM assets
       WHERE root_id = ? AND relative_path = ?`
    );
    const deleteSearchRow = db.prepare(
      "DELETE FROM asset_search WHERE asset_id = ?"
    );
    const deleteAsset = db.prepare("DELETE FROM assets WHERE id = ?");
    let removedAssets = 0;
    const removedAssetIds = new Set<string>();

    // A different identity still occupying an observed path is a replacement.
    // Remove it before inserting the new identity at that location.
    for (const asset of assets) {
      const occupant = findDestinationOccupant.get(
        asset.rootId,
        asset.relativePath
      ) as { id: string } | undefined;
      if (occupant && occupant.id !== asset.id) {
        deleteSearchRow.run(occupant.id);
        const result = deleteAsset.run(occupant.id);
        removedAssets += result.changes;
        if (result.changes > 0) {
          removedAssetIds.add(occupant.id);
        }
      }
    }

    const updateExisting = db.prepare(
      `UPDATE assets
       SET root_id = @rootId,
           folder_id = @folderId,
           relative_path = @relativePath,
           name = @name,
           extension = @extension,
           media_type = @mediaType,
           mime_type = @mimeType,
           size_bytes = @sizeBytes,
           mtime_ms = @mtimeMs,
           fingerprint = @fingerprint,
           content_sha256 = @contentSha256,
           fs_device_id = @fsDeviceId,
           fs_inode = @fsInode,
           fs_birthtime_ns = @fsBirthtimeNs,
           fs_ctime_ns = @fsCtimeNs,
           indexed_at = @seenAt,
           status = 'indexed',
           error = NULL
       WHERE id = @id`
    );
    const insertNew = db.prepare(
      `INSERT INTO assets
        (id, root_id, folder_id, relative_path, name, extension, media_type,
         mime_type, size_bytes, mtime_ms, width, height, fingerprint,
         content_sha256, fs_device_id, fs_inode, fs_birthtime_ns, fs_ctime_ns,
         indexed_at, status, error)
       VALUES
        (@id, @rootId, @folderId, @relativePath, @name, @extension,
         @mediaType, @mimeType, @sizeBytes, @mtimeMs, @width, @height,
         @fingerprint, @contentSha256, @fsDeviceId, @fsInode,
         @fsBirthtimeNs, @fsCtimeNs, @seenAt, 'indexed', NULL)`
    );

    for (const asset of assets) {
      const existing = existingById.get(asset.id);
      if (existing) {
        updateExisting.run(asset);
      } else {
        insertNew.run(asset);
      }

      if (
        !existing ||
        existing.root_id !== asset.rootId ||
        existing.folder_id !== asset.folderId ||
        existing.relative_path !== asset.relativePath ||
        existing.name !== asset.name
      ) {
        syncAssetSearchRow(db, asset);
      }
    }

    const staleAssets = db
      .prepare(
        `SELECT id
         FROM assets
         WHERE indexed_at <> ?`
      )
      .all(scanMarker) as Array<{ id: string }>;
    db.prepare(
      `DELETE FROM asset_search
       WHERE asset_id IN (
         SELECT id FROM assets WHERE indexed_at <> ?
       )`
    ).run(scanMarker);
    db.prepare("DELETE FROM assets WHERE indexed_at <> ?").run(scanMarker);
    removedAssets += staleAssets.length;
    for (const asset of staleAssets) {
      removedAssetIds.add(asset.id);
    }

    const removedFolders = db
      .prepare(
        `DELETE FROM folders
         WHERE relative_path <> '' AND updated_at <> ?`
      )
      .run(scanMarker).changes;

    const existingRoots = db.prepare("SELECT id FROM roots").all() as Array<{
      id: string;
    }>;
    const deleteRootSearchRows = db.prepare(
      "DELETE FROM asset_search WHERE root_id = ?"
    );
    const deleteRoot = db.prepare("DELETE FROM roots WHERE id = ?");
    for (const root of existingRoots) {
      if (!configuredRootIds.has(root.id)) {
        deleteRootSearchRows.run(root.id);
        deleteRoot.run(root.id);
      }
    }

    if (removedAssets > 0) {
      refreshTagUsageCounts(db);
      recomputeAssetRankings(db, scanMarker);
    }

    repairMissingSearchRows(db);
    refreshFolderAssetCounts(db);

    return {
      removedAssets,
      removedAssetIds: [...removedAssetIds],
      removedFolders
    };
  });

  return transaction();
}

function reconcileRoots(
  db: AetherDatabase,
  roots: MediaRootConfig[],
  scanMarker: string
): void {
  const findPathConflict = db.prepare(
    "SELECT id FROM roots WHERE real_path = ? AND id <> ?"
  );
  const parkConflictingRoot = db.prepare(
    "UPDATE roots SET real_path = ? WHERE id = ?"
  );
  const upsertRoot = db.prepare(
    `INSERT INTO roots (id, label, real_path, created_at)
     VALUES (@id, @label, @realPath, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       real_path = excluded.real_path`
  );
  const upsertRootFolder = db.prepare(
    `INSERT INTO folders
      (id, root_id, parent_id, relative_path, name, asset_count, created_at, updated_at)
     VALUES
      (@id, @rootId, NULL, '', @name, 0, @createdAt, @updatedAt)
     ON CONFLICT(root_id, relative_path) DO UPDATE SET
       name = excluded.name,
       parent_id = NULL,
       updated_at = excluded.updated_at`
  );

  for (const root of roots) {
    const conflict = findPathConflict.get(root.realPath, root.id) as
      { id: string } | undefined;
    if (conflict) {
      parkConflictingRoot.run(
        `.aether-detached/${scanMarker}/${conflict.id}`,
        conflict.id
      );
    }

    upsertRoot.run({
      id: root.id,
      label: root.label,
      realPath: root.realPath,
      createdAt: scanMarker
    });
    upsertRootFolder.run({
      id: folderIdFor(root.id, ""),
      rootId: root.id,
      name: root.label,
      createdAt: scanMarker,
      updatedAt: scanMarker
    });
  }
}

function reconcileFolders(
  db: AetherDatabase,
  folders: UpsertFolderInput[]
): void {
  const upsert = db.prepare(
    `INSERT INTO folders
      (id, root_id, parent_id, relative_path, name, asset_count, created_at, updated_at)
     VALUES
      (@id, @rootId, @parentId, @relativePath, @name, 0, @seenAt, @seenAt)
     ON CONFLICT(root_id, relative_path) DO UPDATE SET
       parent_id = excluded.parent_id,
       name = excluded.name,
       updated_at = excluded.updated_at`
  );

  for (const folder of folders) {
    upsert.run({
      ...folder,
      id: folderIdFor(folder.rootId, folder.relativePath)
    });
  }
}

function syncAssetSearchRow(
  db: AetherDatabase,
  asset: Pick<
    ScannedAssetInput,
    "id" | "rootId" | "folderId" | "name" | "relativePath"
  >
): void {
  db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(asset.id);
  db.prepare(
    `INSERT INTO asset_search
      (asset_id, root_id, folder_id, name, relative_path, search_ngrams)
     VALUES
      (@id, @rootId, @folderId, @name, @relativePath, @searchNgrams)`
  ).run({
    ...asset,
    searchNgrams: searchNgramText(`${asset.name} ${asset.relativePath}`)
  });
}

function repairMissingSearchRows(db: AetherDatabase): void {
  db.prepare(
    `DELETE FROM asset_search
     WHERE asset_id NOT IN (SELECT id FROM assets)`
  ).run();
  db.prepare(
    `INSERT INTO asset_search
      (asset_id, root_id, folder_id, name, relative_path, search_ngrams)
     SELECT
       a.id,
       a.root_id,
       a.folder_id,
       a.name,
       a.relative_path,
       aether_search_ngrams(a.name || ' ' || a.relative_path)
     FROM assets a
     WHERE NOT EXISTS (
       SELECT 1 FROM asset_search s WHERE s.asset_id = a.id
     )`
  ).run();
}

function refreshTagUsageCounts(db: AetherDatabase): void {
  db.prepare(
    `UPDATE tags
     SET usage_count = (
       SELECT COUNT(*)
       FROM asset_tags
       WHERE asset_tags.tag_id = tags.id
     )`
  ).run();
  db.prepare("DELETE FROM tags WHERE usage_count = 0").run();
}

function refreshFolderAssetCounts(db: AetherDatabase): void {
  db.prepare(
    `UPDATE folders
     SET asset_count = (
       SELECT COUNT(*)
       FROM assets
       WHERE assets.folder_id = folders.id
     )`
  ).run();
}
