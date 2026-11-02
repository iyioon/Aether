import path from "node:path";
import { z } from "zod";
import type { AetherDatabase } from "../db/database.js";
import {
  FileManagementError,
  FileOperationItem,
  validateManagedName
} from "./file-operation-model.js";
import type {
  FileOperationIdentity,
  FileOperationLocation,
  FileOperationsFilesystem
} from "./file-operations-filesystem.js";
import {
  getLibraryRevision,
  getManagedAssetsByIds,
  getManagedFoldersByIds,
  getTrashRecordsByIds,
  createManagedDestinationProbe,
  type ManagedAsset,
  type ManagedFolder
} from "./repository-management.js";
import { detectMediaType } from "./media-types.js";

const Choice = z.enum(["skip", "keep-both"]);
export const FileOperationPreviewBody = z
  .object({
    type: z.enum(["move-media", "move-folder", "restore", "add-media"]),
    items: z.array(FileOperationItem).max(100).default([]),
    files: z
      .array(
        z
          .object({
            clientId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
            name: z.string().min(1).max(255),
            conflict: Choice.optional()
          })
          .strict()
      )
      .max(100)
      .default([]),
    destinationFolderId: z.string().min(1).max(256).optional(),
    expectedParentVersion: z.string().min(1).max(256).optional(),
    conflict: Choice.default("skip")
  })
  .strict()
  .superRefine((body, context) => {
    const invalid = () =>
      context.addIssue({ code: "custom", message: "Invalid preview." });
    if (
      Boolean(body.destinationFolderId) !== Boolean(body.expectedParentVersion)
    )
      invalid();
    if (body.type === "add-media") {
      if (
        !body.files.length ||
        body.items.length ||
        !body.destinationFolderId ||
        new Set(body.files.map((file) => file.clientId)).size !==
          body.files.length
      )
        invalid();
    } else {
      const key =
        body.type === "move-folder"
          ? "folderId"
          : body.type === "restore"
            ? "trashId"
            : "assetId";
      if (
        !body.items.length ||
        body.files.length ||
        body.items.some((item) => !item[key]) ||
        new Set(body.items.map((item) => item[key])).size !==
          body.items.length ||
        (body.type === "move-folder" && body.items.length !== 1) ||
        (body.type !== "restore" && !body.destinationFolderId)
      )
        invalid();
    }
  });

export type FileOperationPreviewRequest = z.infer<
  typeof FileOperationPreviewBody
>;
export interface FileOperationPreviewItem {
  key: string;
  index: number;
  name: string;
  destinationFolderId: string;
  destinationLabel: string;
  expectedParentVersion: string;
  hasConflict: boolean;
  proposedName: string | null;
  choice: "skip" | "keep-both";
  noOp: boolean;
}
export interface FileOperationPreview {
  revision: string;
  items: FileOperationPreviewItem[];
}
interface PreviewContext {
  location: (rootId: string, relativePath: string) => FileOperationLocation;
  verifyAssetIdentity: (
    asset: ManagedAsset,
    actual: FileOperationIdentity
  ) => void;
  rootLabel: (rootId: string) => string;
}

/** The same suffix calculation is used during authoritative publication. */
export function managedConflictName(
  name: string,
  folder: boolean,
  suffix: number
): string {
  const extension = folder ? "" : path.posix.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  return validateManagedName(`${stem} (${suffix})${extension}`);
}

/** Advisory names only: no reservation, operation record or filesystem mutation
 * occurs here. Publication revalidates the reviewed destination independently. */
