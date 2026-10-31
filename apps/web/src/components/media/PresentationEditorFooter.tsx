import { CircleAlert, LoaderCircle, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";

export function PresentationEditorFooter({
  pending = null,
  canReset = false,
  canSave = false,
  message,
  onReload,
  onReset,
  onSave,
  onClose
}: {
  pending?: "save" | "reload" | null;
  canReset?: boolean;
  canSave?: boolean;
  message?: string | null;
  onReload?: () => void;
  onReset?: () => void;
  onSave?: () => void;
  onClose: () => void;
}) {
  return (
    <footer className="media-editor-footer">
      {message ? (
        <Alert variant="destructive" className="media-editor-feedback">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>
            <p>{message}</p>
            {onReload ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending !== null}
                onClick={onReload}
              >
                Reload saved settings
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="media-editor-footer-actions">
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
              <LoaderCircle
                className="media-editor-spinner"
                aria-hidden="true"
              />
            ) : null}
            {pending === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </footer>
  );
}
