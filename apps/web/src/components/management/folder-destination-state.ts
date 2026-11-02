import type { TreeResponse } from "../../api/client";
import { managementFolders } from "./management-model";

export type DestinationFolder = TreeResponse["folders"][number];

export function destinationFolderIndex(
  tree: TreeResponse | null,
  added: DestinationFolder[] = []
): Map<string, DestinationFolder> {
  return new Map(
    [...added, ...managementFolders(tree)].map((folder) => [folder.id, folder])
  );
}

export function destinationBreadcrumbs(
  index: Map<string, DestinationFolder>,
  id: string
): DestinationFolder[] {
  const result: DestinationFolder[] = [];
  const seen = new Set<string>();
  let current = index.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  return result;
}

export function destinationIsProhibited(
  index: Map<string, DestinationFolder>,
  id: string,
  sourceFolderId?: string
): boolean {
  return Boolean(
    sourceFolderId &&
    destinationBreadcrumbs(index, id).some(
      (folder) => folder.id === sourceFolderId
    )
  );
}

export function destinationChildren(
  index: Map<string, DestinationFolder>,
  parentId: string
): DestinationFolder[] {
  return [...index.values()]
    .filter((folder) => folder.parentId === parentId)
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
}

export function destinationUnavailableReason(
  tree: TreeResponse | null,
  folder: DestinationFolder
): string | null {
  const root = tree?.roots.find((entry) => entry.id === folder.rootId);
  if (folder.writable ?? root?.writable) {
    return folder.sourceVersion || folder.version ? null : "Scan required";
  }
  switch (root?.writeUnavailableReason) {
    case "source_unavailable":
    case "root_identity_changed":
      return "Drive unavailable";
    case "scan_required":
      return "Scan required";
    case "unknown_reserved_storage":
    case "unsafe_reserved_storage":
    case "reserved_storage_missing":
      return "File storage needs attention";
    default:
      return root?.writeUnavailableReason ? "Unavailable" : "Read-only";
  }
}
