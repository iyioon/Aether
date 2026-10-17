import { Check, MousePointer2 } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  LibraryViewOptions,
  type LibraryViewOptionsProps
} from "./LibraryViewOptions";

interface LibraryControlStripProps extends LibraryViewOptionsProps {
  isSelectionMode: boolean;
  loadedAssetCount: number;
  onSetSelectionMode: (isSelectionMode: boolean) => void;
}

export function LibraryControlStrip({
  isSelectionMode,
  loadedAssetCount,
  onSetSelectionMode,
  ...options
}: LibraryControlStripProps) {
  const { view } = options;
  return (
    <section className="control-strip" aria-label="Library controls">
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
