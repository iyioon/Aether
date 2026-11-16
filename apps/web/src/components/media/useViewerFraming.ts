import { useCallback, useRef, useState } from "react";
import {
  resolvePlaybackFraming,
  type PlaybackFramingMode
} from "../settings/playback-settings";
import {
  readViewerUsesSavedFraming,
  writeViewerUsesSavedFraming
} from "../toolbar/view-layout-state";

interface ViewerFramingState {
  mode: PlaybackFramingMode;
  isOpen: boolean;
  enabled: boolean;
  remembered: boolean;
}

export function viewerFramingForSession(
  state: ViewerFramingState,
  mode: PlaybackFramingMode,
  isOpen: boolean
): ViewerFramingState {
  if (state.mode === mode && state.isOpen === isOpen) return state;
  return {
    ...state,
    mode,
    isOpen,
    enabled:
      isOpen && (!state.isOpen || state.mode !== mode)
        ? resolvePlaybackFraming(mode, state.remembered)
        : state.enabled
  };
}

export function rememberViewerFraming(
  state: ViewerFramingState,
  enabled: boolean
): ViewerFramingState {
  return state.enabled === enabled && state.remembered === enabled
    ? state
    : { ...state, enabled, remembered: enabled };
}

export function useViewerFraming({
  mode,
  isOpen
}: {
  mode: PlaybackFramingMode;
  isOpen: boolean;
}) {
  const [state, setState] = useState<ViewerFramingState>(() => {
    const remembered = readViewerUsesSavedFraming();
    return {
      mode,
      isOpen,
      remembered,
      enabled: isOpen ? resolvePlaybackFraming(mode, remembered) : remembered
    };
  });
  const current = viewerFramingForSession(state, mode, isOpen);
  if (current !== state) setState(current);
  const currentRef = useRef(current);
  currentRef.current = current;

  const setViewerUsesSavedFraming = useCallback((enabled: boolean) => {
    if (!currentRef.current.isOpen) return;
    const next = rememberViewerFraming(currentRef.current, enabled);
    if (next === currentRef.current) return;
    currentRef.current = next;
    setState(next);
    // Persist explicit choices in their originating action before suspension.
    writeViewerUsesSavedFraming(enabled);
  }, []);

  return {
    viewerUsesSavedFraming: current.enabled,
    setViewerUsesSavedFraming
  };
}
