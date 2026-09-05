import { Palette } from "lucide-react";
import { accentLabel } from "./settings-formatters";
import { ChoiceGroup, SwatchChoice } from "./SettingsChoiceControls";
import { SettingsSection } from "./SettingsSection";
import type {
  AppearanceAccent,
  AppearanceAccentOption
} from "./useAppearanceSettings";

interface AppearanceSettingsSectionProps {
  accent: AppearanceAccent;
  accentOptions: AppearanceAccentOption[];
  onSetAccent: (accent: AppearanceAccent) => void;
}

export function AppearanceSettingsSection({
  accent,
  accentOptions,
  onSetAccent
}: AppearanceSettingsSectionProps) {
  return (
    <SettingsSection
      icon={Palette}
      title="Appearance"
      value={accentLabel(accent, accentOptions)}
    >
      <ChoiceGroup label="Accent" columns="three">
        {accentOptions.map((option) => (
          <SwatchChoice
            active={accent === option.value}
            key={option.value}
            option={option}
            onClick={() => onSetAccent(option.value)}
          />
        ))}
      </ChoiceGroup>
    </SettingsSection>
  );
}
