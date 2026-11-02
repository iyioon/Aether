import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FolderInput,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Trash2
} from "lucide-react";
import type { AssetRecord, TagRecord } from "../../api/client";
import { useIsMobile } from "../../hooks/use-mobile";
import {
  MediaFavoriteButton,
  MediaScoreControl
} from "../MediaCurationControls";
import {
  buildBatchCurationInput,
  parseScoreDraft,
  uniformValue,
  type BatchCurationInput
} from "./batch-curation-model";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "../ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

interface BatchActionsBarProps {
  isOpen: boolean;
  loadedCount: number;
  selectedAssets: AssetRecord[];
  tagDraft: string;
  tagSuggestions: TagRecord[];
  isSaving: boolean;
  error: string | null;
  onClear: () => void;
  onClose: () => void;
  onApplyCuration: (input: BatchCurationInput) => Promise<boolean>;
  onApplyTags: (tags: string[], mode: "add" | "replace") => Promise<boolean>;
  onTagDraftChange: (value: string) => void;
  onSelectLoaded: () => void;
  onMove?: () => void;
  onTrash?: () => void;
  onRename?: (asset: AssetRecord) => void;
}

export function BatchActionsBar(props: BatchActionsBarProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const {
    isOpen,
    selectedAssets,
    isSaving,
    loadedCount,
    onClear,
    onClose,
    onSelectLoaded,
    onMove,
    onTrash,
    onRename
  } = props;
  const selectedCount = selectedAssets.length;
  const selectionKey = selectedAssets
    .map((asset) => asset.id)
    .sort()
    .join("|");
  if (!isOpen) return null;
  return (
    <>
      <section
        className="batch-actions-bar rounded-xl border bg-card shadow-lg"
        aria-label="Selected media actions"
      >
        <div className="batch-summary">
          <Badge variant="secondary">{selectedCount}</Badge>
          <strong>{selectedCount === 1 ? "item" : "items"} selected</strong>
        </div>
        <div className="batch-selection-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSaving || selectedCount === 0 || !onMove}
            onClick={onMove}
          >
            <FolderInput />
            <span className="batch-move-label">Move to…</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSaving || selectedCount === 0}
            className="batch-edit-details"
            onClick={() => setDetailsOpen(true)}
          >
            <Pencil />
            Edit details
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSaving || selectedCount === 0 || !onTrash}
            aria-label="Move to Trash"
            onClick={onTrash}
          >
            <Trash2 />
            <span className="batch-trash-label">Trash</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Selection options"
                disabled={isSaving}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={loadedCount === 0 || selectedCount === loadedCount}
                onSelect={onSelectLoaded}
              >
                <ListChecks />
                Select loaded
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={selectedCount === 0}
                onSelect={onClear}
              >
                Clear selection
              </DropdownMenuItem>
              {selectedCount === 1 && onRename ? (
                <DropdownMenuItem onSelect={() => onRename(selectedAssets[0]!)}>
                  Rename…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isSaving}
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </section>
      {detailsOpen && selectedCount > 0 ? (
        <EditDetails
          key={selectionKey}
          {...props}
          onCancel={() => setDetailsOpen(false)}
        />
      ) : null}
    </>
  );
}

