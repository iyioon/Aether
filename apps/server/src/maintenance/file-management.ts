import { lstatSync, opendirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface FileManagementBlockers {
  operations: number;
  uploads: number;
  trash: number;
}

export function uploadStagingEntries(configDir: string): number {
  const stagingPath = path.join(path.dirname(configDir), "uploads");
  try {
    const info = lstatSync(stagingPath);
    if (!info.isDirectory() || info.isSymbolicLink()) return 1;
    const directory = opendirSync(stagingPath);
    try {
      let count = 0;
      while (count <= 100 && directory.readSync()) count += 1;
      return count;
    } finally {
      directory.closeSync();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return 0;
    throw error;
  }
}

/** Reads without migration: maintenance must not alter the state it validates. */
export function fileManagementBlockers(
  configDir: string
): FileManagementBlockers {
  const result: FileManagementBlockers = {
    operations: 0,
    uploads: uploadStagingEntries(configDir),
    trash: 0
  };
  const databasePath = path.join(configDir, "aether.sqlite");
  try {
    const stats = lstatSync(databasePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1)
      throw new Error("Unsafe Aether database.");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return result;
    throw error;
  }
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true
  });
  try {
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'file_operations'"
        )
        .get()
    )
      return result;
    result.operations = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM file_operations WHERE status NOT IN ('completed', 'partial', 'cancelled', 'failed')"
        )
        .get() as { count: number }
    ).count;
    result.uploads = Math.max(
      result.uploads,
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM managed_uploads WHERE status NOT IN ('completed', 'published', 'cancelled', 'expired', 'failed') OR COALESCE(json_extract(state_json,'$.cleanedUp'),0) != 1"
          )
          .get() as { count: number }
      ).count
    );
    result.trash = (
      db.prepare("SELECT COUNT(*) AS count FROM trash_records").get() as {
        count: number;
      }
    ).count;
    return result;
  } finally {
    db.close();
  }
}

export function assertNoFileManagementBlockers(configDir: string): void {
  const blockers = fileManagementBlockers(configDir);
  if (blockers.operations || blockers.uploads || blockers.trash) {
    throw new Error(
      "Finish or cancel file operations and uploads, and restore or permanently delete Trash before database maintenance."
    );
  }
}
