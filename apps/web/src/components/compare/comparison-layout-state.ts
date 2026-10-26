import { aspectOptions, type AspectMode } from "../library-state";

const STORAGE_KEY = "aether.comparison-aspect.v1";

export function parseComparisonAspect(value: string | null): AspectMode {
  if (!value || value.length > 128) return "Original";
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version === 1 &&
      "aspect" in parsed &&
      aspectOptions.some((aspect) => aspect === parsed.aspect)
    ) {
      return parsed.aspect as AspectMode;
    }
  } catch {
    // An invalid optional preference falls back to the original proportions.
  }
  return "Original";
}

export function readComparisonAspect(): AspectMode {
  try {
    return parseComparisonAspect(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "Original";
  }
}

export function writeComparisonAspect(aspect: AspectMode): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, aspect })
    );
  } catch {
    /* Storage is optional. */
  }
}
