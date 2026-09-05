import type { AetherDatabase } from "../db/database.js";
import { mapDerivativeRow } from "./repository-mappers.js";
import type {
  AssetMediaMetadataInput,
  DerivativeRecord,
  DerivativeRow,
  UpsertDerivativeInput
} from "./repository-types.js";

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
