import {
  galleryMetadataOptions,
  type GalleryMetadataField
} from "./gallery-metadata";
import { MoreHorizontal } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Label } from "../ui/label";

interface GalleryMetadataControlsProps {
  fields: ReadonlySet<GalleryMetadataField>;
  onClear: () => void;
  onReset: () => void;
  onToggle: (field: GalleryMetadataField) => void;
}

export function GalleryMetadataControls({
  fields,
  onClear,
  onReset,
  onToggle
}: GalleryMetadataControlsProps) {
  return (
    <div className="view-options-metadata">
      <div className="view-options-field-heading">
        <span id="view-options-card-info">Card info</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Card info options"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="view-options-select-menu" align="end">
            <DropdownMenuItem onSelect={onReset}>
              Restore defaults
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onClear}>Hide all</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className="view-options-choices"
        role="group"
        aria-labelledby="view-options-card-info"
      >
        {galleryMetadataOptions.map((option) => (
          <Label className="view-options-choice" key={option.value}>
            <Checkbox
              checked={fields.has(option.value)}
              onCheckedChange={() => onToggle(option.value)}
            />
            {option.label}
          </Label>
        ))}
      </div>
    </div>
  );
}
