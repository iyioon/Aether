import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem
} from "./useAppearanceSettings";

export type PlaybackSurface = "fullView" | "feed";
export type PlaybackSoundMode = "muted" | "sound-on" | "remember";

export interface SoundPreference {
  mode: PlaybackSoundMode;
  lastMuted: boolean;
}

export interface PlaybackPreferences {
  fullView: SoundPreference;
  feed: SoundPreference;
}

export const PLAYBACK_SETTINGS_STORAGE_KEY = "aether.playback.v1";
const MAX_STORED_LENGTH = 512;

export function defaultPlaybackPreferences(): PlaybackPreferences {
  return {
    fullView: { mode: "muted", lastMuted: true },
    feed: { mode: "muted", lastMuted: true }
  };
}

export function defaultPlaybackMuted(preference: SoundPreference): boolean {
  return preference.mode === "remember"
    ? preference.lastMuted
    : preference.mode === "muted";
}

export function isPlaybackSoundMode(
  value: unknown
): value is PlaybackSoundMode {
  return value === "muted" || value === "sound-on" || value === "remember";
}

export function parsePlaybackPreferences(
  raw: string | null
): PlaybackPreferences {
  const defaults = defaultPlaybackPreferences();
  if (!raw || raw.length > MAX_STORED_LENGTH) return defaults;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return defaults;

    return {
      fullView: parseSoundPreference(parsed.fullView) ?? defaults.fullView,
      feed: parseSoundPreference(parsed.feed) ?? defaults.feed
    };
  } catch {
    return defaults;
  }
}

export function readPlaybackPreferences(): PlaybackPreferences {
  return parsePlaybackPreferences(
    safeLocalStorageGetItem(PLAYBACK_SETTINGS_STORAGE_KEY)
  );
}

export function writePlaybackPreferences(
  preferences: PlaybackPreferences
): boolean {
  return safeLocalStorageSetItem(
    PLAYBACK_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      fullView: preferences.fullView,
      feed: preferences.feed
    })
  );
}

export function setPlaybackSoundMode(
  preferences: PlaybackPreferences,
  surface: PlaybackSurface,
  mode: PlaybackSoundMode
): PlaybackPreferences {
  if (preferences[surface].mode === mode) return preferences;
  return {
    ...preferences,
    [surface]: { ...preferences[surface], mode }
  };
}

export function rememberPlaybackSound(
  preferences: PlaybackPreferences,
  surface: PlaybackSurface,
  muted: boolean
): PlaybackPreferences {
  if (preferences[surface].lastMuted === muted) return preferences;
  return {
    ...preferences,
    [surface]: { ...preferences[surface], lastMuted: muted }
  };
}

function parseSoundPreference(value: unknown): SoundPreference | null {
  return isRecord(value) &&
    isPlaybackSoundMode(value.mode) &&
    typeof value.lastMuted === "boolean"
    ? { mode: value.mode, lastMuted: value.lastMuted }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
