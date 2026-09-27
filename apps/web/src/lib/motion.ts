export const PANEL_MOTION_DURATION_MS = 180;

export function panelExitDurationMs() {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return 0;
  }

  return PANEL_MOTION_DURATION_MS;
}
