import { useCallback, useRef, useState } from "react";
import {
  readPlaybackPreferences,
  rememberPlaybackSound,
  setPlaybackSoundMode,
  writePlaybackPreferences,
  type PlaybackPreferences,
  type PlaybackSoundMode,
  type PlaybackSurface
} from "./playback-settings";

export type {
  PlaybackSoundMode,
  PlaybackSurface,
  SoundPreference
} from "./playback-settings";

export interface PlaybackSettings extends PlaybackPreferences {
  setMode: (surface: PlaybackSurface, mode: PlaybackSoundMode) => void;
  rememberSound: (surface: PlaybackSurface, muted: boolean) => void;
}

export function usePlaybackSettings(): PlaybackSettings {
  const [preferences, setPreferences] = useState(readPlaybackPreferences);
  const preferencesRef = useRef(preferences);

  const updatePreferences = useCallback((next: PlaybackPreferences) => {
    if (next === preferencesRef.current) return;
    preferencesRef.current = next;
    // Save in the originating action; mobile suspension can prevent effects.
    writePlaybackPreferences(next);
    setPreferences(next);
  }, []);

  const setMode = useCallback(
    (surface: PlaybackSurface, mode: PlaybackSoundMode) => {
      updatePreferences(
        setPlaybackSoundMode(preferencesRef.current, surface, mode)
      );
    },
    [updatePreferences]
  );

  const rememberSound = useCallback(
    (surface: PlaybackSurface, muted: boolean) => {
      updatePreferences(
        rememberPlaybackSound(preferencesRef.current, surface, muted)
      );
    },
    [updatePreferences]
  );

  return { ...preferences, setMode, rememberSound };
}
