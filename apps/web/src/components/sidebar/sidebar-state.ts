import type { FolderSortMode } from "../folders/folder-tree-types";

const SIDEBAR_STATE_COOKIE_NAME = "sidebar_state";
const FOLDER_NAVIGATION_STORAGE_KEY = "aether.sidebar.folders.v1";
const MAX_STORED_FOLDER_IDS = 10_000;
const folderSortModes: readonly FolderSortMode[] = [
  "name-asc",
  "name-desc",
  "items-desc",
  "items-asc"
];

export interface PersistedFolderNavigationState {
  expandedFolderIds: string[];
  folderSortMode: FolderSortMode;
}

export function readSidebarDefaultOpen(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  return parseSidebarOpenCookie(document.cookie);
}

export function parseSidebarOpenCookie(cookieHeader: string): boolean {
  const encodedValue = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${SIDEBAR_STATE_COOKIE_NAME}=`))
    ?.slice(SIDEBAR_STATE_COOKIE_NAME.length + 1);

  if (encodedValue === undefined) {
    return true;
  }

  try {
    return decodeURIComponent(encodedValue) !== "false";
  } catch {
    return true;
  }
}

export function readFolderNavigationState(): PersistedFolderNavigationState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseFolderNavigationState(
      window.localStorage.getItem(FOLDER_NAVIGATION_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function writeFolderNavigationState(
  state: PersistedFolderNavigationState
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      FOLDER_NAVIGATION_STORAGE_KEY,
      JSON.stringify({ version: 1, ...state })
    );
  } catch {
    // Persistence is a convenience; storage restrictions should not break navigation.
  }
}

export function parseFolderNavigationState(
  serializedState: string | null
): PersistedFolderNavigationState | null {
  if (!serializedState) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(serializedState);

    if (!isRecord(parsed) || parsed.version !== 1) {
      return null;
    }

    if (
      !folderSortModes.includes(parsed.folderSortMode as FolderSortMode) ||
      !Array.isArray(parsed.expandedFolderIds)
    ) {
      return null;
    }

    const expandedFolderIds = [
      ...new Set(
        parsed.expandedFolderIds
          .filter((folderId): folderId is string => typeof folderId === "string")
          .filter(Boolean)
          .slice(0, MAX_STORED_FOLDER_IDS)
      )
    ];

    return {
      expandedFolderIds,
      folderSortMode: parsed.folderSortMode as FolderSortMode
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
