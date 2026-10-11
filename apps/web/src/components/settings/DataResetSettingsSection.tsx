import { useState } from "react";
import { toast } from "sonner";
import {
  GitCompareArrows,
  Heart,
  RotateCcw,
  Tags,
  TrendingUp,
  TriangleAlert
} from "lucide-react";
import {
  resetLibraryData,
  type LibraryDataResetOptions,
  type LibraryDataResetResult
} from "../../api/client";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SettingsSection } from "./SettingsSection";

type ResetOptionKey = keyof LibraryDataResetOptions;

const EMPTY_SELECTION: LibraryDataResetOptions = {
  scores: false,
  favorites: false,
  tags: false,
  comparisons: false
};

const RESET_OPTIONS = [
  {
    key: "scores",
    label: "Scores",
    icon: TrendingUp,
    description:
      "Set manual scores and adjustments to zero. Comparison scores remain unless comparison history is also selected."
  },
  {
    key: "favorites",
    label: "Favorites",
    icon: Heart,
    description: "Remove every heart from the library."
  },
  {
    key: "tags",
    label: "Tags",
    icon: Tags,
    description: "Remove all tag assignments and saved tag names."
  },
  {
    key: "comparisons",
    label: "Comparison history",
    icon: GitCompareArrows,
    description:
      "Remove all pair choices and calculated comparison rankings. Manual scores remain unless Scores is also selected."
  }
] as const satisfies ReadonlyArray<{
  key: ResetOptionKey;
  label: string;
  icon: typeof TrendingUp;
  description: string;
}>;

interface DataResetSettingsSectionProps {
  onResetComplete: (
    result: LibraryDataResetResult,
    options: LibraryDataResetOptions
  ) => void;
}

export function DataResetSettingsSection({
  onResetComplete
}: DataResetSettingsSectionProps) {
  const [selection, setSelection] =
    useState<LibraryDataResetOptions>(EMPTY_SELECTION);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const selectedOptions = RESET_OPTIONS.filter(
    (option) => selection[option.key]
  );
  const hasSelection = selectedOptions.length > 0;

  function setOption(key: ResetOptionKey, checked: boolean) {
    setSelection((current) => ({ ...current, [key]: checked }));
  }

  function openConfirmation() {
    setConfirmation("");
    setIsConfirmOpen(true);
  }

  async function confirmReset() {
    if (confirmation !== "RESET" || !hasSelection) {
      return;
    }

    setIsResetting(true);
    const resetOptions = { ...selection };

    try {
      const resetResult = await resetLibraryData(resetOptions);
      setSelection(EMPTY_SELECTION);
      setConfirmation("");
      setIsConfirmOpen(false);
      onResetComplete(resetResult, resetOptions);
      toast.success("Library data reset", {
        description: resetResultSummary(resetResult),
        id: "database-reset-status"
      });
    } catch {
      toast.error("Database reset failed", {
        description: "The selected library data could not be reset.",
        id: "database-reset-status"
      });
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <SettingsSection
      icon={RotateCcw}
      title="Reset library data"
      value="Choose only the information you want to remove."
    >
      <Alert>
        <TriangleAlert />
        <AlertTitle>Your media files are safe</AlertTitle>
        <AlertDescription>
          These actions only change Aether’s database. Source files, indexed
          folders, accounts, server settings, thumbnails, posters, and previews
          are not deleted.
        </AlertDescription>
      </Alert>

      <div className="settings-reset-options">
        {RESET_OPTIONS.map((option) => {
          const Icon = option.icon;
          const inputId = `reset-${option.key}`;

          return (
            <Label
              className="settings-reset-option"
              data-checked={selection[option.key] ? "true" : "false"}
              htmlFor={inputId}
              key={option.key}
            >
              <Checkbox
                checked={selection[option.key]}
                id={inputId}
                onCheckedChange={(checked) =>
                  setOption(option.key, checked === true)
                }
              />
              <Icon aria-hidden="true" />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </Label>
          );
        })}
      </div>

      <div className="settings-reset-footer">
        <p>
          Selected:{" "}
          {hasSelection
            ? selectedOptions.map(({ label }) => label).join(", ")
            : "None"}
        </p>
        <Button
          type="button"
          variant="destructive"
          disabled={!hasSelection || isResetting}
          onClick={openConfirmation}
        >
          <RotateCcw />
          Reset selected data
        </Button>
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset selected library data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently resets{" "}
              {selectedOptions
                .map(({ label }) => label.toLowerCase())
                .join(", ")}
              . It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="settings-reset-confirmation">
            <Label htmlFor="reset-confirmation">Type RESET to continue</Label>
            <Input
              autoComplete="off"
              id="reset-confirmation"
              placeholder="RESET"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmation !== "RESET" || isResetting}
              onClick={(event) => {
                event.preventDefault();
                void confirmReset();
              }}
            >
              {isResetting ? "Resetting…" : "Reset permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

function resetResultSummary(result: LibraryDataResetResult): string {
  const changes = [
    result.scoresReset > 0 ? `${result.scoresReset} scores` : null,
    result.favoritesReset > 0 ? `${result.favoritesReset} favorites` : null,
    result.tagAssignmentsRemoved > 0
      ? `${result.tagAssignmentsRemoved} tag assignments`
      : result.tagsRemoved > 0
        ? `${result.tagsRemoved} saved tags`
        : null,
    result.comparisonPreferencesRemoved > 0
      ? `${result.comparisonPreferencesRemoved} active comparisons`
      : result.comparisonEventsRemoved > 0
        ? `${result.comparisonEventsRemoved} comparison events`
        : null
  ].filter((change): change is string => change !== null);

  return changes.length > 0
    ? `Reset ${changes.join(", ")}.`
    : "The selected categories were already empty.";
}
