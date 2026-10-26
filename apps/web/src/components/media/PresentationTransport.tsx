import { Pause, Play } from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { formatPresentationTime } from "./presentation-model";

export function PresentationTransport({
  durationMs,
  playheadMs,
  isPlaying,
  disabled,
  onPlayingChange,
  onSeek
}: {
  durationMs: number;
  playheadMs: number;
  isPlaying: boolean;
  disabled: boolean;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (time: number) => void;
}) {
  return (
    <div
      className="media-editor-transport"
      role="group"
      aria-label="Preview playback"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled || durationMs <= 0}
        aria-label={isPlaying ? "Pause preview" : "Play preview"}
        onClick={() => onPlayingChange(!isPlaying)}
      >
        {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </Button>
      <div className="media-editor-timeline">
        <div className="media-editor-times" aria-hidden="true">
          <span>{formatPresentationTime(playheadMs)}</span>
          <span>{formatPresentationTime(durationMs)}</span>
        </div>
        <Slider
          min={0}
          max={durationMs || 1}
          step={1}
          value={[Math.max(0, Math.min(playheadMs, durationMs))]}
          disabled={disabled || durationMs <= 0}
          thumbLabels={["Preview position"]}
          formatValue={formatPresentationTime}
          onValueChange={([time]) => {
            if (time !== undefined) {
              onPlayingChange(false);
              onSeek(time);
            }
          }}
        />
      </div>
    </div>
  );
}
