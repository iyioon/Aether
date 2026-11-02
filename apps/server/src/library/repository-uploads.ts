import type { AetherDatabase } from "../db/database.js";
import { ManagementConflictError } from "./repository-management.js";

export interface ManagedUpload {
  id: string;
  requestId: string;
  folderId: string;
  expectedParentVersion: string;
  name: string;
  conflict: "skip" | "keep-both";
  size: number;
  offset: number;
  status:
    | "receiving"
    | "validating"
    | "publishing"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  operationId?: string;
  errorCode?: string;
  expiresAt: string;
  stagingIdentity?: { dev: string; ino: string };
  stagingDevice?: string;
  destinationDevice?: string;
  destinationRootId?: string;
  cleanedUp?: boolean;
}

export function getManagedUpload(
  db: AetherDatabase,
  id: string
): ManagedUpload | null {
  const row = db
    .prepare("SELECT state_json FROM managed_uploads WHERE id = ?")
    .get(id) as { state_json: string } | undefined;
  return row ? (JSON.parse(row.state_json) as ManagedUpload) : null;
}

export function getManagedUploadByRequestId(
  db: AetherDatabase,
  requestId: string
): ManagedUpload | null {
  const row = db
    .prepare("SELECT state_json FROM managed_uploads WHERE request_id = ?")
    .get(requestId) as { state_json: string } | undefined;
  return row ? (JSON.parse(row.state_json) as ManagedUpload) : null;
}

export function createManagedUpload(
  db: AetherDatabase,
  upload: ManagedUpload,
  maxStagingBytes: number
): void {
  db.transaction(() => {
    if (isManagedUploadCancelled(db, upload.requestId))
      throw new ManagementConflictError("upload_cancelled");
    const admission = db
      .prepare(
        "SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes),0) AS bytes FROM managed_uploads WHERE COALESCE(json_extract(state_json, '$.cleanedUp'),0) != 1"
      )
      .get() as { count: number; bytes: number };
    if (
      admission.count >= 100 ||
      admission.bytes + upload.size > maxStagingBytes
    )
      throw new ManagementConflictError("upload_budget_exceeded");
    if (
      db
        .prepare("SELECT id FROM managed_uploads WHERE request_id = ?")
        .get(upload.requestId)
    )
      throw new ManagementConflictError("request_id_conflict");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO managed_uploads(id,request_id,state_json,status,size_bytes,received_bytes,created_at,updated_at,expires_at)
      VALUES (@id,@requestId,@stateJson,@status,@size,0,@now,@now,@expiresAt)`
    ).run({ ...upload, stateJson: JSON.stringify(upload), now });
  })();
}

export function isManagedUploadCancelled(
  db: AetherDatabase,
  requestId: string
): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM upload_cancellations WHERE request_id = ? AND expires_at > ?"
    )
    .get(requestId, new Date().toISOString());
}

/** Cancel intent commits before a delayed tus creation can reserve its request
 * ID. Existing validation/publication work must finish through Activity. */
export function cancelManagedUploadByRequestId(
  db: AetherDatabase,
  requestId: string
): ManagedUpload | null {
  return db
    .transaction(() => {
      const upload = getManagedUploadByRequestId(db, requestId);
      if (
        upload &&
        ["validating", "publishing", "completed"].includes(upload.status)
      )
        throw new ManagementConflictError("upload_not_cancellable");
      const now = new Date();
      db.prepare(
        `INSERT INTO upload_cancellations (request_id, created_at, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET expires_at = MAX(upload_cancellations.expires_at, excluded.expires_at)`
      ).run(
        requestId,
        now.toISOString(),
        new Date(now.getTime() + 7 * 86400_000).toISOString()
      );
      if (!upload) return null;
      const cancelled: ManagedUpload = { ...upload, status: "cancelled" };
      updateManagedUpload(db, cancelled);
      return cancelled;
    })
    .immediate();
}

export function pruneUploadCancellations(
  db: AetherDatabase,
  now = new Date(),
  limit = 100
): number {
  return db
    .prepare(
      "DELETE FROM upload_cancellations WHERE request_id IN (SELECT request_id FROM upload_cancellations WHERE expires_at <= ? ORDER BY expires_at, request_id LIMIT ?)"
    )
    .run(now.toISOString(), Math.max(1, Math.min(100, limit))).changes;
}

export function updateManagedUpload(
  db: AetherDatabase,
  upload: ManagedUpload
): void {
  if (
    !Number.isSafeInteger(upload.offset) ||
    upload.offset < 0 ||
    upload.offset > upload.size
  )
    throw new ManagementConflictError("upload_offset_invalid");
  db.prepare(
    "UPDATE managed_uploads SET state_json = ?, status = ?, received_bytes = ?, operation_id = ?, updated_at = ?, expires_at = ? WHERE id = ?"
  ).run(
    JSON.stringify(upload),
    upload.status,
    upload.offset,
    upload.operationId ?? null,
    new Date().toISOString(),
    upload.expiresAt,
    upload.id
  );
}

export function listManagedUploads(db: AetherDatabase): ManagedUpload[] {
  return (
    db
      .prepare(
        "SELECT state_json FROM managed_uploads ORDER BY CASE WHEN status IN ('receiving','validating','publishing') THEN 0 WHEN COALESCE(json_extract(state_json,'$.cleanedUp'),0) != 1 THEN 1 ELSE 2 END, updated_at DESC,id LIMIT 100"
      )
      .all() as Array<{ state_json: string }>
  ).map((row) => JSON.parse(row.state_json) as ManagedUpload);
}

export function listUnsettledManagedUploads(
  db: AetherDatabase
): ManagedUpload[] {
  return (
    db
      .prepare(
        "SELECT state_json FROM managed_uploads WHERE COALESCE(json_extract(state_json,'$.cleanedUp'),0) != 1 OR status IN ('receiving','validating','publishing') ORDER BY created_at,id"
      )
      .all() as Array<{ state_json: string }>
  ).map((row) => JSON.parse(row.state_json) as ManagedUpload);
}

/** Bytes not yet allocated on disk, including destination publication copies. */
export function uploadVolumeReservations(
  db: AetherDatabase,
  excludeUploadId?: string
): Map<string, bigint> {
  const reservations = new Map<string, bigint>();
  const add = (device: string | undefined, bytes: number) => {
    if (device && bytes > 0)
      reservations.set(
        device,
        (reservations.get(device) ?? 0n) + BigInt(bytes)
      );
  };
  for (const upload of listUnsettledManagedUploads(db)) {
    if (
      upload.id === excludeUploadId ||
      !["receiving", "validating", "publishing"].includes(upload.status)
    )
      continue;
    add(upload.stagingDevice, Math.max(0, upload.size - upload.offset));
    add(upload.destinationDevice, upload.size);
  }
  return reservations;
}