function EditDetails({
  selectedAssets,
  tagDraft,
  tagSuggestions,
  isSaving,
  error,
  onApplyCuration,
  onApplyTags,
  onTagDraftChange,
  onCancel
}: BatchActionsBarProps & { onCancel: () => void }) {
  const mobile = useIsMobile();
  const [tab, setTab] = useState("score");
  const [scoreBaseline, setScoreBaseline] = useState(() =>
    uniformValue(selectedAssets.map((asset) => asset.score))
  );
  const [favoriteBaseline, setFavoriteBaseline] = useState(() =>
    uniformValue(selectedAssets.map((asset) => asset.favorite))
  );
  const [scoreDraft, setScoreDraft] = useState(() =>
    scoreBaseline === undefined ? "" : String(scoreBaseline)
  );
  const [scoreDirty, setScoreDirty] = useState(false);
  const [favoriteDraft, setFavoriteDraft] = useState(favoriteBaseline);
  const [favoriteDirty, setFavoriteDirty] = useState(false);
  const [tagMode, setTagMode] = useState<"add" | "replace">("add");
  const [clearTags, setClearTags] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const submittedRef = useRef(false);
  const [lastSubmittedTab, setLastSubmittedTab] = useState<string | null>(null);
  const [tabErrors, setTabErrors] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (error && lastSubmittedTab)
      setTabErrors((current) => ({ ...current, [lastSubmittedTab]: error }));
  }, [error, lastSubmittedTab]);
  const score = parseScoreDraft(scoreDraft);
  const invalidScore = scoreDirty && score === undefined;
  const curation = buildBatchCurationInput({
    score: scoreDirty ? score : undefined,
    favorite: favoriteDraft ?? false,
    isFavoriteDirty: favoriteDirty
  });
  const tagsChanged = clearTags || tagDraft.trim().length > 0;
  const selectionProblem =
    selectedAssets.length > 500
      ? "Edit up to 500 items at a time. Reduce the selection before applying changes."
      : selectedAssets.some((asset) => asset.unavailable)
        ? "Some selected media is no longer available. Close this editor and update the selection."
        : null;
  const canApply =
    !isSaving &&
    !selectionProblem &&
    (tab === "score" ? !invalidScore && curation !== null : tagsChanged);

  function cancel() {
    if (isSaving || submittedRef.current) return;
    onTagDraftChange("");
    onCancel();
  }
  async function apply(confirmed = false) {
    if (!canApply || submittedRef.current) return;
    if (tab === "tags" && clearTags && !confirmed) {
      setConfirmClear(true);
      return;
    }
    submittedRef.current = true;
    setLastSubmittedTab(tab);
    try {
      if (tab === "score" && curation) {
        if (await onApplyCuration(curation)) {
          setTabErrors((current) => ({ ...current, score: null }));
          if (scoreDirty) setScoreBaseline(score);
          if (favoriteDirty) setFavoriteBaseline(favoriteDraft);
          setScoreDirty(false);
          setFavoriteDirty(false);
        }
      } else if (tab === "tags") {
        if (
          await onApplyTags(
            clearTags ? [] : [tagDraft],
            clearTags ? "replace" : tagMode
          )
        ) {
          setTabErrors((current) => ({ ...current, tags: null }));
          setClearTags(false);
          onTagDraftChange("");
        }
      }
    } finally {
      submittedRef.current = false;
    }
  }
  const content = (
    <form
      className="batch-details-form"
      onSubmit={(event) => {
        event.preventDefault();
        void apply();
      }}
    >
      <Tabs
        className="batch-details-tabs"
        value={tab}
        onValueChange={(next) => {
          if (!isSaving) setTab(next);
        }}
      >
        <TabsList aria-label="Edit details">
          <TabsTrigger value="score" disabled={isSaving}>
            Score
          </TabsTrigger>
          <TabsTrigger value="tags" disabled={isSaving}>
            Tags
          </TabsTrigger>
        </TabsList>
        <div className="batch-details-body">
          <TabsContent value="score">
            <div className="batch-editor-section">
              <Label htmlFor="batch-score">Score</Label>
              <MediaScoreControl
                mediaName="selected media"
                score={score ?? 0}
                disabled={isSaving}
                onChange={(value) => {
                  setScoreDraft(String(value));
                  setScoreDirty(true);
                }}
                editor={{
                  value: scoreDraft,
                  mixed: scoreBaseline === undefined && !scoreDirty,
                  onChange: (value) => {
                    setScoreDraft(value);
                    setScoreDirty(true);
                  }
                }}
              />
              {invalidScore ? (
                <p className="text-sm text-destructive" role="alert">
                  Enter a whole number of zero or more.
                </p>
              ) : null}
              <div className="flex items-center gap-3">
                <MediaFavoriteButton
                  mediaName="selected media"
                  favorite={favoriteDraft}
                  disabled={isSaving}
                  onChange={(value) => {
                    setFavoriteDraft(value);
                    setFavoriteDirty(
                      favoriteBaseline === undefined ||
                        value !== favoriteBaseline
                    );
                  }}
                />
                <span className="text-sm">
                  {favoriteDraft === undefined
                    ? "Mixed favorites"
                    : favoriteDraft
                      ? "Favorite"
                      : "Not favorite"}
                </span>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="tags">
            <div className="batch-editor-section">
              <RadioGroup
                className="batch-tag-mode"
                aria-label="Tag update mode"
                value={tagMode}
                disabled={isSaving}
                onValueChange={(value) =>
                  setTagMode(value as "add" | "replace")
                }
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
              <Label htmlFor="batch-tag-name">Tag name</Label>
              <Input
                id="batch-tag-name"
                value={tagDraft}
                disabled={isSaving || clearTags}
                maxLength={48}
                placeholder="Enter a tag"
                onChange={(event) => onTagDraftChange(event.target.value)}
              />
              {tagSuggestions.length && !clearTags ? (
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
              <Button
                className="justify-self-start"
                type="button"
                size="sm"
                variant="outline"
                disabled={isSaving}
                aria-pressed={clearTags}
                onClick={() => setClearTags((current) => !current)}
              >
                <Trash2 />
                {clearTags ? "Keep tags" : "Clear tags"}
              </Button>
              {clearTags ? (
                <p className="text-sm text-muted-foreground">
                  Apply removes all tags from the selection.
                </p>
              ) : null}
            </div>
          </TabsContent>
        </div>
      </Tabs>
      <div className="batch-details-footer">
        {selectionProblem ? (
          <p role="alert" className="text-sm text-destructive">
            {selectionProblem}
          </p>
        ) : null}
        {tabErrors[tab] ? (
          <p role="alert" className="text-sm text-destructive">
            {tabErrors[tab]}
          </p>
        ) : null}
        <div className="batch-details-buttons">
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canApply}>
            {isSaving ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
    </form>
  );
  return (
    <>
      <ResponsiveEditor
        mobile={mobile}
        isSaving={isSaving}
        onClose={cancel}
        count={selectedAssets.length}
      >
        {content}
      </ResponsiveEditor>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent className="management-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all tags?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every tag from {selectedAssets.length} selected{" "}
              {selectedAssets.length === 1 ? "item" : "items"}. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void apply(true)}
            >
              Clear tags
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ResponsiveEditor({
  mobile,
  isSaving,
  onClose,
  count,
  children
}: {
  mobile: boolean;
  isSaving: boolean;
  onClose: () => void;
  count: number;
  children: ReactNode;
}) {
  const guard = (event: Event) => {
    if (isSaving) event.preventDefault();
  };
  if (mobile)
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent
          className="batch-details-content"
          side="bottom"
          showCloseButton={!isSaving}
          onEscapeKeyDown={guard}
          onPointerDownOutside={guard}
        >
          <SheetHeader>
            <SheetTitle>Edit details</SheetTitle>
            <SheetDescription>
              {count} {count === 1 ? "item" : "items"} selected
            </SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="batch-details-content"
        showCloseButton={!isSaving}
        onEscapeKeyDown={guard}
        onPointerDownOutside={guard}
      >
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            {count} {count === 1 ? "item" : "items"} selected
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
