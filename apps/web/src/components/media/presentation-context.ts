import { createContext, useContext } from "react";

export const PresentationContext = createContext({
  highlightsOnly: false,
  isPlaybackPaused: false
});

export function usePresentationPreferences() {
  return useContext(PresentationContext);
}
