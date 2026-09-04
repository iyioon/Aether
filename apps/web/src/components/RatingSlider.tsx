import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { X } from "lucide-react";

const MIN_RATING = 0;
const MAX_RATING = 10;

type RatingSliderDensity = "regular" | "compact" | "batch";

interface RatingSliderProps {
  value: number | null;
  label: string;
  className?: string;
  defaultValue?: number;
  density?: RatingSliderDensity;
  disabled?: boolean;
  onClear?: () => void;
  onCommit: (rating: number) => void;
}

type RatingSliderStyle = CSSProperties & {
  "--rating-progress": string;
};

const ratingKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
  " "
]);

export function RatingSlider({
  value,
  label,
  className,
  defaultValue = 0,
  density = "regular",
  disabled = false,
  onClear,
  onCommit
}: RatingSliderProps) {
  const fallbackValue = normalizeRating(defaultValue);
  const normalizedValue = value === null ? null : normalizeRating(value);
  const [draftValue, setDraftValue] = useState(
    () => normalizedValue ?? fallbackValue
  );
  const [isEditing, setIsEditing] = useState(false);
  const committedValueRef = useRef<number | null>(normalizedValue);
  const dirtyRef = useRef(false);
  const interactionRef = useRef(false);

  useEffect(() => {
    committedValueRef.current = normalizedValue;

    if (!isEditing) {
      setDraftValue(normalizedValue ?? fallbackValue);
    }
  }, [fallbackValue, isEditing, normalizedValue]);

  const displayValue =
    normalizedValue === null && !isEditing ? "Unrated" : `${draftValue}/10`;
  const progress = `${(draftValue / MAX_RATING) * 100}%`;
  const classNames = [
    "rating-slider",
    density,
    onClear ? "clearable" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  function commitDraft(allowUnratedZero = false) {
    if (disabled) {
      return;
    }

    const nextValue = normalizeRating(draftValue);
    const canCommit =
      dirtyRef.current ||
      (allowUnratedZero && committedValueRef.current === null);

    dirtyRef.current = false;
    interactionRef.current = false;
    setIsEditing(false);

    if (!canCommit || committedValueRef.current === nextValue) {
      return;
    }

    committedValueRef.current = nextValue;
    onCommit(nextValue);
  }

  function clearRating() {
    if (disabled || !onClear || normalizedValue === null) {
      return;
    }

    dirtyRef.current = false;
    interactionRef.current = false;
    committedValueRef.current = null;
    setIsEditing(false);
    setDraftValue(fallbackValue);
    onClear();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (ratingKeys.has(event.key)) {
      interactionRef.current = true;
      setIsEditing(true);
    }
  }

  function handleKeyUp(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (ratingKeys.has(event.key)) {
      commitDraft(interactionRef.current);
    }
  }

  return (
    <div
      className={classNames}
      style={{ "--rating-progress": progress } as RatingSliderStyle}
    >
      <div className="rating-slider-header">
        <span className="rating-slider-value">{displayValue}</span>
      </div>
      <div className="rating-slider-control">
        <input
          className="rating-slider-input"
          type="range"
          min={MIN_RATING}
          max={MAX_RATING}
          step={1}
          value={draftValue}
          aria-label={label}
          aria-valuetext={`${draftValue} out of ${MAX_RATING}`}
          disabled={disabled}
          onBlur={() => commitDraft(false)}
          onChange={(event) => {
            dirtyRef.current = true;
            setIsEditing(true);
            setDraftValue(normalizeRating(Number(event.currentTarget.value)));
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPointerDown={() => {
            interactionRef.current = true;
            setIsEditing(true);
          }}
          onPointerUp={() => commitDraft(interactionRef.current)}
          onTouchEnd={() => commitDraft(interactionRef.current)}
        />
      </div>
      {onClear ? (
        <button
          className="rating-slider-clear"
          type="button"
          aria-label={`Clear ${label.toLocaleLowerCase("en-US")}`}
          title="Clear rating"
          disabled={disabled || normalizedValue === null}
          onClick={clearRating}
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

function normalizeRating(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_RATING;
  }

  return Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(value)));
}
