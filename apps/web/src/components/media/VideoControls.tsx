import { useEffect, useRef, type CSSProperties } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX
} from "lucide-react";
import { Button } from "../ui/button";
import { formatVideoTime } from "./video-playback";
import type { VideoPlayback } from "./useVideoPlayback";

interface VideoControlsProps {
  playback: VideoPlayback;
  className?: string;
  seekLabel?: string;
  onTogglePlayback?: () => void;
  onToggleMuted?: () => void;
  onExpand?: () => void;
  expandLabel?: string;
  expanded?: boolean;
  onInteractionChange?: (active: boolean) => void;
}

export function VideoControls({
  playback,
  className = "",
  seekLabel = "Seek video",
  onTogglePlayback = playback.togglePlayback,
  onToggleMuted = playback.toggleMuted,
  onExpand,
  expandLabel = "Enter fullscreen",
  expanded = false,
  onInteractionChange
}: VideoControlsProps) {
  const focusedRef = useRef(false);
  const hoveredRef = useRef(false);
  const scrubbingRef = useRef(false);
  const interactionCallbackRef = useRef(onInteractionChange);
  const { state } = playback;
  const progress = state.duration > 0 ? state.currentTime / state.duration : 0;
  const buffered = state.duration > 0 ? state.bufferedEnd / state.duration : 0;
  const style = {
    "--video-played": `${progress * 100}%`,
    "--video-buffered": `${buffered * 100}%`
  } as CSSProperties;
  const currentTime = formatVideoTime(state.currentTime);
  const duration =
    state.duration > 0 ? formatVideoTime(state.duration) : "--:--";
  const playbackLabel = state.paused ? "Play video" : "Pause video";
  const mutedLabel = state.muted ? "Unmute video" : "Mute video";

  interactionCallbackRef.current = onInteractionChange;

  useEffect(
    () => () => {
      if (focusedRef.current || hoveredRef.current || scrubbingRef.current) {
        interactionCallbackRef.current?.(false);
      }
    },
    []
  );

  const reportInteraction = () => {
    interactionCallbackRef.current?.(
      focusedRef.current || hoveredRef.current || scrubbingRef.current
    );
  };

  return (
    <span
      className={`video-controls ${className}`.trim()}
      data-paused={state.paused}
      style={style}
      role="presentation"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchCancel={(event) => event.stopPropagation()}
      onFocus={() => {
        focusedRef.current = true;
        reportInteraction();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusedRef.current = false;
          reportInteraction();
        }
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") {
          hoveredRef.current = true;
          reportInteraction();
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") {
          hoveredRef.current = false;
          reportInteraction();
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();

        if (event.target instanceof HTMLInputElement) {
          scrubbingRef.current = true;
          event.target.setPointerCapture(event.pointerId);
          reportInteraction();
        }
      }}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => {
        event.stopPropagation();
        scrubbingRef.current = false;
        reportInteraction();
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        scrubbingRef.current = false;
        reportInteraction();
      }}
      onLostPointerCapture={() => {
        scrubbingRef.current = false;
        reportInteraction();
      }}
    >
      <span
        className="video-controls__row"
        role="group"
        aria-label="Video playback controls"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="video-controls__button video-controls__button--play"
          aria-label={playbackLabel}
          title={playbackLabel}
          disabled={!state.available}
          onClick={onTogglePlayback}
        >
          {state.paused ? (
            <Play aria-hidden="true" />
          ) : (
            <Pause aria-hidden="true" />
          )}
        </Button>
        <span className="video-controls__timeline">
          <input
            aria-label={seekLabel}
            aria-valuetext={`${currentTime} of ${duration}`}
            className="video-controls__seek"
            type="range"
            min={0}
            max={state.duration || 1}
            step={0.1}
            value={state.currentTime}
            disabled={!state.seekable}
            onKeyDown={(event) => {
              if (
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.nativeEvent.isComposing
              ) {
                return;
              }

              const time = event.currentTarget.valueAsNumber;
              let target: number;

              switch (event.key) {
                case "ArrowLeft":
                case "ArrowDown":
                  target = time - 1;
                  break;
                case "ArrowRight":
                case "ArrowUp":
                  target = time + 1;
                  break;
                case "PageDown":
                  target = time - 10;
                  break;
                case "PageUp":
                  target = time + 10;
                  break;
                case "Home":
                  target = 0;
                  break;
                case "End":
                  target = state.duration;
                  break;
                case " ":
                  event.preventDefault();
                  return;
                default:
                  return;
              }

              event.preventDefault();
              playback.seek(target);
            }}
            onChange={(event) =>
              playback.seek(Number(event.currentTarget.value))
            }
          />
          <span className="video-controls__time" aria-hidden="true">
            <span>{currentTime}</span>
            <span>{duration}</span>
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="video-controls__button video-controls__button--mute"
          aria-label={mutedLabel}
          title={mutedLabel}
          disabled={!state.available}
          onClick={onToggleMuted}
        >
          {state.muted ? (
            <VolumeX aria-hidden="true" />
          ) : (
            <Volume2 aria-hidden="true" />
          )}
        </Button>
        {onExpand ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="video-controls__button video-controls__button--expand"
            aria-label={expandLabel}
            title={expandLabel}
            disabled={!state.available}
            onClick={onExpand}
          >
            {expanded ? (
              <Minimize aria-hidden="true" />
            ) : (
              <Maximize aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </span>
    </span>
  );
}
