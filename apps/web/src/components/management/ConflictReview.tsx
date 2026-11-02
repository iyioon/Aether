import { useState } from "react";
import type {
  FileOperationPreview,
  NameConflictChoice
} from "../../api/client";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { reviewCounts } from "./conflict-review-model";

export function ConflictReview({
  preview,
  action,
  busy,
  error,
  disabled = false,
  onChange,
  onRetry
}: {
  preview: FileOperationPreview;
  action: "add" | "move" | "restore";
  busy: boolean;
  error: string | null;
  disabled?: boolean;
  onChange: (
    key: string,
    choice: NameConflictChoice,
    remaining: boolean
  ) => void;
  onRetry: () => void;
}) {
  const [applyRemaining, setApplyRemaining] = useState(false);
  const counts = reviewCounts(preview);
  return (
    <section className="grid min-w-0 gap-4" aria-label="Name conflicts">
      <h3 className="text-sm font-semibold">Name conflicts</h3>
      <ul className="grid min-w-0 gap-3">
        {preview.items
          .filter((item) => item.hasConflict && !item.noOp)
          .map((item) => (
            <li
              key={item.key}
              className="grid min-w-0 gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{item.name}</p>
                <p className="break-words text-xs text-muted-foreground">
                  {item.destinationLabel}
                </p>
              </div>
              <Select
                value={item.choice}
                disabled={disabled || busy}
                onValueChange={(choice) =>
                  onChange(
                    item.key,
                    choice as NameConflictChoice,
                    applyRemaining
                  )
                }
              >
                <SelectTrigger aria-label={`Conflict choice for ${item.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Skip</SelectItem>
                  <SelectItem value="keep-both" disabled={!item.proposedName}>
                    Keep both
                  </SelectItem>
                </SelectContent>
              </Select>
              {item.proposedName ? (
                <p className="break-words text-xs text-muted-foreground">
                  Keep as {item.proposedName}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Choose another folder.
                </p>
              )}
            </li>
          ))}
      </ul>
      {preview.items.filter((item) => item.hasConflict).length > 1 ? (
        <Label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            checked={applyRemaining}
            disabled={disabled || busy}
            onCheckedChange={(checked) => setApplyRemaining(checked === true)}
          />
          Apply to remaining conflicts
        </Label>
      ) : null}
      <p className="text-sm" role="status">
        {busy
          ? "Checking names…"
          : `${counts.included} ${counts.included === 1 ? "item" : "items"} to ${action} · ${counts.skipped} skipped${counts.unchanged ? ` · ${counts.unchanged} already in this folder` : ""}`}
      </p>
      {error ? (
        <div className="grid justify-items-start gap-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onRetry}
          >
            Check again
          </Button>
        </div>
      ) : null}
    </section>
  );
}
