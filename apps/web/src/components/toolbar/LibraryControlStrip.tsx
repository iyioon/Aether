import { Check, MousePointer2, RefreshCw, Plus } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  LibraryViewOptions,
  type LibraryViewOptionsProps
} from "./LibraryViewOptions";

interface LibraryControlStripProps extends LibraryViewOptionsProps {
  isSelectionMode: boolean;
  loadedAssetCount: number;
  isResultsPending: boolean;
  canUpdateResults: boolean;
  onUpdateResults: () => void;
  onAddMedia: () => void;
  onSetSelectionMode: (isSelectionMode: boolean) => void;
}

export function LibraryControlStrip({
  isSelectionMode,
  loadedAssetCount,
  isResultsPending,
  canUpdateResults,
  onUpdateResults,
  onAddMedia,
  onSetSelectionMode,
  ...options
}: LibraryControlStripProps) {
  const { view } = options;
  const controlsRef = useRef<HTMLElement | null>(null);
  const updateRef = useRef<HTMLButtonElement | null>(null);
  const requestedFocusRef = useRef(false);
  const wasPendingRef = useRef(isResultsPending);
  useLayoutEffect(() => {
    const completed = wasPendingRef.current && !isResultsPending;
    wasPendingRef.current = isResultsPending;
    if (
      completed &&
      requestedFocusRef.current &&
      (document.activeElement === updateRef.current ||
        document.activeElement === document.body)
    )
      controlsRef.current
        ?.querySelector<HTMLButtonElement>(
          ".control-menu-trigger:not(:disabled)"
        )
        ?.focus({ preventScroll: true });
    if (completed) requestedFocusRef.current = false;
  }, [isResultsPending]);
  return (
    <section
      ref={controlsRef}
      className="control-strip"
      aria-label="Library controls"
    >
      <span className="results-update-slot" data-pending={isResultsPending}>
        <Button
          ref={updateRef}
          type="button"
          size="sm"
          variant="outline"
          disabled={!canUpdateResults}
          tabIndex={isResultsPending ? 0 : -1}
          aria-hidden={!isResultsPending}
          title={
            !canUpdateResults
              ? "Finish editing or selecting before updating results"
              : undefined
          }
          onBlur={(event) => {
            if (event.relatedTarget && event.relatedTarget !== document.body)
              requestedFocusRef.current = false;
          }}
          onClick={() => {
            requestedFocusRef.current =
              document.activeElement === updateRef.current;
            onUpdateResults();
          }}
        >
          <RefreshCw />
          <span>Update results</span>
        </Button>
      </span>
      <span className="sr-only" role="status">
        {isResultsPending
          ? `${loadedAssetCount} shown. Saved changes are ready. Update results to apply sorting and filters.`
          : ""}
      </span>
      <Button
        className="control-menu-trigger"
        type="button"
        size="icon"
        variant="outline"
        aria-label="Add media"
        onClick={onAddMedia}
      >
        <Plus />
      </Button>
      <LibraryViewOptions {...options} />

      {view !== "compare" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="control-menu-trigger control-selection-trigger"
              type="button"
              size="icon"
              variant={isSelectionMode ? "secondary" : "outline"}
              aria-label={
                isSelectionMode ? "Exit selection mode" : "Select media"
              }
              aria-pressed={isSelectionMode}
              disabled={loadedAssetCount === 0}
              onClick={() => onSetSelectionMode(!isSelectionMode)}
            >
              {isSelectionMode ? <Check /> : <MousePointer2 />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isSelectionMode ? "Exit selection mode" : "Select media"}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </section>
  );
}
