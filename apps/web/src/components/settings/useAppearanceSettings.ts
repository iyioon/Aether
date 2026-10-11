import { useEffect, useLayoutEffect, useMemo, useState } from "react";

export type AppearanceAccent = "graphite" | "mist" | "rose" | "custom";
export type AppearanceTheme = "light" | "dark" | "system";

export interface AppearanceAccentOption {
  value: AppearanceAccent;
  label: string;
  color: string;
}

export interface AppearanceThemeOption {
  value: AppearanceTheme;
  label: string;
}

export interface AppearanceSettings {
  accent: AppearanceAccent;
  accentOptions: AppearanceAccentOption[];
  customAccent: string;
  setAccent: (accent: AppearanceAccent) => void;
  setCustomAccent: (color: string) => void;
  setTheme: (theme: AppearanceTheme) => void;
  theme: AppearanceTheme;
  themeOptions: AppearanceThemeOption[];
}

const accentPresets: AppearanceAccentOption[] = [
  { value: "graphite", label: "Graphite", color: "#18181b" },
  { value: "mist", label: "Mist", color: "#9db8d2" },
  { value: "rose", label: "Rose", color: "#d6a5ad" }
];

export const appearanceThemeOptions: AppearanceThemeOption[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" }
];

const ACCENT_STORAGE_KEY = "aether.appearance";
const CUSTOM_ACCENT_STORAGE_KEY = "aether.appearance.custom-accent";
const THEME_STORAGE_KEY = "aether.appearance.theme";
const DEFAULT_ACCENT: AppearanceAccent = "graphite";
const DEFAULT_CUSTOM_ACCENT = "#8aaee0";
const DEFAULT_THEME: AppearanceTheme = "dark";
const accentValues = new Set<AppearanceAccent>([
  ...accentPresets.map((option) => option.value),
  "custom"
]);
const themeValues = new Set(
  appearanceThemeOptions.map((option) => option.value)
);
const colorPattern = /^#[0-9a-f]{6}$/i;

export function useAppearanceSettings(): AppearanceSettings {
  const [accent, setAccent] = useState<AppearanceAccent>(readStoredAccent);
  const [customAccent, setCustomAccent] = useState(readStoredCustomAccent);
  const [theme, setTheme] = useState<AppearanceTheme>(readStoredTheme);
  const [systemIsDark, setSystemIsDark] = useState(readSystemIsDark);
  const accentOptions = useMemo(
    () => [
      ...accentPresets,
      { value: "custom" as const, label: "Custom", color: customAccent }
    ],
    [customAccent]
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemIsDark(media.matches);

    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const isDark = theme === "dark" || (theme === "system" && systemIsDark);

    root.classList.toggle("dark", isDark);
    root.dataset.theme = theme;
    root.style.colorScheme = isDark ? "dark" : "light";
    safeLocalStorageSetItem(THEME_STORAGE_KEY, theme);
  }, [systemIsDark, theme]);

  useLayoutEffect(() => {
    const root = document.documentElement;

    root.dataset.accent = accent;
    safeLocalStorageSetItem(ACCENT_STORAGE_KEY, accent);

    if (accent === "custom") {
      const rgb = hexToRgb(customAccent);
      root.style.setProperty("--aether-custom-accent", customAccent);
      root.style.setProperty("--aether-accent-rgb", rgb.join(", "));
      root.style.setProperty("--aether-accent-contrast", contrastColor(rgb));
      safeLocalStorageSetItem(CUSTOM_ACCENT_STORAGE_KEY, customAccent);
      return;
    }

    root.style.removeProperty("--aether-custom-accent");
    root.style.removeProperty("--aether-accent-rgb");
    root.style.removeProperty("--aether-accent-contrast");
  }, [accent, customAccent]);

  return {
    accent,
    accentOptions,
    customAccent,
    setAccent,
    setCustomAccent: (color) => {
      if (colorPattern.test(color)) {
        setCustomAccent(color.toLowerCase());
      }
    },
    setTheme,
    theme,
    themeOptions: appearanceThemeOptions
  };
}

export function readStoredAccent(): AppearanceAccent {
  if (typeof window === "undefined") {
    return DEFAULT_ACCENT;
  }

  const storedAccent = safeLocalStorageGetItem(ACCENT_STORAGE_KEY);

  if (storedAccent === "sage") {
    return DEFAULT_ACCENT;
  }

  return accentValues.has(storedAccent as AppearanceAccent)
    ? (storedAccent as AppearanceAccent)
    : DEFAULT_ACCENT;
}

export function readStoredCustomAccent(): string {
  if (typeof window === "undefined") {
    return DEFAULT_CUSTOM_ACCENT;
  }

  const storedColor = safeLocalStorageGetItem(CUSTOM_ACCENT_STORAGE_KEY);
  return storedColor && colorPattern.test(storedColor)
    ? storedColor.toLowerCase()
    : DEFAULT_CUSTOM_ACCENT;
}

export function readStoredTheme(): AppearanceTheme {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  const storedTheme = safeLocalStorageGetItem(THEME_STORAGE_KEY);
  return themeValues.has(storedTheme as AppearanceTheme)
    ? (storedTheme as AppearanceTheme)
    : DEFAULT_THEME;
}

export function safeLocalStorageGetItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageRemoveItem(key: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readSystemIsDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function hexToRgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ];
}

function contrastColor([red, green, blue]: [number, number, number]): string {
  const luminance =
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue);

  return luminance > 0.42 ? "#18181b" : "#ffffff";
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}
