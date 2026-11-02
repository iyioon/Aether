import type {
  AssetRecord,
  FileOperation,
  TreeResponse
} from "../../api/client";

export function managementFolders(
  tree: TreeResponse | null
): TreeResponse["folders"] {
  if (!tree) return [];
  return [
    ...tree.roots.map((root) => ({
      id: root.folderId,
      rootId: root.id,
      parentId: null,
      relativePath: "",
      label: root.label,
      assetCount: root.assetCount,
      sourceVersion: root.sourceVersion,
      version: root.version,
      writable: root.writable,
      allowedActions: root.allowedActions
    })),
    ...tree.folders
  ];
}
export function folderIsWritable(
  tree: TreeResponse | null,
  folderId: string | null
): boolean {
  if (!tree || !folderId) return false;
  const folder = tree.folders.find((entry) => entry.id === folderId);
  const root = tree.roots.find(
    (entry) => entry.folderId === folderId || entry.id === folder?.rootId
  );
  return folder?.writable ?? root?.writable ?? false;
}
export function folderVersion(
  tree: TreeResponse | null,
  folderId: string | null
): string | undefined {
  const folder = tree?.folders.find((entry) => entry.id === folderId);
  const root = tree?.roots.find((entry) => entry.folderId === folderId);
  return (
    folder?.sourceVersion ??
    folder?.version ??
    root?.sourceVersion ??
    root?.version
  );
}
export function assetIsWritable(
  tree: TreeResponse | null,
  asset: AssetRecord
): boolean {
  return Boolean(
    !asset.unavailable &&
    asset.sourceVersion &&
    folderIsWritable(tree, asset.folderId)
  );
}
export function isOperationTerminal(operation: FileOperation): boolean {
  return operation.status !== "queued" && operation.status !== "running";
}
export function operationResult(
  type: FileOperation["type"],
  count: number
): string {
  const result = {
    "move-media": "moved",
    trash: "moved to Trash",
    restore: "restored",
    purge: "deleted",
    "empty-trash": "deleted"
  };
  if (type in result)
    return `${count} ${count === 1 ? "item" : "items"} ${result[type as keyof typeof result]}`;
  return {
    "add-media": "Media added",
    "create-folder": "Folder created",
    "rename-media": "Media renamed",
    "rename-folder": "Folder renamed",
    "move-media": "Media moved",
    "move-folder": "Folder moved",
    trash: "Moved to Trash",
    restore: "Media restored",
    purge: "Items deleted",
    "empty-trash": "Trash emptied"
  }[type];
}
export function operationTitle(type: FileOperation["type"]): string {
  return {
    "add-media": "Add media",
    "create-folder": "Create folder",
    "rename-media": "Rename media",
    "rename-folder": "Rename folder",
    "move-media": "Move media",
    "move-folder": "Move folder",
    trash: "Move to Trash",
    restore: "Restore media",
    purge: "Delete permanently",
    "empty-trash": "Empty Trash"
  }[type];
}
export function completedOperationItems(operation: FileOperation) {
  return operation.items.filter((item) => item.status === "completed");
}
export function mediaNameStem(asset: AssetRecord): string {
  const suffix = `.${asset.extension.replace(/^\./, "")}`;
  return asset.name.toLowerCase().endsWith(suffix.toLowerCase())
    ? asset.name.slice(0, -suffix.length)
    : asset.name;
}
export function invalidName(name: string): boolean {
  return (
    !name.trim() ||
    name !== name.trim() ||
    name.startsWith(".") ||
    /[\\/]/.test(name) ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
    name.length > 200
  );
}
export function folderWithin(
  tree: TreeResponse | null,
  folderId: string | null,
  ancestorId: string | null
): boolean {
  if (!tree || !folderId || !ancestorId) return false;
  let current: string | null = folderId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current =
      tree.folders.find((folder) => folder.id === current)?.parentId ?? null;
  }
  return false;
}
export function managementError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const messages: Record<string, string> = {
    source_changed:
      "This item changed. Update the library before trying again.",
    stale_source: "This item changed. Update the library before trying again.",
    folder_changed:
      "The folder contents changed. Check the folder again before continuing.",
    source_not_found:
      "This item is no longer available. Update the library before trying again.",
    choose_destination: "Choose a writable destination folder.",
    invalid_destination: "Choose another destination folder.",
    protected_root: "Assigned media roots cannot be renamed or moved.",
    snapshot_changed:
      "Trash changed. Review the current items before trying again.",
    operation_queue_full:
      "Activity is full. Wait for an operation to finish and try again.",
    server_closing: "The server is stopping. Try again after it restarts.",
    unsupported_filesystem:
      "File changes are unavailable on this server or drive.",
    unsafe_entry:
      "This item contains an unsupported link, file type or permission setting.",
    operation_limit:
      "This item exceeds the file-operation limits. Ask the server operator to review it.",
    root_identity_changed:
      "The media drive changed or is unavailable. Ask the server operator to check it.",
    reserved_storage_missing:
      "Required file storage is unavailable. Ask the server operator to check the media drive.",
    unknown_reserved_storage:
      "Existing file storage could not be verified. Ask the server operator to review it.",
    unsafe_reserved_storage:
      "File storage could not be verified. Ask the server operator to review it.",
    needs_review:
      "The files could not be verified. Ask the server operator to review this operation.",
    media_lost:
      "The server operator acknowledged this media as permanently lost.",
    unsupported_media: "This file format cannot be added.",
    filesystem_error:
      "The drive could not complete this operation. Check its connection and free space.",
    destination_exists:
      "An item with that name already exists. Choose another name.",
    name_conflict:
      "An item with that name already exists. Choose another name.",
    read_only: "File changes are disabled for this folder.",
    destination_changed:
      "The destination changed. Choose it again after refreshing the library.",
    insufficient_space:
      "There is not enough free space. Free space on the server and try again.",
    recovery_required:
      "An earlier operation needs attention. Open Activity before changing more files.",
    root_read_only: "File changes are disabled for this folder.",
    operation_conflict:
      "Another operation is using this item. Wait for it to finish.",
    invalid_name: "Choose a name without slashes or a leading dot.",
    disk_space_low:
      "There is not enough free space. Free space on the server and try again."
  };
  return (
    messages[code] ??
    (code
      ? "The operation could not finish. Review this item before trying again."
      : "The request could not be confirmed. Retry checks the same operation before starting any work.")
  );
}
