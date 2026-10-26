import { useId } from "react";
import type { PresentationValues } from "../../api/client";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Slider } from "../ui/slider";
import { MAX_PRESENTATION_ZOOM } from "./presentation-model";
import type { AspectMode } from "../library-state";

interface PresentationFramingFieldsProps {
  draft: PresentationValues;
  aspect: AspectMode;
  disabled: boolean;
  onAspectChange: (aspect: AspectMode) => void;
  onChange: (values: PresentationValues) => void;
}

export function PresentationFramingFields({
  draft,
  aspect,
  disabled,
  onAspectChange,
  onChange
}: PresentationFramingFieldsProps) {
  const fitId = useId();
  const aspectId = useId();
  const zoomId = useId();
  return (
    <div className="media-editor-fields">
      <div className="media-editor-columns">
        <div className="media-editor-field">
          <Label htmlFor={aspectId}>Media layout</Label>
          <Select
            value={aspect}
            disabled={disabled}
            onValueChange={(value) => onAspectChange(value as AspectMode)}
          >
            <SelectTrigger id={aspectId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="media-editor-select-options">
              <SelectItem value="Original">Original</SelectItem>
              <SelectItem value="Square">Square</SelectItem>
              <SelectItem value="Portrait">Portrait</SelectItem>
              <SelectItem value="Landscape">Landscape</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="media-editor-field">
          <Label htmlFor={fitId}>Framing</Label>
          <Select
            value={draft.fit === "contain" ? "contain" : "cover"}
            disabled={disabled}
            onValueChange={(fit) => {
              if (fit !== "cover" && fit !== "contain") return;
              onChange({
                ...draft,
                fit,
                ...(fit === "contain"
                  ? { zoom: 1, focalX: 0.5, focalY: 0.5 }
                  : {})
              });
            }}
          >
            <SelectTrigger id={fitId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="media-editor-select-options">
              <SelectItem value="contain">Fit</SelectItem>
              <SelectItem value="cover">Fill</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="media-editor-field">
        <div className="media-editor-field-heading">
          <Label id={zoomId}>Zoom</Label>
          <output>{draft.zoom.toFixed(2)}×</output>
        </div>
        <Slider
          aria-labelledby={zoomId}
          min={1}
          max={MAX_PRESENTATION_ZOOM}
          step={0.01}
          value={[draft.zoom]}
          disabled={disabled || draft.fit === "contain"}
          thumbLabels={["Media zoom"]}
          formatValue={(value) => `${value.toFixed(2)} times`}
          onValueChange={([zoom]) => {
            if (zoom !== undefined)
              onChange({
                ...draft,
                zoom,
                fit: "cover"
              });
          }}
        />
      </div>
      <p className="media-editor-hint">
        Each layout keeps its own framing. Save applies all changes.
      </p>
      <p className="media-editor-hint">
        {draft.fit === "contain"
          ? "Fit keeps the complete frame visible."
          : "Drag to position · pinch or use the slider to zoom"}
      </p>
    </div>
  );
}
