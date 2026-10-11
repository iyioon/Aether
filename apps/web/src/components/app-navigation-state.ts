export type AppPage = "library" | "guide" | "settings";
export type ComparisonWorkspace = "leaderboard" | "ranking";

export interface AppNavigationState {
  page: AppPage;
  comparisonWorkspace: ComparisonWorkspace;
}

const APP_NAVIGATION_STORAGE_KEY = "aether.navigation.v1";

const defaultAppNavigationState: AppNavigationState = {
  page: "library",
  comparisonWorkspace: "leaderboard"
};

export function readAppNavigationState(): AppNavigationState {
  if (typeof window === "undefined") {
    return defaultAppNavigationState;
  }

  try {
    return parseAppNavigationState(
      window.localStorage.getItem(APP_NAVIGATION_STORAGE_KEY)
    );
  } catch {
    return defaultAppNavigationState;
  }
}

export function updateAppNavigationState(
  update: Partial<AppNavigationState>
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const nextState = { ...readAppNavigationState(), ...update };
    window.localStorage.setItem(
      APP_NAVIGATION_STORAGE_KEY,
      JSON.stringify({ version: 1, ...nextState })
    );
  } catch {
    // Persistence is optional and must not prevent navigation.
  }
}

export function parseAppNavigationState(
  serializedState: string | null
): AppNavigationState {
  if (!serializedState) {
    return defaultAppNavigationState;
  }

  try {
    const parsed: unknown = JSON.parse(serializedState);

    if (!isRecord(parsed) || parsed.version !== 1) {
      return defaultAppNavigationState;
    }

    return {
      page: isAppPage(parsed.page)
        ? parsed.page
        : defaultAppNavigationState.page,
      comparisonWorkspace: isComparisonWorkspace(parsed.comparisonWorkspace)
        ? parsed.comparisonWorkspace
        : defaultAppNavigationState.comparisonWorkspace
    };
  } catch {
    return defaultAppNavigationState;
  }
}

function isAppPage(value: unknown): value is AppPage {
  return value === "library" || value === "guide" || value === "settings";
}

function isComparisonWorkspace(value: unknown): value is ComparisonWorkspace {
  return value === "leaderboard" || value === "ranking";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
