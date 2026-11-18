import { useId, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SavedHighlightValues } from "../../api/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "../ui/alert-dialog";
import { MAX_MEDIA_HIGHLIGHTS } from "./presentation-highlight-editor";

interface PresentationHighlightPickerProps {
  highlights: SavedHighlightValues[];
  selectedId: string | null;
  mainId: string | null;
  disabled: boolean;
  switchingDisabled: boolean;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onNameChange: (name: string) => void;
  onMakeMain: () => void;
  onRemove: () => void;
}

export function PresentationHighlightPicker({
  highlights,
  selectedId,
  mainId,
  disabled,
  switchingDisabled,
  canAdd,
  onSelect,
  onAdd,
  onNameChange,
  onMakeMain,
  onRemove
}: PresentationHighlightPickerProps) {
  const selectorId = useId();
  const nameId = useId();
  const selectorRef = useRef<HTMLButtonElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const selected = highlights.find((highlight) => highlight.id === selectedId);
  return (
    <div className="media-editor-highlight-picker">
      <div className="media-editor-field-heading">
        <Label htmlFor={selectorId}>Highlight</Label>
        <Button
          ref={addButtonRef}
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || switchingDisabled || !canAdd}
          onClick={onAdd}
        >
          <Plus aria-hidden="true" />
          Add highlight
        </Button>
      </div>
      <Select
        value={selected?.id ?? "full"}
        disabled={disabled || switchingDisabled || highlights.length === 0}
        onValueChange={onSelect}
      >
        <SelectTrigger ref={selectorRef} id={selectorId} aria-label="Highlight">
          <SelectValue>
            {selected
              ? selected.name.trim() || "Untitled highlight"
              : "Full media"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="media-editor-select-options">
          {highlights.length ? (
            highlights.map((highlight) => (
              <SelectItem key={highlight.id} value={highlight.id}>
                {highlight.name.trim() || "Untitled highlight"}
                {highlight.id === mainId ? " (main)" : ""}
              </SelectItem>
            ))
          ) : (
            <SelectItem value="full">Full media</SelectItem>
          )}
        </SelectContent>
      </Select>
      {selected ? (
        <>
          <div className="media-editor-field">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              aria-label="Highlight name"
              value={selected.name}
              maxLength={80}
              disabled={disabled}
              onChange={(event) => onNameChange(event.target.value)}
              onBlur={() => onNameChange(selected.name.trim())}
            />
          </div>
          <div className="media-editor-highlight-actions">
            {selected.id === mainId ? (
              <span className="media-editor-main-highlight">
                Main highlight
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || switchingDisabled}
                onClick={() => {
                  onMakeMain();
                  selectorRef.current?.focus({ preventScroll: true });
                }}
              >
                Make main
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  ref={removeButtonRef}
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove highlight"
                  disabled={disabled}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent
                onCloseAutoFocus={(event) => {
                  if (!removeButtonRef.current?.isConnected) {
                    event.preventDefault();
                    addButtonRef.current?.focus({ preventScroll: true });
                  }
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove highlight?</AlertDialogTitle>
                  <AlertDialogDescription className="min-w-0 [overflow-wrap:anywhere]">
                    Remove {selected.name.trim() || "this highlight"} from these
                    edits. This takes effect when you save. The media file stays
                    unchanged.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onRemove}>
                    Remove highlight
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      ) : null}
      {highlights.length === MAX_MEDIA_HIGHLIGHTS ? (
        <p className="media-editor-hint">Up to 20 highlights per media.</p>
      ) : null}
    </div>
  );
}
