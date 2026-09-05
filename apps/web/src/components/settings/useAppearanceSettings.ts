import { useEffect, useState } from "react";

export type AppearanceAccent = "sage" | "mist" | "rose";

export interface AppearanceAccentOption {
  value: AppearanceAccent;
  label: string;
  color: string;
}

export const appearanceAccentOptions: AppearanceAccentOption[] = [
  { value: "sage", label: "Sage", color: "#93b7a5" },
  { value: "mist", label: "Mist", color: "#9db8d2" },
  { value: "rose", label: "Rose", color: "#d6a5ad" }
];

const APPEARANCE_STORAGE_KEY = "aether.appearance";
const DEFAULT_ACCENT: AppearanceAccent = "sage";
const accentValues = new Set(
  appearanceAccentOptions.map((option) => option.value)
);

export function useAppearanceSettings() {
  const [accent, setAccent] = useState<AppearanceAccent>(() =>
    readStoredAccent()
  );

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, accent);
  }, [accent]);

  return {
    accent,
    accentOptions: appearanceAccentOptions,
    setAccent
  };
}

function readStoredAccent(): AppearanceAccent {
  if (typeof window === "undefined") {
    return DEFAULT_ACCENT;
  }

  const storedAccent = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  return accentValues.has(storedAccent as AppearanceAccent)
    ? (storedAccent as AppearanceAccent)
    : DEFAULT_ACCENT;
}
