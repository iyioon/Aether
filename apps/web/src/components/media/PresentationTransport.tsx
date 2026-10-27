import { useId } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { formatPresentationTime } from "./presentation-model";
import {
  PRESENTATION_TIMING_KEYBOARD_HINT,
  isModifiedPresentationTimingKey,
  presentationTimingKeyTarget
} from "./presentation-timing-keyboard";

export function PresentationTransport({
  durationMs,
  playheadMs,
  isPlaying,
  disabled,
  hasAudio,
  muted,
  soundLocked,
  onToggleMuted,
  onPlayingChange,
  onSeek
}: {
  durationMs: number;
  playheadMs: number;
  isPlaying: boolean;
  disabled: boolean;
  hasAudio: boolean;
  muted: boolean;
  soundLocked: boolean;
  onToggleMuted: () => void;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (time: number) => void;
}) {
  const keyboardHintId = useId();
  return (
    <div
      className="media-editor-transport"
      role="group"
      aria-label="Preview playback"
      data-has-audio={hasAudio || undefined}
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
          aria-describedby={keyboardHintId}
          onKeyDownCapture={(event) => {
            const thumb = event.target;
            if (
              isModifiedPresentationTimingKey(event.nativeEvent) &&
              thumb instanceof HTMLElement &&
              thumb.getAttribute("role") === "slider" &&
              thumb.ownerDocument.activeElement === thumb
            )
              event.stopPropagation();
          }}
          onKeyDown={(event) => {
            const thumb = event.target;
            if (
              disabled ||
              durationMs <= 0 ||
              !(thumb instanceof HTMLElement) ||
              thumb.getAttribute("role") !== "slider" ||
              thumb.ownerDocument.activeElement !== thumb
            )
              return;
            const target = presentationTimingKeyTarget(
              event.nativeEvent,
              playheadMs,
              0,
              durationMs
            );
            if (target === null) return;
            event.preventDefault();
            event.stopPropagation();
            onPlayingChange(false);
            onSeek(target);
          }}
          onValueChange={([time]) => {
            if (time !== undefined) {
              onPlayingChange(false);
              onSeek(time);
            }
          }}
        />
        <p id={keyboardHintId} className="sr-only">
          {PRESENTATION_TIMING_KEYBOARD_HINT}
        </p>
      </div>
      {hasAudio ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled || soundLocked}
          aria-label={
            soundLocked
              ? "Bounce is silent"
              : muted
                ? "Unmute preview"
                : "Mute preview"
          }
          title={
            soundLocked
              ? "Bounce is silent"
              : muted
                ? "Unmute preview"
                : "Mute preview"
          }
          onClick={onToggleMuted}
        >
          {muted ? (
            <VolumeX aria-hidden="true" />
          ) : (
            <Volume2 aria-hidden="true" />
          )}
        </Button>
      ) : null}
    </div>
  );
}
