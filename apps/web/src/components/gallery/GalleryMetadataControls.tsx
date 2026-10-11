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
  const selectedCount = fields.size;

  return (
    <div className="mt-5 grid gap-3 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <Label>Card info</Label>
        <div className="flex items-center gap-1">
          <small className="text-muted-foreground">
            {selectedCount ? `${selectedCount} shown` : "None shown"}
          </small>
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
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onReset}>
                Restore defaults
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onClear}>Hide all</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {galleryMetadataOptions.map((option) => (
          <div className="flex items-center gap-2" key={option.value}>
            <Checkbox
              id={`metadata-${option.value}`}
              checked={fields.has(option.value)}
              onCheckedChange={() => onToggle(option.value)}
            />
            <Label htmlFor={`metadata-${option.value}`}>{option.label}</Label>
          </div>
        ))}
      </div>
    </div>
  );
}
