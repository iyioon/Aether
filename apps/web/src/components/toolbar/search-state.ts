import type {
  MediaTypeFilter,
  ScoreFilter,
  TagMatch,
  TagStatus,
  TreeResponse
} from "../../api/client";
import {
  MAX_TAG_FILTER_LENGTH,
  MAX_TAG_FILTERS,
  normalizeTagDraft,
  normalizeTagIdentity
} from "../library-state";

export interface LibrarySearchValues {
  folderId: string | null;
  search: string;
  tags: string[];
  tagMatch: TagMatch;
  tagStatus: TagStatus;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
}

export interface SearchFolder {
  id: string;
  label: string;
  searchText: string;
}

export const MAX_VISIBLE_SEARCH_FOLDERS = 50;

export function addPendingSearchTag(
  value: LibrarySearchValues,
  pendingTag: string
): LibrarySearchValues {
  const tag = normalizeTagDraft(pendingTag).slice(0, MAX_TAG_FILTER_LENGTH);
  const identity = normalizeTagIdentity(tag);
  if (
    !tag ||
    value.tags.length >= MAX_TAG_FILTERS ||
    value.tags.some((selected) => normalizeTagIdentity(selected) === identity)
  )
    return value;
  return {
    ...value,
    tags: [...value.tags, tag],
    tagStatus: value.tagStatus === "untagged" ? "all" : value.tagStatus
  };
}

function normalizeFolderSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function searchFolders(tree: TreeResponse | null): SearchFolder[] {
  if (!tree) return [];
  const roots = new Map(tree.roots.map((root) => [root.id, root]));
  const folders = new Map(
    tree.roots.map((root) => [
      root.folderId,
      { id: root.folderId, label: root.label }
    ])
  );
  for (const folder of tree.folders) {
    const root = roots.get(folder.rootId);
    if (!root || folders.has(folder.id)) continue;
    const label = folder.relativePath
      ? `${root.label} / ${folder.relativePath.split("/").join(" / ")}`
      : root.label;
    folders.set(folder.id, { id: folder.id, label });
  }
  return [...folders.values()]
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    )
    .map((folder) => ({
      ...folder,
      searchText: normalizeFolderSearch(folder.label)
    }));
}

export function matchingSearchFolders(
  folders: SearchFolder[],
  query: string,
  selectedFolderId?: string | null
): { options: SearchFolder[]; total: number } {
  const terms = normalizeFolderSearch(query)
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const options: SearchFolder[] = [];
  let total = 0;
  let selected: SearchFolder | undefined;
  for (const folder of folders) {
    if (folder.id === selectedFolderId) selected = folder;
    if (!terms.every((term) => folder.searchText.includes(term))) continue;
    total += 1;
    if (options.length < MAX_VISIBLE_SEARCH_FOLDERS) options.push(folder);
  }
  if (
    !terms.length &&
    selected &&
    !options.some((folder) => folder.id === selectedFolderId)
  )
    options[options.length - 1] = selected;
  return { options, total };
}
