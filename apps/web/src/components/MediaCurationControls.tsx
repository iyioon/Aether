import { ArrowUp, Heart, Minus, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface MediaScoreControlProps {
  disabled?: boolean;
  mediaName: string;
  score: number | null;
  onChange: (score: number | null) => void;
}

export function MediaScoreControl({
  disabled = false,
  mediaName,
  score,
  onChange
}: MediaScoreControlProps) {
  const value = score ?? 0;

  return (
    <div className="group/score inline-flex h-7 items-center overflow-hidden rounded-md border bg-background shadow-xs outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <Button
        className="h-7 min-w-12 rounded-none px-2 font-semibold tabular-nums focus-visible:border-transparent focus-visible:ring-0"
        type="button"
        size="xs"
        variant="ghost"
        aria-label={`Increase score for ${mediaName}. Current score: ${value}`}
        disabled={disabled}
        onClick={() => onChange(value + 1)}
      >
        <ArrowUp className="score-increment-pointer" />
        <Plus className="score-increment-touch" />
        <span>{value}</span>
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={[
              "score-decrement h-7 w-7 max-w-0 min-w-0 overflow-hidden rounded-none border-l px-0 opacity-0 transition-[max-width,opacity] duration-200 focus-visible:border-transparent focus-visible:ring-0",
              value > 0
                ? "group-hover/score:max-w-7 group-hover/score:opacity-100 group-focus-within/score:max-w-7 group-focus-within/score:opacity-100"
                : "pointer-events-none border-l-transparent"
            ].join(" ")}
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`Decrease score for ${mediaName}`}
            disabled={disabled || value === 0}
            onClick={() => onChange(value === 1 ? null : value - 1)}
          >
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Decrease score</TooltipContent>
      </Tooltip>
    </div>
  );
}

interface MediaFavoriteButtonProps {
  disabled?: boolean;
  favorite: boolean;
  mediaName: string;
  onChange: (favorite: boolean) => void;
}

export function MediaFavoriteButton({
  disabled = false,
  favorite,
  mediaName,
  onChange
}: MediaFavoriteButtonProps) {
  return (
    <Button
      className="favorite-button size-7"
      type="button"
      size="icon-xs"
      variant="ghost"
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
