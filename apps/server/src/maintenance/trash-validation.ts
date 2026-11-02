import { realpath } from "node:fs/promises";
import type { AetherDatabase } from "../db/database.js";
import { FileOperationsFilesystem } from "../library/file-operations-filesystem.js";
import {
  getManagedRootOwnership,
  getTrashRecord
} from "../library/repository-management.js";

/** Database backups do not include originals. Verify retained payloads before
 * accepting metadata that could later authorize restoring or purging them. */
export async function validateTrashPayloads(
  db: AetherDatabase,
  allowedRootPaths?: readonly string[]
): Promise<void> {
  const records = db
    .prepare("SELECT id FROM trash_records ORDER BY id")
    .all() as Array<{ id: string }>;
  if (!records.length) return;
  const allowed =
    allowedRootPaths === undefined
      ? null
      : new Set(
          await Promise.all(allowedRootPaths.map((root) => realpath(root)))
        );
  const filesystem = new FileOperationsFilesystem();
  try {
    for (const { id } of records) {
      const record = getTrashRecord(db, id);
      if (!record || (allowed && !allowed.has(record.rootRealPath)))
        throw new Error("unavailable_root");
      const ownership = getManagedRootOwnership(db, record.identity.rootId);
      if (!ownership || !ownership.trashInode)
        throw new Error("unverified_root");
      const root = await filesystem.inspectRoot(record.rootRealPath);
      if (root.dev !== ownership.deviceId || root.ino !== ownership.inode)
        throw new Error("changed_root");
      const expectedRoot = { dev: ownership.deviceId, ino: ownership.inode };
      const trash = await filesystem.inspect({
        rootPath: record.rootRealPath,
        relativePath: ".aether-trash",
        expectedRoot
      });
      if (
        trash.kind !== "directory" ||
        trash.dev !== ownership.deviceId ||
        trash.ino !== ownership.trashInode
      )
        throw new Error("changed_trash");
      const manifest = await filesystem.inventory({
        rootPath: record.rootRealPath,
        relativePath: record.physicalRelativePath,
        expectedRoot
      });
      const payload = manifest.entries[0];
      const expected = record.identity;
      if (
        manifest.entries.length !== 1 ||
        !payload ||
        payload.identity.kind !== "file" ||
        payload.identity.dev !== expected.fsDeviceId ||
        payload.identity.ino !== expected.fsInode ||
        Number(payload.identity.size) !== expected.sizeBytes ||
        Number(BigInt(payload.identity.mtimeNs) / 1_000_000n) !==
          expected.mtimeMs ||
        !expected.contentSha256 ||
        payload.sha256 !== expected.contentSha256
      )
        throw new Error("changed_payload");
    }
  } catch {
    throw new Error(
      "Trash payloads could not be verified. Reconnect the original media roots and restore their original files before retrying."
    );
  }
}
