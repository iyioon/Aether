import {
  layoutOptionsForView,
  sizeOptions,
  type LayoutMode,
  type ViewMode,
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
  view: ViewMode;
  aspect: LayoutMode;
  galleryMetadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  onClearGalleryMetadataFields: () => void;
  onResetGalleryMetadataFields: () => void;
  onSetAspect: (aspect: LayoutMode) => void;
  onSetGridSize: (gridSize: GridSize) => void;
  onToggleGalleryMetadataField: (field: GalleryMetadataField) => void;
}

export function LayoutControls({
  aspect,
  view,
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
      <div
        className={
          view === "feed"
            ? "view-options-selects view-options-selects--feed"
            : "view-options-selects"
        }
      >
        {view === "gallery" ? (
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
        ) : null}
        <div>
          <Label htmlFor="view-options-aspect">Media layout</Label>
          <Select
            value={aspect}
            onValueChange={(value) => onSetAspect(value as LayoutMode)}
          >
            <SelectTrigger id="view-options-aspect">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="view-options-select-menu">
              {layoutOptionsForView(view).map((option) => (
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
