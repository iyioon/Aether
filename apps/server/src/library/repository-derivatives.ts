import type { AetherDatabase } from "../db/database.js";
import { mapDerivativeRow } from "./repository-mappers.js";
import type {
  AssetMediaMetadataInput,
  DerivativeRecord,
  DerivativeRow,
  UpsertDerivativeInput
} from "./repository-types.js";

export function removeObsoleteDerivativeRecords(
  db: AetherDatabase,
  includeUnfinished = false
): Array<{ assetId: string; path: string }> {
  return db.transaction(() => {
    const obsolete = `NOT EXISTS (
      SELECT 1 FROM assets a
      WHERE a.id = derivatives.asset_id AND a.mtime_ms = derivatives.source_mtime_ms
    ) ${includeUnfinished ? "OR status != 'ready'" : ""}`;
    const rows = db
      .prepare(
        `SELECT asset_id AS assetId, path FROM derivatives WHERE ${obsolete}`
      )
      .all() as Array<{ assetId: string; path: string }>;
    db.prepare(`DELETE FROM derivatives WHERE ${obsolete}`).run();
    if (includeUnfinished) {
      db.prepare(
        "UPDATE derivatives SET error = NULL WHERE error IS NOT NULL"
      ).run();
      db.prepare(
        "UPDATE assets SET error = CASE WHEN status = 'indexed' THEN NULL ELSE 'media_processing_failed' END WHERE error IS NOT NULL"
      ).run();
    }
    return rows;
  })();
}

export function deleteDerivativeRecords(
  db: AetherDatabase,
  ids: string[]
): void {
  const remove = db.prepare("DELETE FROM derivatives WHERE id = ?");
  db.transaction(() => {
    for (const id of ids) remove.run(id);
  })();
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
  db.prepare(
    `
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
  `
  ).run({
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

export function replaceSourceDerivative(
  db: AetherDatabase,
  input: UpsertDerivativeInput,
  sourceKey: string
): string[] {
  return db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT id, path, width, height FROM derivatives WHERE asset_id = ? AND kind = ?"
      )
      .all(input.assetId, input.kind) as Array<{
      id: string;
      path: string;
      width: number;
      height: number;
    }>;
    const retired = rows.filter(
      (row) =>
        !row.path.split(/[\\/]/).at(-1)!.startsWith(sourceKey) ||
        (row.path !== input.path &&
          row.width === input.width &&
          row.height === input.height)
    );
    const remove = db.prepare("DELETE FROM derivatives WHERE id = ?");
    for (const row of retired) remove.run(row.id);
    upsertDerivative(db, input);
    return retired
      .filter((row) => row.path !== input.path)
      .map((row) => row.path);
  })();
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
  ).run(
    input.width,
    input.height,
    input.durationMs,
    input.codec,
    input.assetId
  );
}
