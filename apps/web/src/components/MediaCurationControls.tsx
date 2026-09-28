import { useEffect, useRef, useState } from "react";
import { ArrowUp, Heart, Minus, Plus } from "lucide-react";
import { usePressRepeat } from "../hooks/usePressRepeat";
import { Button } from "./ui/button";

interface MediaScoreControlProps {
  disabled?: boolean;
  mediaName: string;
  orientation?: "horizontal" | "vertical";
  score: number | null;
  size?: "sm" | "md";
  onChange: (score: number | null) => void;
}

export function MediaScoreControl({
  disabled = false,
  mediaName,
  orientation = "horizontal",
  score,
  size = "sm",
  onChange
}: MediaScoreControlProps) {
  const value = score ?? 0;
  const isVertical = orientation === "vertical";
  const isMedium = size === "md";
  const [previewValue, setPreviewValue] = useState<number | undefined>();
  const previewValueRef = useRef<number | undefined>(undefined);
  const wasDisabledRef = useRef(disabled);
  const displayedValue = previewValue ?? value;

  function changePreview(direction: -1 | 1) {
    const current = previewValueRef.current ?? value;
    const next = Math.max(0, current + direction);
    previewValueRef.current = next;
    setPreviewValue(next);
  }

  function commitPreview() {
    const next = previewValueRef.current;

    if (next === undefined) {
      return;
    }

    onChange(next === 0 ? null : next);
  }

  const increasePress = usePressRepeat({
    disabled,
    onPress: () => onChange(value + 1),
    onRepeat: () => changePreview(1),
    onRepeatEnd: commitPreview
  });
  const decreasePress = usePressRepeat({
    disabled: disabled || value === 0,
    onPress: () => onChange(value === 1 ? null : value - 1),
    onRepeat: () => changePreview(-1),
    onRepeatEnd: commitPreview
  });

  useEffect(() => {
    previewValueRef.current = undefined;
    setPreviewValue(undefined);
  }, [mediaName, score]);

  useEffect(() => {
    if (wasDisabledRef.current && !disabled) {
      previewValueRef.current = undefined;
      setPreviewValue(undefined);
    }

    wasDisabledRef.current = disabled;
  }, [disabled]);

  return (
    <div
      aria-label={`Score for ${mediaName}`}
      className={
        isVertical
          ? "feed-score-control score-control group/score inline-flex w-10 flex-col items-stretch overflow-hidden rounded-lg border outline-none"
          : `score-control group/score inline-flex ${isMedium ? "h-8" : "h-7"} items-center overflow-hidden rounded-md border outline-none`
      }
      role="group"
    >
      <Button
        className={
          isVertical
            ? "feed-score-increase h-12 w-10 touch-manipulation flex-col gap-0.5 rounded-none px-0 font-semibold tabular-nums select-none focus-visible:border-transparent focus-visible:ring-0"
            : `${isMedium ? "h-8" : "h-7"} min-w-12 touch-manipulation rounded-none px-2 font-semibold tabular-nums select-none focus-visible:border-transparent focus-visible:ring-0`
        }
        type="button"
        size="xs"
        variant="ghost"
        aria-label={`Increase score for ${mediaName}. Current score: ${displayedValue}`}
        disabled={disabled}
        title="Hold to increase faster"
        {...increasePress}
      >
        <ArrowUp className="score-increment-pointer" />
        <Plus className="score-increment-touch" />
        <span>{displayedValue}</span>
      </Button>

      <Button
        className={[
          isVertical
            ? "feed-score-decrement h-8 w-10 touch-manipulation rounded-none px-0 select-none focus-visible:border-transparent focus-visible:ring-0"
            : `score-decrement ${isMedium ? "h-8 w-8" : "h-7 w-7"} max-w-0 min-w-0 touch-manipulation overflow-hidden rounded-none px-0 opacity-0 select-none transition-[max-width,opacity] duration-[80ms] focus-visible:border-transparent focus-visible:ring-0`,
          !isVertical && value > 0
            ? isMedium
              ? "group-hover/score:max-w-8 group-hover/score:opacity-100 group-focus-within/score:max-w-8 group-focus-within/score:opacity-100"
              : "group-hover/score:max-w-7 group-hover/score:opacity-100 group-focus-within/score:max-w-7 group-focus-within/score:opacity-100"
            : "",
          displayedValue === 0 ? "pointer-events-none" : ""
        ].join(" ")}
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Decrease score for ${mediaName}`}
        disabled={disabled || value === 0}
        {...decreasePress}
      >
        <Minus />
      </Button>
    </div>
  );
}

interface MediaFavoriteButtonProps {
  disabled?: boolean;
  favorite: boolean;
  mediaName: string;
  overlay?: boolean;
  onChange: (favorite: boolean) => void;
}

export function MediaFavoriteButton({
  disabled = false,
  favorite,
  mediaName,
  overlay = false,
  onChange
}: MediaFavoriteButtonProps) {
  return (
    <Button
      className={
        overlay
          ? "favorite-button media-overlay-button feed-nav-button size-10"
          : "favorite-button size-7"
      }
      type="button"
      size={overlay ? "icon" : "icon-xs"}
      variant={overlay ? "outline" : "ghost"}
      aria-label={
        favorite
          ? `Remove ${mediaName} from favorites`
          : `Add ${mediaName} to favorites`
      }
      aria-pressed={favorite}
      disabled={disabled}
      onClick={() => onChange(!favorite)}
    >
      <Heart />
    </Button>
  );
}
