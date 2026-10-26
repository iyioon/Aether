import { SlidersHorizontal } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";

export function ViewerViewOptions({
  container,
  open,
  onOpenChange,
  useSavedFraming,
  onFramingChange,
  highlightsOnly,
  hasHighlight,
  onHighlightsOnlyChange
}: {
  container: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  useSavedFraming: boolean;
  onFramingChange: (value: boolean) => void;
  highlightsOnly: boolean;
  hasHighlight: boolean;
  onHighlightsOnlyChange: (value: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          className="media-overlay-button"
          size="icon"
          type="button"
          variant="outline"
          aria-label="Viewer view options"
          title="View options"
        >
          <SlidersHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        container={container}
        className="viewer-view-options"
        aria-label="Viewer view options"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuCheckboxItem
          checked={useSavedFraming}
          onCheckedChange={(checked) => onFramingChange(checked === true)}
          onSelect={(event) => event.preventDefault()}
        >
          Use saved framing
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasHighlight && highlightsOnly}
          disabled={!hasHighlight}
          onCheckedChange={(checked) =>
            onHighlightsOnlyChange(checked === true)
          }
          onSelect={(event) => event.preventDefault()}
        >
          Play highlights only
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
