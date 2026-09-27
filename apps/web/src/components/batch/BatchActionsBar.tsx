import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Heart,
  ListChecks,
  Minus,
  MousePointer2,
  Plus,
  Tags,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import type { TagRecord } from "../../api/client";
import { PANEL_MOTION_DURATION_MS } from "../../lib/motion";
import { selectedMediaLabel } from "../media/media-format";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../ui/tooltip";

type TagApplyMode = "add" | "replace";

interface BatchActionsBarProps {
  isOpen: boolean;
  loadedCount: number;
  selectedCount: number;
  allSelectedFavorite: boolean;
  tagDraft: string;
  tagSuggestions: TagRecord[];
  isSaving: boolean;
  onClear: () => void;
  onClose: () => void;
  onApplyCuration: (input: { rating: number; favorite?: boolean }) => void;
  onTagDraftChange: (value: string) => void;
  onAddTag: () => void;
  onReplaceTags: () => void;
  onSelectLoaded: () => void;
  onClearTags: () => void;
}

export function BatchActionsBar({
  isOpen,
  loadedCount,
  selectedCount,
  allSelectedFavorite,
  tagDraft,
  tagSuggestions,
  isSaving,
  onClear,
  onClose,
  onApplyCuration,
  onTagDraftChange,
  onAddTag,
  onReplaceTags,
  onSelectLoaded,
  onClearTags
}: BatchActionsBarProps) {
  const [batchScoreValue, setBatchScoreValue] = useState(0);
  const [batchFavoriteValue, setBatchFavoriteValue] = useState(
    allSelectedFavorite
  );
  const [isFavoriteDirty, setIsFavoriteDirty] = useState(false);
  const [tagApplyMode, setTagApplyMode] = useState<TagApplyMode>("add");
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const lastSelectedCountRef = useRef(selectedCount);
  const hasTagDraft = tagDraft.trim().length > 0;
  const displayedSelectedCount = selectedCount || lastSelectedCountRef.current;

  useEffect(() => {
    if (selectedCount > 0) {
      lastSelectedCountRef.current = selectedCount;
    }
  }, [selectedCount]);

  useEffect(() => {
    setBatchFavoriteValue(allSelectedFavorite);
    setIsFavoriteDirty(false);
  }, [allSelectedFavorite, selectedCount]);

  useEffect(() => {
    let mountFrame = 0;
    let openFrame = 0;
    let exitTimer = 0;

    if (isOpen) {
      setIsRendered(true);
      mountFrame = window.requestAnimationFrame(() => {
        openFrame = window.requestAnimationFrame(() => setIsVisible(true));
      });
    } else {
      setIsVisible(false);
      exitTimer = window.setTimeout(
        () => setIsRendered(false),
        PANEL_MOTION_DURATION_MS
      );
    }

    return () => {
      window.cancelAnimationFrame(mountFrame);
      window.cancelAnimationFrame(openFrame);
      window.clearTimeout(exitTimer);
    };
  }, [isOpen]);

  function applyTags() {
    if (!hasTagDraft || isSaving) {
      return;
    }

    if (tagApplyMode === "replace") {
      onReplaceTags();
    } else {
      onAddTag();
    }
  }

  if (!isRendered) {
    return null;
  }

  return (
    <Card
      className="batch-actions-bar gap-0 py-0"
      data-state={isVisible ? "open" : "closed"}
      aria-label="Selected media actions"
      aria-busy={isSaving}
      aria-hidden={!isVisible}
    >
      <CardHeader className="batch-actions-header">
        <div className="batch-summary">
          <Badge variant="secondary">{displayedSelectedCount}</Badge>
          <div className="batch-summary-copy">
            <strong>
              {selectedMediaLabel(displayedSelectedCount)} selected
            </strong>
            <span>
              {selectedCount > 0
                ? "Changes apply to the entire selection."
                : "Click any gallery card to select it."}
            </span>
          </div>
        </div>
        <div className="batch-selection-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              isSaving || loadedCount === 0 || selectedCount === loadedCount
            }
            onClick={onSelectLoaded}
          >
            <ListChecks />
            Select loaded
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isSaving || selectedCount === 0}
            onClick={onClear}
          >
            Clear
          </Button>
          <BatchIconAction
            icon={X}
            label="Done selecting"
            disabled={isSaving}
            onClick={onClose}
          />
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {selectedCount === 0 ? (
          <div className="batch-selection-empty">
            <div className="batch-selection-empty-icon">
              <MousePointer2 aria-hidden="true" />
            </div>
            <strong>Select media to edit</strong>
            <span>
              Click anywhere on a gallery card to add it to the selection.
            </span>
          </div>
        ) : (
          <div className="batch-editor-grid">
            <section
              className="batch-editor-section batch-curation-section"
              aria-labelledby="batch-score-title"
            >
              <div className="batch-section-heading">
                <h3 id="batch-score-title">Score and favorite</h3>
              </div>

              <div className="batch-score-editor">
                  <div className="group/score inline-flex h-8 items-center overflow-hidden rounded-md border bg-background shadow-xs outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                    <Button
                      className="h-8 min-w-12 rounded-none px-2 font-semibold tabular-nums focus-visible:border-transparent focus-visible:ring-0"
                      type="button"
                      size="xs"
                      variant="ghost"
                      aria-label={`Increase score to ${batchScoreValue + 1}`}
                      disabled={isSaving}
                      onClick={() =>
                        setBatchScoreValue((current) => current + 1)
                      }
                    >
                      <ArrowUp />
                      <span>{batchScoreValue}</span>
                    </Button>
                    <Button
                      className={[
                        "h-8 w-8 max-w-0 min-w-0 overflow-hidden rounded-none border-l px-0 opacity-0 transition-[max-width,opacity] duration-200 focus-visible:border-transparent focus-visible:ring-0",
                        batchScoreValue > 0
                          ? "group-hover/score:max-w-8 group-hover/score:opacity-100 group-focus-within/score:max-w-8 group-focus-within/score:opacity-100"
                          : "pointer-events-none border-l-transparent"
                      ].join(" ")}
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Decrease score to ${Math.max(0, batchScoreValue - 1)}`}
                      disabled={isSaving || batchScoreValue === 0}
                      onClick={() =>
                        setBatchScoreValue((current) => Math.max(0, current - 1))
                      }
                    >
                      <Minus />
                    </Button>
                  </div>
                  <Button
                    className="favorite-button"
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={
                      batchFavoriteValue
                        ? "Do not favorite selected media"
                        : "Favorite selected media"
                    }
                    aria-pressed={batchFavoriteValue}
                    disabled={isSaving}
                    onClick={() => {
                      const nextFavorite = !batchFavoriteValue;
                      setBatchFavoriteValue(nextFavorite);
                      setIsFavoriteDirty(
                        nextFavorite !== allSelectedFavorite
                      );
                    }}
                  >
                    <Heart />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSaving}
                    onClick={() =>
                      onApplyCuration({
                        rating: batchScoreValue,
                        ...(isFavoriteDirty
                          ? { favorite: batchFavoriteValue }
                          : {})
                      })
                    }
                  >
                    Apply
                  </Button>
              </div>
            </section>

            <section
              className="batch-editor-section"
              aria-labelledby="batch-tags-title"
            >
          <div className="batch-section-heading">
            <h3 id="batch-tags-title">Tags</h3>
          </div>

          <RadioGroup
            className="batch-tag-mode"
            aria-label="Tag update mode"
            value={tagApplyMode}
            onValueChange={(value) => setTagApplyMode(value as TagApplyMode)}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="batch-tag-add" value="add" />
              <Label htmlFor="batch-tag-add">Add to existing</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="batch-tag-replace" value="replace" />
              <Label htmlFor="batch-tag-replace">Replace existing</Label>
            </div>
          </RadioGroup>

          <div className="batch-tag-control">
            <form
              className="batch-tag-form"
              aria-label="Tag selected media"
              onSubmit={(event) => {
                event.preventDefault();
                applyTags();
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Tags
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  className="pl-9 text-sm font-normal"
                  aria-label="Tag name"
                  value={tagDraft}
                  maxLength={48}
                  placeholder="Enter a tag"
                  disabled={isSaving}
                  onChange={(event) => onTagDraftChange(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={isSaving || !hasTagDraft}
              >
                <Plus />
                Apply
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isSaving}
                  >
                    <Trash2 />
                    Clear tags
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all tags?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes every tag from all {displayedSelectedCount}{" "}
                      selected {selectedMediaLabel(displayedSelectedCount)}. This
                      action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={onClearTags}
                    >
                      Clear tags
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </form>
            {tagSuggestions.length ? (
              <div
                className="batch-tag-suggestions"
                aria-label="Tag suggestions"
              >
                {tagSuggestions.map((tag) => (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    key={tag.id}
                    disabled={isSaving}
                    onClick={() => onTagDraftChange(tag.displayName)}
                  >
                    {tag.displayName}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

            </section>
          </div>
        )}

      </CardContent>
    </Card>
  );
}

interface BatchIconActionProps {
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

function BatchIconAction({
  disabled,
  icon: Icon,
  label,
  onClick
}: BatchIconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
