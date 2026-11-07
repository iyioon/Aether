import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ApiError, getFolderInventory } from "../../api/client";
import type {
  AssetRecord,
  FileOperation,
  FolderInventory,
  FileOperationInput,
  FileOperationType,
  TrashRecord,
  TreeResponse
} from "../../api/client";
import { useIsMobile } from "../../hooks/use-mobile";
import { createUuid } from "../../lib/uuid";
import {
  captureFocusTarget,
  restoreFocusAfterClose
} from "../../lib/focus-restoration";
import { formatBytes } from "../media/media-format";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "../ui/sheet";
import {
  assetIsWritable,
  folderIsWritable,
  folderVersion,
  invalidName,
  managementError,
  managementFolders,
  mediaNameStem,
  operationTitle
} from "./management-model";
import { FolderDestinationPicker } from "./FolderDestinationPicker";
import { ConflictReview } from "./ConflictReview";
import { reviewedOperation, reviewCounts } from "./conflict-review-model";
import { useConflictReview } from "./useConflictReview";

export interface ManagementTarget {
  type: FileOperationType;
  assets?: AssetRecord[];
  folderId?: string;
  trash?: TrashRecord[];
}
export function FileOperationDialog({
  target,
  tree,
  selectedFolderId,
  onClose,
  onSubmit,
  onCreateFolder
}: {
  target: ManagementTarget;
  tree: TreeResponse | null;
  selectedFolderId: string | null;
  onClose: () => void;
  onSubmit: (input: FileOperationInput) => Promise<unknown>;
  onCreateFolder?: (input: FileOperationInput) => Promise<FileOperation>;
}) {
  const [returnFocusTarget] = useState(captureFocusTarget);
  const folder = managementFolders(tree).find(
    (entry) => entry.id === target.folderId
  );
  const assets = target.assets ?? [];
  const eligible = assets.filter((asset) => assetIsWritable(tree, asset));
  const ineligibleCount = assets.length - eligible.length;
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const operationAssets = eligibleOnly ? eligible : assets;
  const [name, setName] = useState(() =>
    target.type === "rename-media" && assets[0]
      ? mediaNameStem(assets[0])
      : target.type === "rename-folder"
        ? (folder?.label ?? "")
        : ""
  );
  const nameId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [nameEdited, setNameEdited] = useState(false);
  const nameError =
    nameEdited && invalidName(name)
      ? name.trim()
        ? "Enter a name without slashes, a leading dot or surrounding spaces."
        : "Enter a name."
      : null;
  const [destinationId, setDestinationId] = useState(
    target.type === "create-folder"
      ? (target.folderId ?? selectedFolderId ?? "")
      : target.type === "move-folder"
        ? (folder?.parentId ?? "")
        : target.type === "move-media" &&
            folderIsWritable(tree, selectedFolderId)
          ? selectedFolderId!
          : ""
  );
  const conflictReview = useConflictReview();
  const [reviewing, setReviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const requestRef = useRef<FileOperationInput | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [inventory, setInventory] = useState<FolderInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryReload, setInventoryReload] = useState(0);
  const needsInventory =
    target.type === "move-folder" || target.type === "rename-folder";
  const sourceVersion = folderVersion(tree, target.folderId ?? null);
  useEffect(() => {
    if (!needsInventory || !target.folderId || !sourceVersion) return;
    const controller = new AbortController();
    setInventory(null);
    setInventoryLoading(true);
    setInventoryError(null);
    void getFolderInventory(target.folderId, sourceVersion, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setInventory(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setInventoryError(
            "This folder could not be checked. Retry before continuing."
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setInventoryLoading(false);
      });
    return () => controller.abort();
  }, [needsInventory, target.folderId, sourceVersion, inventoryReload]);
  const requiresName = [
    "create-folder",
    "rename-media",
    "rename-folder"
  ].includes(target.type);
  const requiresDestination = [
    "create-folder",
    "move-media",
    "move-folder",
    "restore"
  ].includes(target.type);
  const destructive = target.type === "trash" || target.type === "purge";
  const title = operationTitle(target.type);
  const selectionCount = assets.length
    ? operationAssets.length
    : target.trash?.length || 1;
  const exceedsItemLimit = selectionCount > 100;
  const validDestination =
    !requiresDestination ||
    (target.type === "restore" && !destinationId) ||
    Boolean(
      destinationId &&
      folderIsWritable(tree, destinationId) &&
      folderVersion(tree, destinationId)
    );
  const canSubmit =
    !isSaving &&
    !pickerBusy &&
    !conflictReview.busy &&
    (!reviewing || !conflictReview.error) &&
    !exceedsItemLimit &&
    (!requiresName || !invalidName(name)) &&
    validDestination &&
    (ineligibleCount === 0 || eligibleOnly) &&
    (assets.length === 0 || eligible.length > 0) &&
    (!needsInventory ||
      (!inventoryLoading && inventory?.sourceVersion === sourceVersion));
  function close() {
    if (!pendingRef.current && !pickerBusy) onClose();
  }
  async function submit() {
    if (!canSubmit || pendingRef.current) return;
    pendingRef.current = true;
    setIsSaving(true);
    setError(null);
    const items = target.trash
      ? target.trash.map((record) => ({
          trashId: record.id,
          expectedVersion: record.sourceVersion
        }))
      : assets.length
        ? operationAssets.map((asset) => ({
            assetId: asset.id,
            expectedVersion: asset.sourceVersion!
          }))
        : target.type === "create-folder"
          ? []
          : [
              {
                folderId: target.folderId!,
                expectedVersion:
                  folderVersion(tree, target.folderId ?? null) ?? ""
              }
            ];
    let input: FileOperationInput = requestRef.current ?? {
      requestId: createUuid(),
      type: target.type,
      items,
      ...(requiresName ? { name } : {}),
      ...(needsInventory && inventory
        ? { expectedInventoryVersion: inventory.inventoryVersion }
        : {}),
      ...(requiresDestination && destinationId
        ? {
            destinationFolderId: destinationId,
            expectedParentVersion: folderVersion(tree, destinationId)
          }
        : {}),
      ...(["move-media", "move-folder", "restore"].includes(target.type)
        ? { conflict: "skip" as const }
        : {})
    };
    try {
      if (
        !requestRef.current &&
        (input.type === "move-media" ||
          input.type === "move-folder" ||
          input.type === "restore")
      ) {
        const preview = reviewing
          ? conflictReview.value
          : await conflictReview.inspect({
              type: input.type,
              items: input.items,
              destinationFolderId: input.destinationFolderId,
              expectedParentVersion: input.expectedParentVersion,
              conflict: "skip"
            });
        if (!preview) return;
        if (!reviewing && preview.items.some((item) => item.hasConflict)) {
          setReviewing(true);
          return;
        }
        input = reviewedOperation(input, preview);
        if (!input.items.length) {
          onClose();
          return;
        }
      }
      requestRef.current = input;
      await onSubmit(input);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "folder_changed"
          ? "The folder contents changed. Review the updated check before continuing."
          : managementError(caught)
      );
      const confirmedRejection =
        caught instanceof ApiError &&
        [400, 403, 404, 409, 429].includes(caught.status);
      if (confirmedRejection) {
        requestRef.current = null;
        setReviewing(false);
        conflictReview.clear();
      }
      if (caught instanceof ApiError && caught.status === 409 && needsInventory)
        setInventoryReload((value) => value + 1);
      setUnknown(!confirmedRejection);
    } finally {
      pendingRef.current = false;
      setIsSaving(false);
    }
  }
  const fields = (
    <div className="management-fields grid gap-4">
      {reviewing && conflictReview.value ? (
        <ConflictReview
          action={target.type === "restore" ? "restore" : "move"}
          preview={conflictReview.value}
          busy={conflictReview.busy}
          error={conflictReview.error}
          disabled={isSaving || unknown}
          onChange={conflictReview.choose}
          onRetry={conflictReview.retry}
        />
      ) : null}
      {!reviewing && needsInventory ? (
        <div className="grid gap-2" aria-live="polite">
          {inventoryLoading ? (
            <p className="text-sm" role="status">
              Checking folder…
            </p>
          ) : inventory ? (
            <>
              <p className="text-sm">
                {inventory.files} {inventory.files === 1 ? "file" : "files"} ·{" "}
                {inventory.folders}{" "}
                {inventory.folders === 1 ? "folder" : "folders"} ·{" "}
                {formatBytes(inventory.totalBytes)}
              </p>
              <p className="text-sm text-muted-foreground">
                Includes hidden files and sidecars.
              </p>
            </>
          ) : null}
          {inventoryError ? (
            <>
              <p className="text-sm text-destructive" role="alert">
                {inventoryError}
              </p>
              <Button
                className="justify-self-start"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setInventoryReload((value) => value + 1)}
              >
                Retry
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {requiresName ? (
        <div className="grid gap-2">
          <Label htmlFor={nameId}>Name</Label>
          <div className="flex items-center gap-2">
            <Input
              id={nameId}
              ref={nameInputRef}
              value={name}
              maxLength={200}
              disabled={isSaving || unknown}
              aria-invalid={Boolean(nameError)}
              aria-describedby={
                [
                  nameError ? `${nameId}-error` : "",
                  target.type === "rename-media" ? `${nameId}-extension` : ""
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setNameEdited(true);
              }}
              onBlur={() => setNameEdited(true)}
            />
            {target.type === "rename-media" && assets[0] ? (
              <span
                id={`${nameId}-extension`}
                className="text-sm text-muted-foreground"
              >
                .{assets[0].extension.replace(/^\./, "")}
              </span>
            ) : null}
          </div>
          {nameError ? (
            <p id={`${nameId}-error`} className="text-sm text-destructive">
              {nameError}
            </p>
          ) : null}
        </div>
      ) : null}
      {!reviewing && requiresDestination && target.type !== "create-folder" ? (
        <FolderDestinationPicker
          tree={tree}
          value={destinationId}
          onChange={setDestinationId}
          disabled={isSaving || unknown}
          sourceFolderId={
            target.type === "move-folder" ? target.folderId : undefined
          }
          allowOriginal={target.type === "restore"}
          onCreateFolder={onCreateFolder}
          onBusyChange={setPickerBusy}
        />
      ) : null}
      {!reviewing && ineligibleCount > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm">
            {ineligibleCount} {ineligibleCount === 1 ? "item is" : "items are"}{" "}
            read-only or unavailable.
          </p>
          {eligible.length ? (
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={eligibleOnly}
                disabled={isSaving || unknown}
                onCheckedChange={(checked) => setEligibleOnly(checked === true)}
              />
              Continue with {eligible.length} writable{" "}
              {eligible.length === 1 ? "item" : "items"}
            </Label>
          ) : null}
        </div>
      ) : null}
      {exceedsItemLimit ? (
        <p role="alert" className="text-sm text-destructive">
          {selectionCount} items selected. Select up to 100 items for a file
          operation.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!reviewing && conflictReview.error ? (
        <p role="alert" className="text-sm text-destructive">
          {conflictReview.error}
        </p>
      ) : null}
    </div>
  );
  if (destructive)
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <AlertDialogContent
          className="management-confirmation"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusAfterClose(returnFocusTarget);
          }}
          onEscapeKeyDown={(event) => {
            if (isSaving) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target.type === "purge"
                ? "Delete permanently?"
                : "Move to Trash?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {target.type === "purge"
                ? selectionCount === 1 && target.trash?.[0]
                  ? `Permanently delete “${target.trash[0].name}” and its Aether metadata. This cannot be undone.`
                  : `Permanently delete ${selectionCount} selected items and their Aether metadata. This cannot be undone.`
                : selectionCount === 1 && operationAssets[0]
                  ? `Move “${operationAssets[0].name}” to Trash. Restore it before the retention period ends.`
                  : `${selectionCount} selected items will leave the library. Restore them from Trash before the retention period ends.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {fields}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!canSubmit}
              onClick={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {isSaving ? "Submitting…" : unknown ? "Retry" : title}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  return (
    <ManagementDialog
      title={title}
      description={
        target.type === "create-folder"
          ? (folder?.label ?? "Selected folder")
          : assets.length === 1
            ? assets[0]!.name
            : (folder?.label ??
              (target.trash?.length === 1
                ? target.trash[0]!.name
                : `${selectionCount} ${selectionCount === 1 ? "item" : "items"}`))
      }
      isSaving={isSaving || pickerBusy}
      destinationBrowser={
        requiresDestination && target.type !== "create-folder"
      }
      onClose={close}
      onOpenAutoFocus={
        requiresName
          ? (event) => {
              event.preventDefault();
              nameInputRef.current?.focus();
              nameInputRef.current?.select();
            }
          : undefined
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {fields}
        <div className="management-footer flex justify-end gap-2">
          {reviewing && !unknown ? (
            <Button
              type="button"
              variant="outline"
              disabled={isSaving || conflictReview.busy}
              onClick={() => {
                setReviewing(false);
                conflictReview.clear();
              }}
            >
              Back
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={isSaving || pickerBusy}
            onClick={close}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {conflictReview.busy
              ? "Checking names…"
              : isSaving
                ? "Submitting…"
                : unknown
                  ? "Retry"
                  : reviewing &&
                      conflictReview.value &&
                      !reviewCounts(conflictReview.value).included
                    ? "Done"
                    : target.type === "create-folder"
                      ? "Create folder"
                      : target.type.startsWith("rename")
                        ? "Rename"
                        : target.type === "restore"
                          ? destinationId
                            ? "Restore here"
                            : "Restore"
                          : "Move here"}
          </Button>
        </div>
      </form>
    </ManagementDialog>
  );
}
export function ManagementDialog({
  title,
  description,
  isSaving = false,
  onClose,
  children,
  open = true,
  destinationBrowser = false,
  onOpenAutoFocus
}: {
  title: string;
  description?: string;
  isSaving?: boolean;
  onClose: () => void;
  children: ReactNode;
  open?: boolean;
  destinationBrowser?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const mobile = useIsMobile();
  const [returnFocusTarget] = useState(captureFocusTarget);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    restoreFocusAfterClose(returnFocusTarget);
  };
  const guard = (event: Event) => {
    if (isSaving) event.preventDefault();
  };
  if (mobile)
    return (
      <Sheet
        open={open}
        onOpenChange={(open) => {
          if (!open && !isSaving) onClose();
        }}
      >
        <SheetContent
          className={`management-dialog${destinationBrowser ? " management-destination-dialog" : ""}`}
          {...(!description ? { "aria-describedby": undefined } : {})}
          side="bottom"
          showCloseButton={!isSaving}
          onEscapeKeyDown={guard}
          onPointerDownOutside={guard}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={restoreFocus}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description ? (
              <SheetDescription className="break-words">
                {description}
              </SheetDescription>
            ) : null}
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent
        className={`management-dialog${destinationBrowser ? " management-destination-dialog" : ""}`}
        {...(!description ? { "aria-describedby": undefined } : {})}
        showCloseButton={!isSaving}
        onEscapeKeyDown={guard}
        onPointerDownOutside={guard}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription className="break-words">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
