import { randomUUID } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type { AetherDataPaths } from "../config/data-directory.js";
import { validateLatestAetherSchema } from "../db/database.js";
import {
  acknowledgeLostManagedRecords,
  getManagedRootOwnership,
  getManagedRootLocation,
  getTrashRecord,
  listMediaRecoveryRecords,
  ManagementConflictError,
  type MediaLossAcknowledgement
} from "../library/repository-management.js";
import { withDataDirectoryRecoveryLock } from "./data-directory.js";
import { fileManagementBlockers } from "./file-management.js";

export interface AcknowledgeLostMediaOptions {
  paths: AetherDataPaths;
  workspaceRoot: string;
  mediaRootPaths: string[];
  rootId: string;
  trashIds: string[];
  operationIds: string[];
  confirmLostMedia: boolean;
}

export async function listLostMediaRecovery(
  options: Pick<
    AcknowledgeLostMediaOptions,
    "paths" | "workspaceRoot" | "mediaRootPaths"
  > & { after?: string }
): Promise<ReturnType<typeof listMediaRecoveryRecords>> {
  if (
    options.after &&
    !/^(trash|operation):[a-zA-Z0-9_-]{1,256}$/.test(options.after)
  )
    throw new Error("The recovery cursor is invalid.");
  return withDataDirectoryRecoveryLock(
    options.paths,
    options.workspaceRoot,
    options.mediaRootPaths,
    async () => {
      const databasePath = path.join(options.paths.configDir, "aether.sqlite");
      const info = await lstat(databasePath);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
        throw new Error("Recovery requires a regular Aether database.");
      const db = new Database(databasePath, {
        fileMustExist: true,
        readonly: true
      });
      try {
        validateLatestAetherSchema(db);
        return listMediaRecoveryRecords(db, options.after);
      } finally {
        db.close();
      }
    }
  );
}

export async function acknowledgeLostMedia(
  options: AcknowledgeLostMediaOptions
): Promise<MediaLossAcknowledgement> {
  if (!options.confirmLostMedia)
    throw new Error("Lost media recovery requires --confirm-lost-media.");
  const ids = [...options.trashIds, ...options.operationIds];
  if (
    !/^[a-zA-Z0-9_-]{1,256}$/.test(options.rootId) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => !/^[a-zA-Z0-9_-]{1,256}$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new Error(
      "Specify one root ID and up to 100 distinct Trash or operation IDs."
    );
  return withDataDirectoryRecoveryLock(
    options.paths,
    options.workspaceRoot,
    options.mediaRootPaths,
    async () => {
      const databasePath = path.join(options.paths.configDir, "aether.sqlite");
      const info = await lstat(databasePath);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
        throw new Error("Recovery requires a regular Aether database.");
      const db = new Database(databasePath, { fileMustExist: true });
      try {
        db.pragma("foreign_keys = ON");
        db.pragma("busy_timeout = 5000");
        db.pragma("synchronous = FULL");
        db.pragma("fullfsync = ON");
        validateLatestAetherSchema(db);
        if (fileManagementBlockers(options.paths.configDir).uploads)
          throw new Error(
            "Finish or cancel uploads before acknowledging lost media."
          );
        const ownership = getManagedRootOwnership(db, options.rootId);
        const rootPath = getManagedRootLocation(db, options.rootId);
        if (
          !ownership ||
          !rootPath ||
          !/^\d+$/.test(ownership.deviceId) ||
          !/^\d+$/.test(ownership.inode)
        )
          throw new Error(
            "The selected root has no verified media ownership record."
          );
        const candidates = new Set(options.mediaRootPaths);
        if (path.isAbsolute(rootPath)) candidates.add(rootPath);
        else if (!rootPath.startsWith(".aether-detached/"))
          throw new Error("The recorded root location is invalid.");
        for (const id of options.trashIds) {
          const record = getTrashRecord(db, id);
          if (record && path.isAbsolute(record.identity.rootRealPath))
            candidates.add(record.identity.rootRealPath);
        }
        for (const candidate of candidates) {
          try {
            const observed = await stat(candidate, { bigint: true });
            if (
              String(observed.dev) === ownership.deviceId &&
              String(observed.ino) === ownership.inode
            )
              throw new OriginalMediaPresentError();
          } catch (error) {
            if (error instanceof OriginalMediaPresentError) throw error;
            if (
              error instanceof Error &&
              "code" in error &&
              (error.code === "ENOENT" || error.code === "ENOTDIR")
            )
              continue;
            throw new Error(
              "Media availability could not be checked. Resolve drive access errors before acknowledging lost media."
            );
          }
        }
        const acknowledgement: MediaLossAcknowledgement = {
          id: randomUUID(),
          rootId: options.rootId,
          trashIds: options.trashIds,
          operationIds: options.operationIds,
          acknowledgedAt: new Date().toISOString()
        };
        try {
          acknowledgeLostManagedRecords(db, acknowledgement);
        } catch (error) {
          if (
            error instanceof ManagementConflictError &&
            error.code === "recovery_other_work_pending"
          )
            throw new Error(
              "Finish or cancel file operations on other roots before acknowledging lost media."
            );
          throw error;
        }
        db.pragma("wal_checkpoint(TRUNCATE)");
        return acknowledgement;
      } finally {
        db.close();
      }
    }
  );
}

class OriginalMediaPresentError extends Error {
  constructor() {
    super(
      "The original media root is still available. Finish its operations or restore or permanently delete its Trash normally."
    );
  }
}
