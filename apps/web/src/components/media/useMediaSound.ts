import { useCallback, useRef, useState } from "react";
import {
  defaultPlaybackMuted,
  type SoundPreference
} from "../settings/playback-settings";

interface MediaSoundState {
  mediaKey: string;
  mode: SoundPreference["mode"];
  muted: boolean;
}

/** Keep actual playback separate from the user's remembered sound choice. */
export function useMediaSound(
  mediaKey: string,
  preference: SoundPreference,
  onRememberSound: (muted: boolean) => void
) {
  const [state, setState] = useState<MediaSoundState>(() => ({
    mediaKey,
    mode: preference.mode,
    muted: defaultPlaybackMuted(preference)
  }));
  let current = state;
  if (state.mediaKey !== mediaKey || state.mode !== preference.mode) {
    current = {
      mediaKey,
      mode: preference.mode,
      muted: defaultPlaybackMuted(preference)
    };
    // Reset before committing a new source, so it cannot inherit old audio.
    setState(current);
  }
  const currentRef = useRef(current);
  currentRef.current = current;
  const setMuted = useCallback(
    (muted: boolean, remember = false) => {
      const latest = currentRef.current;
      if (latest.mediaKey !== mediaKey || latest.mode !== preference.mode)
        return;
      const next = { ...latest, muted };
      currentRef.current = next;
      setState(next);
      if (remember) onRememberSound(muted);
    },
    [mediaKey, preference.mode, onRememberSound]
  );

  return { muted: current.muted, mutedRef: currentRef, setMuted };
}
