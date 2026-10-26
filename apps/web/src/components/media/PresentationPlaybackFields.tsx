import { useEffect, useId, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { PresentationValues } from "../../api/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Slider } from "../ui/slider";
import {
  formatPresentationTime,
  MIN_HIGHLIGHT_DURATION_MS,
  parsePresentationTime,
  presentationRange,
  PRESENTATION_SPEEDS
} from "./presentation-model";

function TimeField({
  label,
  value,
  minimum,
  maximum,
  disabled,
  onChange,
  onValidityChange
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onValidityChange: (invalid: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState(() => formatPresentationTime(value));
  const [invalid, setInvalid] = useState(false);
  const focusedRef = useRef(false);
  const validityRef = useRef(onValidityChange);
  validityRef.current = onValidityChange;
  useEffect(() => {
    if (!focusedRef.current) {
      setText(formatPresentationTime(value));
      setInvalid(false);
      validityRef.current(false);
    }
  }, [value]);
  return (
    <div className="media-editor-field">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-label={`${label} time`}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const parsed = parsePresentationTime(next);
          const isInvalid =
            parsed === null || parsed < minimum || parsed > maximum;
          setInvalid(isInvalid);
          onValidityChange(isInvalid);
          if (!isInvalid && parsed !== null) {
            onChange(parsed);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          const parsed = parsePresentationTime(text);
          if (parsed !== null && parsed >= minimum && parsed <= maximum) {
            setText(formatPresentationTime(parsed));
          }
        }}
      />
    </div>
  );
}

interface PresentationPlaybackFieldsProps {
  draft: PresentationValues;
  durationMs: number;
  maxBounceDurationMs: number;
  disabled: boolean;
  isLoading: boolean;
  bouncePreviewDeferred: boolean;
  playheadMs: number;
  isPlaying: boolean;
  resetKey: number;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (time: number) => void;
  onRangeChange: (start: number, end: number) => void;
  onChange: (values: PresentationValues) => void;
  onInvalidChange: (field: "start" | "end", invalid: boolean) => void;
}

export function PresentationPlaybackFields({
  draft,
  durationMs,
  maxBounceDurationMs,
  disabled,
  isLoading,
  bouncePreviewDeferred,
  playheadMs,
  isPlaying,
  resetKey,
  onPlayingChange,
  onSeek,
  onRangeChange,
  onChange,
  onInvalidChange
}: PresentationPlaybackFieldsProps) {
  const speedId = useId();
  const loopId = useId();
  const [startMs, endMs] = presentationRange(draft, durationMs);
  const minimum = Math.min(durationMs, MIN_HIGHLIGHT_DURATION_MS);
  const hasTimeline = durationMs > 0;
  return (
    <div className="media-editor-fields">
      <div className="media-editor-transport">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled || !hasTimeline}
          aria-label={isPlaying ? "Pause preview" : "Play preview"}
          onClick={() => onPlayingChange(!isPlaying)}
        >
          {isPlaying ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
        </Button>
        <Slider
          min={0}
          max={durationMs || 1}
          step={1}
          value={[Math.min(playheadMs, durationMs)]}
          disabled={disabled || !hasTimeline}
          thumbLabels={["Preview position"]}
          formatValue={formatPresentationTime}
          onValueChange={([time]) => {
            if (time !== undefined) {
              onPlayingChange(false);
              onSeek(time);
            }
          }}
        />
        <output className="media-editor-time">
          {formatPresentationTime(playheadMs)}
        </output>
      </div>
      <fieldset
        className="media-editor-highlight"
        disabled={disabled || !hasTimeline}
      >
        <legend>Highlight</legend>
        <Slider
          className="media-editor-range"
          min={0}
          max={durationMs || 1}
          step={1}
          minStepsBetweenThumbs={minimum}
          value={[startMs, endMs]}
          disabled={disabled || !hasTimeline}
          thumbLabels={["Highlight start", "Highlight end"]}
          formatValue={formatPresentationTime}
          onValueChange={([start, end]) => {
            if (start !== undefined && end !== undefined)
              onRangeChange(start, end);
          }}
        />
        <div className="media-editor-columns">
          <TimeField
            key={`${resetKey}-start`}
            label="Start"
            value={startMs}
            minimum={0}
            maximum={endMs - minimum}
            disabled={disabled || !hasTimeline}
            onChange={(start) => onRangeChange(start, endMs)}
            onValidityChange={(invalid) => onInvalidChange("start", invalid)}
          />
          <TimeField
            key={`${resetKey}-end`}
            label="End"
            value={endMs}
            minimum={startMs + minimum}
            maximum={durationMs}
            disabled={disabled || !hasTimeline}
            onChange={(end) => onRangeChange(startMs, end)}
            onValidityChange={(invalid) => onInvalidChange("end", invalid)}
          />
        </div>
        <div className="media-editor-columns media-editor-markers">
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || !hasTimeline || playheadMs > endMs - minimum}
            onClick={() => onRangeChange(playheadMs, endMs)}
          >
            Start here
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={
              disabled || !hasTimeline || playheadMs < startMs + minimum
            }
            onClick={() => onRangeChange(startMs, playheadMs)}
          >
            End here
          </Button>
        </div>
      </fieldset>
      <div className="media-editor-columns">
        <div className="media-editor-field">
          <Label htmlFor={speedId}>Speed</Label>
          <Select
            value={String(draft.playbackRate)}
            disabled={disabled || !hasTimeline}
            onValueChange={(rate) =>
              onChange({
                ...draft,
                playbackRate: Number(rate)
              })
            }
          >
            <SelectTrigger id={speedId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="media-editor-select-options">
              {PRESENTATION_SPEEDS.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {rate}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="media-editor-field">
          <Label htmlFor={loopId}>Loop</Label>
          <Select
            value={draft.loopMode}
            disabled={disabled || !hasTimeline}
            onValueChange={(mode) =>
              onChange({
                ...draft,
                loopMode: mode === "bounce" ? "bounce" : "repeat"
              })
            }
          >
            <SelectTrigger id={loopId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="media-editor-select-options">
              <SelectItem value="repeat">Repeat</SelectItem>
              <SelectItem value="bounce" disabled={maxBounceDurationMs <= 0}>
                Bounce
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {draft.loopMode === "bounce" ? (
        <p className="media-editor-hint">
          {bouncePreviewDeferred
            ? "Bounce is applied after Save · muted"
            : "Forward and reverse · muted"}
        </p>
      ) : null}
      {!hasTimeline && !isLoading ? (
        <p className="media-editor-hint">
          Playback editing is unavailable for this file.
        </p>
      ) : null}
    </div>
  );
}
