import { Check, Grid3X3 } from "lucide-react";
import {
  aspectOptions,
  sizeOptions,
  type AspectMode,
  type GridSize
} from "../library-state";
import { GalleryMetadataControls } from "../gallery/GalleryMetadataControls";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
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
      <div className="menu-section">
        <div className="menu-section-heading">
          <div className="menu-section-title">Grid size</div>
          <small>{gridSize}</small>
        </div>
        <div
          className="menu-choice-grid grid-size-choice-grid"
          role="radiogroup"
          aria-label="Grid size"
        >
          {sizeOptions.map((option) => (
            <button
              className={gridSize === option ? "menu-choice active" : "menu-choice"}
              type="button"
              key={option}
              role="radio"
              aria-checked={gridSize === option}
              onClick={() => onSetGridSize(option)}
            >
              <span>{option}</span>
              <span className="menu-check" aria-hidden="true">
                {gridSize === option ? <Check size={13} /> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="menu-section">
        <div className="menu-section-heading">
          <div className="menu-section-title">Aspect ratio</div>
          <small>{aspect}</small>
        </div>
        <div
          className="menu-choice-grid aspect-choice-grid"
          role="radiogroup"
          aria-label="Aspect ratio"
        >
          {aspectOptions.map((option) => (
            <button
              className={aspect === option ? "menu-choice active" : "menu-choice"}
              type="button"
              key={option}
              role="radio"
              aria-checked={aspect === option}
              onClick={() => onSetAspect(option)}
            >
              <span>{option}</span>
              <span className="menu-check" aria-hidden="true">
                {aspect === option ? <Check size={13} /> : null}
              </span>
            </button>
          ))}
        </div>
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
