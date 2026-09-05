import { Grid3X3 } from "lucide-react";
import {
  aspectOptions,
  sizeOptions,
  type AspectMode,
  type GridSize
} from "../library-state";
import {
  galleryMetadataOptions,
  type GalleryMetadataField
} from "../gallery/gallery-metadata";
import {
  CheckboxChoice,
  ChoiceGroup,
  TextChoice
} from "./SettingsChoiceControls";
import { SettingsSection } from "./SettingsSection";

interface LayoutSettingsSectionProps {
  aspect: AspectMode;
  galleryMetadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  onClearGalleryMetadataFields: () => void;
  onResetGalleryMetadataFields: () => void;
  onSetAspect: (aspect: AspectMode) => void;
  onSetGridSize: (gridSize: GridSize) => void;
  onToggleGalleryMetadataField: (field: GalleryMetadataField) => void;
}

export function LayoutSettingsSection({
  aspect,
  galleryMetadataFields,
  gridSize,
  onClearGalleryMetadataFields,
  onResetGalleryMetadataFields,
  onSetAspect,
  onSetGridSize,
  onToggleGalleryMetadataField
}: LayoutSettingsSectionProps) {
  return (
    <SettingsSection icon={Grid3X3} title="Layout" value={`${gridSize} · ${aspect}`}>
      <ChoiceGroup label="Grid size" columns="five">
        {sizeOptions.map((option) => (
          <TextChoice
            active={gridSize === option}
            key={option}
            label={option}
            onClick={() => onSetGridSize(option)}
          />
        ))}
      </ChoiceGroup>

      <ChoiceGroup label="Aspect ratio" columns="two">
        {aspectOptions.map((option) => (
          <TextChoice
            active={aspect === option}
            key={option}
            label={option}
            onClick={() => onSetAspect(option)}
          />
        ))}
      </ChoiceGroup>

      <div className="settings-field-group">
        <div className="settings-field-heading">
          <span>Card information</span>
          <small>{galleryMetadataFields.size} shown</small>
        </div>
        <div className="settings-toggle-grid">
          {galleryMetadataOptions.map((option) => (
            <CheckboxChoice
              active={galleryMetadataFields.has(option.value)}
              key={option.value}
              label={option.label}
              onChange={() => onToggleGalleryMetadataField(option.value)}
            />
          ))}
        </div>
        <div className="settings-inline-actions">
          <button type="button" onClick={onClearGalleryMetadataFields}>
            None
          </button>
          <button type="button" onClick={onResetGalleryMetadataFields}>
            Default
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}
