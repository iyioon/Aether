import {
  readAppNavigationState,
  updateAppNavigationState,
  type AppNavigationState
} from "./app-navigation-state";
import {
  buildLibraryStateSearch,
  defaultLibraryState,
  hasExplicitLibraryStateQuery,
  isResumeLaunch,
  LIBRARY_STATE_STORAGE_KEY,
  parseLibraryStateSearch,
  parseStoredLibraryState,
  writeLibraryStateToStorage,
  type LibraryUrlState
} from "./library-state";

export type SettingsTab = "appearance" | "server" | "data";
export interface AppLocationState {
  library: LibraryUrlState;
  navigation: AppNavigationState & {
    settingsTab: SettingsTab;
    viewerAssetId: string | null;
  };
}
const STORAGE_KEY = "aether.resume.v1";

export function readInitialAppLocation(): AppLocationState {
  const stored = readStoredAppLocation();
  if (typeof window === "undefined") return stored;
  return resolveAppLocation(window.location.search, stored, isResumeLaunch());
}

export function resolveAppLocation(
  search: string,
  stored: AppLocationState,
  resume = false
): AppLocationState {
  const params = new URLSearchParams(search);
  if (resume || params.get("launch") === "resume") return stored;
  const explicitLibrary = hasExplicitLibraryStateQuery(search);
  if (
    !explicitLibrary &&
    !["page", "workspace", "tab", "asset"].some((key) => params.has(key))
  )
    return stored;
  const page = params.get("page");
  const workspace = params.get("workspace");
  const tab = params.get("tab");
  const asset = params.get("asset");
  return {
    library: explicitLibrary ? parseLibraryStateSearch(search) : stored.library,
    navigation: {
      page: page === "settings" || page === "guide" ? page : "library",
      comparisonWorkspace:
        workspace === "ranking" || workspace === "leaderboard"
          ? workspace
          : stored.navigation.comparisonWorkspace,
      settingsTab: isSettingsTab(tab) ? tab : stored.navigation.settingsTab,
      viewerAssetId:
        (!page || page === "library") && asset && asset.length <= 160
          ? asset
          : null
    }
  };
}

export function readStoredAppLocation(): AppLocationState {
  const fallback: AppLocationState = {
    library: defaultLibraryState,
    navigation: {
      ...readAppNavigationState(),
      settingsTab: "appearance",
      viewerAssetId: null
    }
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed =
      raw && raw.length <= 16384 ? (JSON.parse(raw) as unknown) : null;
    if (
      isRecord(parsed) &&
      parsed.version === 1 &&
      isRecord(parsed.navigation)
    ) {
      const library = parseStoredLibraryState(
        JSON.stringify({ version: 1, state: parsed.library })
      );
      const nav = parsed.navigation;
      if (
        library &&
        (nav.page === "library" ||
          nav.page === "settings" ||
          nav.page === "guide") &&
        (nav.comparisonWorkspace === "ranking" ||
          nav.comparisonWorkspace === "leaderboard")
      ) {
        return {
          library,
          navigation: {
            page: nav.page,
            comparisonWorkspace: nav.comparisonWorkspace,
            settingsTab: isSettingsTab(nav.settingsTab)
              ? nav.settingsTab
              : "appearance",
            viewerAssetId:
              nav.page === "library" &&
              typeof nav.viewerAssetId === "string" &&
              nav.viewerAssetId.length <= 160
                ? nav.viewerAssetId
                : null
          }
        };
      }
    }
    fallback.library =
      parseStoredLibraryState(
        window.localStorage.getItem(LIBRARY_STATE_STORAGE_KEY)
      ) ?? defaultLibraryState;
  } catch {
    // Optional browser persistence must not block opening the application.
  }
  return fallback;
}

export function saveAppLocation(state: AppLocationState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, ...state })
    );
  } catch {
    // Keep the current in-memory location usable if storage is unavailable.
  }
  writeLibraryStateToStorage(state.library);
  updateAppNavigationState(state.navigation);
}

export function writeAppLocationToUrl(
  state: AppLocationState,
  push = false
): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(buildLibraryStateSearch(state.library));
  params.set("page", state.navigation.page);
  params.set("view", state.library.view);
  if (state.library.view === "compare")
    params.set("workspace", state.navigation.comparisonWorkspace);
  if (state.navigation.page === "settings")
    params.set("tab", state.navigation.settingsTab);
  if (state.navigation.viewerAssetId)
    params.set("asset", state.navigation.viewerAssetId);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (
    url !==
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  ) {
    window.history[push ? "pushState" : "replaceState"](null, "", url);
  }
}

export function clearAppResumeState(): void {
  if (typeof window === "undefined") return;
  for (const key of [
    STORAGE_KEY,
    LIBRARY_STATE_STORAGE_KEY,
    "aether.navigation.v1"
  ]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* Storage is optional. */
    }
  }
  window.history.replaceState(null, "", window.location.pathname);
}

export function isSettingsTab(value: unknown): value is SettingsTab {
  return value === "appearance" || value === "server" || value === "data";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
