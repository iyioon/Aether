import { Check } from "lucide-react";
import {
  galleryMetadataOptions,
  type GalleryMetadataField
} from "./gallery-metadata";

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
    <div className="menu-section metadata-field-section">
      <div className="menu-section-heading">
        <div className="menu-section-title">Card info</div>
        <small>{selectedCount ? `${selectedCount} shown` : "None"}</small>
      </div>
      <div className="metadata-field-list">
        {galleryMetadataOptions.map((option) => (
          <label
            className={
              fields.has(option.value)
                ? "metadata-field-option active"
                : "metadata-field-option"
            }
            key={option.value}
          >
            <input
              type="checkbox"
              checked={fields.has(option.value)}
              onChange={() => onToggle(option.value)}
            />
            <span className="metadata-checkbox" aria-hidden="true">
              {fields.has(option.value) ? <Check size={13} /> : null}
            </span>
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className="metadata-settings-actions">
        <button type="button" onClick={onClear}>
          None
        </button>
        <button type="button" onClick={onReset}>
          Default
        </button>
      </div>
    </div>
  );
}
