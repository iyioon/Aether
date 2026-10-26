import {
  layoutOptionsForView,
  viewOptions,
  type AspectMode,
  type ViewMode
} from "../library-state";
import { readComparisonAspect } from "../compare/comparison-layout-state";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem
} from "../settings/useAppearanceSettings";

export const VIEW_ASPECT_STORAGE_KEY = "aether.view-aspects.v1";
export const VIEWER_FRAMING_STORAGE_KEY = "aether.viewer.use-saved-framing.v1";
export type ViewAspects = Record<ViewMode, AspectMode>;

export function readViewerUsesSavedFraming(): boolean {
  return safeLocalStorageGetItem(VIEWER_FRAMING_STORAGE_KEY) === "true";
}

export function writeViewerUsesSavedFraming(enabled: boolean): void {
  safeLocalStorageSetItem(VIEWER_FRAMING_STORAGE_KEY, String(enabled));
}

export function parseViewAspects(raw: string | null): ViewAspects {
  const defaults: ViewAspects = {
    gallery: "Square",
    feed: "Portrait",
    compare: "Original"
  };
  if (!raw || raw.length > 512) return defaults;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("aspects" in parsed)
    )
      return defaults;
    const aspects = parsed.aspects;
    if (!aspects || typeof aspects !== "object") return defaults;
    for (const view of viewOptions) {
      const value = (aspects as Record<string, unknown>)[view];
      if (layoutOptionsForView(view).some((option) => option === value))
        defaults[view] = value as AspectMode;
    }
  } catch {
    /* Layout preferences are optional. */
  }
  return defaults;
}

export function readViewAspects(): ViewAspects {
  try {
    const raw = window.localStorage.getItem(VIEW_ASPECT_STORAGE_KEY);
    if (raw) return parseViewAspects(raw);
    return { ...parseViewAspects(null), compare: readComparisonAspect() };
  } catch {
    return parseViewAspects(null);
  }
}

export function writeViewAspects(aspects: ViewAspects): void {
  try {
    window.localStorage.setItem(
      VIEW_ASPECT_STORAGE_KEY,
      JSON.stringify({ version: 1, aspects })
    );
  } catch {
    /* Layout remains usable without storage. */
  }
}