export async function previewFileOperation(
  db: AetherDatabase,
  filesystem: FileOperationsFilesystem,
  request: FileOperationPreviewRequest,
  context: PreviewContext,
  signal?: AbortSignal
): Promise<FileOperationPreview> {
  const checkAbort = () => {
    if (signal?.aborted) throw new FileManagementError("preview_cancelled");
  };
  checkAbort();
  const assets = getManagedAssetsByIds(
    db,
    request.items.flatMap((item) => (item.assetId ? [item.assetId] : []))
  );
  const trash = getTrashRecordsByIds(
    db,
    request.items.flatMap((item) => (item.trashId ? [item.trashId] : []))
  );
  const folders = getManagedFoldersByIds(db, [
    ...request.items.flatMap((item) => (item.folderId ? [item.folderId] : [])),
    ...(request.destinationFolderId
      ? [request.destinationFolderId]
      : [...trash.values()].flatMap((record) =>
          record.originalFolderId ? [record.originalFolderId] : []
        ))
  ]);
  const indexedExists = createManagedDestinationProbe(db);
  const result: FileOperationPreviewItem[] = [];
  const occupied = new Map<string, boolean>();
  const reserved = new Set<string>();
  const parents = new Map<string, ManagedFolder>();
  const keyForPath = (rootId: string, relativePath: string) =>
    JSON.stringify([rootId, relativePath]);
  async function exists(parent: ManagedFolder, name: string): Promise<boolean> {
    checkAbort();
    const relativePath = path.posix.join(parent.relativePath, name);
    const key = keyForPath(parent.rootId, relativePath);
    if (reserved.has(key)) return true;
    if (!occupied.has(key))
      occupied.set(
        key,
        indexedExists(parent.rootId, relativePath) ||
          (await filesystem.entryExists(
            context.location(parent.rootId, relativePath)
          ))
      );
    return occupied.get(key)!;
  }
  async function verifyParent(parent: ManagedFolder): Promise<void> {
    checkAbort();
    if (parent.relativePath.split("/").some((part) => part.startsWith(".")))
      throw new FileManagementError("invalid_destination");
    const location = context.location(parent.rootId, parent.relativePath);
    const actual = await filesystem.inspect(location);
    const device = parent.relativePath
      ? parent.fsDeviceId
      : location.expectedRoot?.dev;
    const inode = parent.relativePath
      ? parent.fsInode
      : location.expectedRoot?.ino;
    if (
      actual.kind !== "directory" ||
      actual.dev !== device ||
      actual.ino !== inode
    )
      throw new FileManagementError("destination_changed");
  }
  const count =
    request.type === "add-media" ? request.files.length : request.items.length;
  for (let index = 0; index < count; index++) {
    checkAbort();
    const item = request.items[index];
    const file = request.files[index];
    const folder = request.type === "move-folder";
    const choice =
      (request.type === "add-media" ? file?.conflict : item?.conflict) ??
      request.conflict;
    let name: string;
    let key: string;
    let originalFolderId: string | null = null;
    let source: { rootId: string; relativePath: string } | null = null;
    if (request.type === "add-media") {
      name = validateManagedName(file!.name);
      if (!detectMediaType(path.posix.extname(name)))
        throw new FileManagementError("unsupported_media");
      key = `upload:${file!.clientId}`;
    } else {
      const record = item!.assetId
        ? assets.get(item!.assetId)
        : item!.folderId
          ? folders.get(item!.folderId)
          : trash.get(item!.trashId!);
      if (!record) throw new FileManagementError("source_not_found");
      if (record.sourceVersion !== item!.expectedVersion)
        throw new FileManagementError("source_changed");
      if ("lifecycle" in record && record.lifecycle !== "active")
        throw new FileManagementError("source_not_found");
      if (folder && !(record as ManagedFolder).relativePath)
        throw new FileManagementError("protected_root");
      const retained = "physicalRelativePath" in record ? record : null;
      const rootId = retained
        ? retained.identity.rootId
        : (record as ManagedAsset).rootId;
      const relativePath = retained
        ? retained.physicalRelativePath
        : (record as ManagedAsset).relativePath;
      const actual = await filesystem.inspect(
        context.location(rootId, relativePath)
      );
      if (folder) {
        const stored = record as ManagedFolder;
        if (
          actual.kind !== "directory" ||
          actual.dev !== stored.fsDeviceId ||
          actual.ino !== stored.fsInode
        )
          throw new FileManagementError("source_changed");
      } else
        context.verifyAssetIdentity(
          retained ? retained.identity : (record as ManagedAsset),
          actual
        );
      name = validateManagedName(
        retained
          ? retained.originalName
          : (record as ManagedAsset | ManagedFolder).name
      );
      originalFolderId = retained?.originalFolderId ?? null;
      source = { rootId, relativePath };
      key = item!.assetId
        ? `asset:${item!.assetId}`
        : item!.folderId
          ? `folder:${item!.folderId}`
          : `trash:${item!.trashId}`;
    }
    const destinationId = request.destinationFolderId ?? originalFolderId;
    if (!destinationId) throw new FileManagementError("choose_destination");
    let parent = parents.get(destinationId);
    if (!parent) {
      parent = folders.get(destinationId);
      if (
        !parent ||
        (request.expectedParentVersion &&
          parent.sourceVersion !== request.expectedParentVersion)
      )
        throw new FileManagementError("destination_changed");
      await verifyParent(parent);
      parents.set(destinationId, parent);
    }
    const destinationPath = path.posix.join(parent.relativePath, name);
    const noOp = Boolean(
      source &&
      request.type.startsWith("move") &&
      source.rootId === parent.rootId &&
      source.relativePath === destinationPath
    );
    if (
      source &&
      folder &&
      source.rootId === parent.rootId &&
      destinationPath.startsWith(`${source.relativePath}/`)
    )
      throw new FileManagementError("invalid_destination");
    const hasConflict = !noOp && (await exists(parent, name));
    let proposedName: string | null = null;
    if (hasConflict) {
      for (let suffix = 2; suffix <= 1000; suffix++) {
        const candidate = managedConflictName(name, folder, suffix);
        if (!(await exists(parent, candidate))) {
          proposedName = candidate;
          break;
        }
      }
    }
    if (!hasConflict || (choice === "keep-both" && proposedName))
      reserved.add(
        keyForPath(
          parent.rootId,
          path.posix.join(parent.relativePath, proposedName ?? name)
        )
      );
    const rootLabel = context.rootLabel(parent.rootId);
    result.push({
      key,
      index,
      name,
      destinationFolderId: parent.id,
      destinationLabel: parent.relativePath
        ? `${rootLabel}/${parent.relativePath}`
        : rootLabel,
      expectedParentVersion: parent.sourceVersion,
      hasConflict,
      proposedName,
      choice,
      noOp
    });
  }
  for (const parent of parents.values()) await verifyParent(parent);
  checkAbort();
  return { revision: getLibraryRevision(db), items: result };
}
