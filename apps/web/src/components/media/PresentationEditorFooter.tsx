import { LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";

export function PresentationEditorFooter({
  pending = null,
  canReset = false,
  canSave = false,
  onReset,
  onSave,
  onClose
}: {
  pending?: "save" | "reload" | null;
  canReset?: boolean;
  canSave?: boolean;
  onReset?: () => void;
  onSave?: () => void;
  onClose: () => void;
}) {
  return (
    <footer className="media-editor-footer">
      <Button
        type="button"
        variant="ghost"
        disabled={pending !== null || !canReset}
        onClick={onReset}
      >
        <RotateCcw aria-hidden="true" />
        Reset
      </Button>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={pending !== null || !canSave}
          onClick={onSave}
        >
          {pending === "save" ? (
            <LoaderCircle className="media-editor-spinner" aria-hidden="true" />
          ) : null}
          {pending === "save" ? "Saving…" : "Save"}
        </Button>
      </div>
    </footer>
  );
}
