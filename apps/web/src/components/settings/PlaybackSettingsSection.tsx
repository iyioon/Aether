import { Volume2 } from "lucide-react";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { SettingsSection } from "./SettingsSection";
import { isPlaybackSoundMode, type PlaybackSurface } from "./playback-settings";
import type { PlaybackSettings } from "./usePlaybackSettings";

const surfaces: { value: PlaybackSurface; label: string }[] = [
  { value: "fullView", label: "Full view" },
  { value: "feed", label: "Feed" }
];

export function PlaybackSettingsSection({
  playback
}: {
  playback: PlaybackSettings;
}) {
  return (
    <SettingsSection icon={Volume2} title="Default sound">
      {surfaces.map(({ value, label }) => (
        <div className="settings-field-group" key={value}>
          <Label htmlFor={`playback-sound-${value}`}>{label}</Label>
          <Select
            value={playback[value].mode}
            onValueChange={(mode) => {
              if (isPlaybackSoundMode(mode)) playback.setMode(value, mode);
            }}
          >
            <SelectTrigger
              className="min-h-11 w-full sm:max-w-xs"
              id={`playback-sound-${value}`}
              aria-describedby="playback-sound-help"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="muted">Muted</SelectItem>
              <SelectItem value="sound-on">Sound on</SelectItem>
              <SelectItem value="remember">Remember last</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ))}
      <p id="playback-sound-help" className="text-sm text-muted-foreground">
        Remember last uses your last sound choice in each view. Your browser may
        require a tap to play sound. Bounce always plays without sound.
      </p>
    </SettingsSection>
  );
}
