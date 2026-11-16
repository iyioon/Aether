import { Crop, Volume2 } from "lucide-react";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { SettingsSection } from "./SettingsSection";
import {
  isPlaybackFramingMode,
  isPlaybackHighlightsMode,
  isPlaybackSoundMode,
  type PlaybackSurface
} from "./playback-settings";
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
    <>
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
          Remember last uses your last sound choice in each view. Your browser
          may require a tap to play sound. Bounce always plays without sound.
        </p>
      </SettingsSection>
      <SettingsSection icon={Crop} title="Media display">
        <div className="settings-field-group">
          <Label htmlFor="playback-framing">Full view framing</Label>
          <Select
            value={playback.framingMode}
            onValueChange={(mode) => {
              if (isPlaybackFramingMode(mode)) playback.setFramingMode(mode);
            }}
          >
            <SelectTrigger
              className="min-h-11 w-full sm:max-w-xs"
              id="playback-framing"
              aria-describedby="playback-framing-help"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="original">Original</SelectItem>
              <SelectItem value="saved">Saved framing</SelectItem>
              <SelectItem value="remember">Remember last</SelectItem>
            </SelectContent>
          </Select>
          <p
            id="playback-framing-help"
            className="text-sm text-muted-foreground"
          >
            Original shows the complete media. Saved framing uses its crop and
            zoom. Remember last keeps your choice in View options.
          </p>
        </div>
        <div className="settings-field-group">
          <Label htmlFor="playback-highlights">Playback range</Label>
          <Select
            value={playback.highlightsMode}
            onValueChange={(mode) => {
              if (isPlaybackHighlightsMode(mode))
                playback.setHighlightsMode(mode);
            }}
          >
            <SelectTrigger
              className="min-h-11 w-full sm:max-w-xs"
              id="playback-highlights"
              aria-describedby="playback-highlights-help"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full media</SelectItem>
              <SelectItem value="highlights">Highlights only</SelectItem>
              <SelectItem value="remember">Remember last</SelectItem>
            </SelectContent>
          </Select>
          <p
            id="playback-highlights-help"
            className="text-sm text-muted-foreground"
          >
            Sets the starting range in Gallery, Feed, Compare and Full view.
            Items without a saved highlight play in full. Saved sessions and
            links keep their range.
          </p>
        </div>
      </SettingsSection>
    </>
  );
}
