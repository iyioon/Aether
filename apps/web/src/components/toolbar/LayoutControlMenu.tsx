import { Grid3X3 } from "lucide-react";
import {
  aspectOptions,
  sizeOptions,
  type AspectMode,
  type GridSize
} from "../library-state";
import { GalleryMetadataControls } from "../gallery/GalleryMetadataControls";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { ToolbarMenu } from "./ToolbarMenu";

interface LayoutControlMenuProps {
  aspect: AspectMode;
  galleryMetadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  isOpen: boolean;
  layoutSummary: string;
  onClearGalleryMetadataFields: () => void;
  onOpenChange: (isOpen: boolean) => void;
  onResetGalleryMetadataFields: () => void;
  onSetAspect: (aspect: AspectMode) => void;
  onSetGridSize: (gridSize: GridSize) => void;
  onToggleGalleryMetadataField: (field: GalleryMetadataField) => void;
}

export function LayoutControlMenu({
  aspect,
  galleryMetadataFields,
  gridSize,
  isOpen,
  layoutSummary,
  onClearGalleryMetadataFields,
  onOpenChange,
  onResetGalleryMetadataFields,
  onSetAspect,
  onSetGridSize,
  onToggleGalleryMetadataField
}: LayoutControlMenuProps) {
  return (
    <ToolbarMenu
      className="layout-control"
      icon={Grid3X3}
      isOpen={isOpen}
      label="Layout"
      menuId="layout"
      valueLabel={layoutSummary}
      onOpenChange={onOpenChange}
    >
      <div className="mt-4 grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <Label>Grid size</Label>
          <small className="text-muted-foreground">{gridSize}</small>
        </div>
        <RadioGroup
          className="gap-3"
          aria-label="Grid size"
          value={gridSize}
          onValueChange={(value) => onSetGridSize(value as GridSize)}
        >
          {sizeOptions.map((option) => (
            <div className="flex items-center gap-3" key={option}>
              <RadioGroupItem id={`grid-${option}`} value={option} />
              <Label htmlFor={`grid-${option}`}>{option}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      <div className="mt-5 grid gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <Label>Aspect ratio</Label>
          <small className="text-muted-foreground">{aspect}</small>
        </div>
        <RadioGroup
          className="gap-3"
          aria-label="Aspect ratio"
          value={aspect}
          onValueChange={(value) => onSetAspect(value as AspectMode)}
        >
          {aspectOptions.map((option) => (
            <div className="flex items-center gap-3" key={option}>
              <RadioGroupItem id={`aspect-${option}`} value={option} />
              <Label htmlFor={`aspect-${option}`}>{option}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      <GalleryMetadataControls
        fields={galleryMetadataFields}
        onClear={onClearGalleryMetadataFields}
        onReset={onResetGalleryMetadataFields}
        onToggle={onToggleGalleryMetadataField}
      />
    </ToolbarMenu>
  );
}
