import Color from "color";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useCallback } from "react";
import {
  ColorPicker,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection
} from "../ui/color-picker";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { accentLabel } from "./settings-formatters";
import {
  ChoiceGroup,
  IconChoice,
  SwatchChoice
} from "./SettingsChoiceControls";
import { SettingsSection } from "./SettingsSection";
import type {
  AppearanceAccent,
  AppearanceAccentOption,
  AppearanceTheme,
  AppearanceThemeOption
} from "./useAppearanceSettings";

interface AppearanceSettingsSectionProps {
  accent: AppearanceAccent;
  accentOptions: AppearanceAccentOption[];
  customAccent: string;
  onSetAccent: (accent: AppearanceAccent) => void;
  onSetCustomAccent: (color: string) => void;
  onSetTheme: (theme: AppearanceTheme) => void;
  theme: AppearanceTheme;
  themeOptions: AppearanceThemeOption[];
}

const themeIcons = {
  light: Sun,
  dark: Moon,
  system: Monitor
} as const;

export function AppearanceSettingsSection({
  accent,
  accentOptions,
  customAccent,
  onSetAccent,
  onSetCustomAccent,
  onSetTheme,
  theme,
  themeOptions
}: AppearanceSettingsSectionProps) {
  const themeLabel =
    themeOptions.find((option) => option.value === theme)?.label ?? "Dark";
  const handleCustomAccentChange = useCallback(
    (value: Parameters<typeof Color.rgb>[0]) => {
      onSetCustomAccent(Color.rgb(value).hex());
      onSetAccent("custom");
    },
    [onSetAccent, onSetCustomAccent]
  );

  return (
    <SettingsSection
      icon={Palette}
      title="Appearance"
      value={`${themeLabel} · ${accentLabel(accent, accentOptions)}`}
    >
      <ChoiceGroup label="Mode" columns="three">
        {themeOptions.map((option) => (
          <IconChoice
            active={theme === option.value}
            icon={themeIcons[option.value]}
            key={option.value}
            label={option.label}
            onClick={() => onSetTheme(option.value)}
          />
        ))}
      </ChoiceGroup>
      <ChoiceGroup label="Accent">
        {accentOptions.map((option) => (
          <SwatchChoice
            active={accent === option.value}
            key={option.value}
            option={option}
            onClick={() => onSetAccent(option.value)}
          />
        ))}
      </ChoiceGroup>
      <div className="settings-field-group">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Custom accent
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              className="h-auto w-full justify-between px-3 py-2"
              type="button"
              variant="outline"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-6 shrink-0 rounded-full border shadow-sm"
                  style={{ backgroundColor: customAccent }}
                />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium">
                    Choose a color
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Used for primary actions and focus rings.
                  </span>
                </span>
              </span>
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {customAccent.toUpperCase()}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <ColorPicker
              value={customAccent}
              onChange={handleCustomAccentChange}
            >
              <ColorPickerSelection className="h-40 rounded-md" />
              <ColorPickerHue />
              <div className="flex items-center gap-2">
                <ColorPickerEyeDropper aria-label="Pick a color from the screen" />
                <ColorPickerOutput />
                <ColorPickerFormat />
              </div>
            </ColorPicker>
          </PopoverContent>
        </Popover>
      </div>
    </SettingsSection>
  );
}
