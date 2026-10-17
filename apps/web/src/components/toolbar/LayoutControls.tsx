import {
  aspectOptions,
  sizeOptions,
  type AspectMode,
  type GridSize
} from "../library-state";
import { GalleryMetadataControls } from "../gallery/GalleryMetadataControls";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";

export interface LayoutControlsProps {
  aspect: AspectMode;
  galleryMetadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  onClearGalleryMetadataFields: () => void;
  onResetGalleryMetadataFields: () => void;
  onSetAspect: (aspect: AspectMode) => void;
  onSetGridSize: (gridSize: GridSize) => void;
  onToggleGalleryMetadataField: (field: GalleryMetadataField) => void;
}

export function LayoutControls({
  aspect,
  galleryMetadataFields,
  gridSize,
  onClearGalleryMetadataFields,
  onResetGalleryMetadataFields,
  onSetAspect,
  onSetGridSize,
  onToggleGalleryMetadataField
}: LayoutControlsProps) {
  return (
    <div className="view-options-fields">
      <div className="view-options-selects">
        <div>
          <Label htmlFor="view-options-size">Grid size</Label>
          <Select
            value={gridSize}
            onValueChange={(value) => onSetGridSize(value as GridSize)}
          >
            <SelectTrigger id="view-options-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="view-options-select-menu">
              {sizeOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="view-options-aspect">Aspect ratio</Label>
          <Select
            value={aspect}
            onValueChange={(value) => onSetAspect(value as AspectMode)}
          >
            <SelectTrigger id="view-options-aspect">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="view-options-select-menu">
              {aspectOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <GalleryMetadataControls
        fields={galleryMetadataFields}
        onClear={onClearGalleryMetadataFields}
        onReset={onResetGalleryMetadataFields}
        onToggle={onToggleGalleryMetadataField}
      />
    </div>
  );
}
