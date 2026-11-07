import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileOperation,
  FileOperationInput,
  TreeResponse
} from "../../api/client";
import { useMediaUploads, type UploadProgress } from "./useMediaUploads";
export type { UploadProgress } from "./useMediaUploads";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ArrowLeft, Folder, Upload } from "lucide-react";
import { createUuid } from "../../lib/uuid";
import { ActivityPage } from "./ActivityPage";
import { FolderDestinationPicker } from "./FolderDestinationPicker";
import { formatBytes } from "../media/media-format";
import { uploadBatchError, uploadFileError } from "./upload-review";
import {
  folderIsWritable,
  folderVersion,
  managementFolders
} from "./management-model";
import { ConflictReview } from "./ConflictReview";
import { reviewCounts } from "./conflict-review-model";
import { useConflictReview } from "./useConflictReview";

export interface IncomingMedia {
  id: number;
  files: File[];
  error?: string;
}

export function AddMediaPage({
  tree,
  selectedFolderId,
  onClose,
  onOperation,
  open,
  onTransfers,
  onBatchStarted,
  onUploadCancelled,
  operations,
  onRefresh,
  onSubmit,
  incomingMedia,
  activityOpen,
  onAdded,
  isLoadingFolders,
  onRefreshFolders
}: {
  isLoadingFolders: boolean;
  onRefreshFolders: () => Promise<unknown>;
  activityOpen: boolean;
  onAdded: (skipped: number) => void;
  operations: FileOperation[];
  onRefresh: (signal?: AbortSignal) => Promise<void>;
  onSubmit: (input: FileOperationInput) => Promise<FileOperation>;
  incomingMedia?: IncomingMedia | null;
  open: boolean;
  onBatchStarted: (ids: string[]) => void;
  onUploadCancelled: (id: string, outcome: "cancelled" | "failed") => void;
  onTransfers: (transfers: UploadProgress[]) => void;
  tree: TreeResponse | null;
  selectedFolderId: string | null;
  onClose: () => void;
  onOperation: (operation: FileOperation, notify: boolean) => void;
}) {
  const [destination, setDestination] = useState(
    folderIsWritable(tree, selectedFolderId) ? selectedFolderId! : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Array<{ key: string; file: File }>>([]);
  const [browsingDestination, setBrowsingDestination] = useState(false);
  const [destinationDraft, setDestinationDraft] = useState(destination);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [retryingFolders, setRetryingFolders] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const destinationInitializedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageOpenRef = useRef(open);
  pageOpenRef.current = open;
  const previewGenerationRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) {
      destinationInitializedRef.current = false;
      return;
    }
    if (!tree || destinationInitializedRef.current) return;
    destinationInitializedRef.current = true;
    if ((!draft.length || !destination) && !browsingDestination)
      setDestination(
        folderIsWritable(tree, selectedFolderId) ? selectedFolderId! : ""
      );
  }, [
    open,
    tree,
    selectedFolderId,
    draft.length,
    browsingDestination,
    destination
  ]);
  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true });
    else setDraggingFiles(false);
  }, [open, browsingDestination, reviewing]);
  const incomingIdRef = useRef<number | null>(null);
  const submittedDraftRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const conflictReview = useConflictReview();
  const clearConflictReview = conflictReview.clear;
  useEffect(() => {
    previewGenerationRef.current += 1;
    if (!open) {
      clearConflictReview();
      setReviewing(false);
    }
  }, [open, clearConflictReview]);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const uploads = useMediaUploads({
    tree,
    destination,
    conflict: "skip",
    open,
    onTransfers,
    onBatchStarted,
    onUploadCancelled,
    onOperation
  });
  const { limits, refresh } = uploads;
  const retryRequestsRef = useRef(new Map<string, FileOperationInput>());
  const retryOperation = useCallback(
    (operation: FileOperation) => {
      if (!operation.retryInput) return Promise.resolve(operation);
      const input = retryRequestsRef.current.get(operation.id) ?? {
        ...operation.retryInput,
        requestId: createUuid()
      };
      retryRequestsRef.current.set(operation.id, input);
      if (retryRequestsRef.current.size > 100)
        retryRequestsRef.current.delete(
          retryRequestsRef.current.keys().next().value!
        );
      return onSubmit(input);
    },
    [onSubmit]
  );
  const choose = useCallback(
    (files: FileList | File[] | null) => {
      if (!files?.length) return;
      const picked = Array.from(files);
      if (picked.length + draft.length > (limits?.maxBatchItems ?? 100)) {
        setError(
          `Choose up to ${limits?.maxBatchItems ?? 100} files per batch.`
        );
        return;
      }
      if (picked.some((file) => file.webkitRelativePath)) {
        setError("Choose individual files. Folder uploads are not supported.");
        return;
      }
      setError(null);
      setDraggingFiles(false);
      setReviewResult(null);
      setReviewing(false);
      clearConflictReview();
      setDraft((current) => [
        ...current,
        ...picked.map((file) => ({ key: createUuid(), file }))
      ]);
    },
    [draft.length, limits?.maxBatchItems, clearConflictReview]
  );
  useEffect(() => {
    if (!incomingMedia || incomingIdRef.current === incomingMedia.id) return;
    incomingIdRef.current = incomingMedia.id;
    if (incomingMedia.error) setError(incomingMedia.error);
    else choose(incomingMedia.files);
  }, [incomingMedia, choose]);
  const draftFiles = draft.map((item) => item.file);
  const draftTotal = draftFiles.reduce((total, file) => total + file.size, 0);
  const batchError =
    draft.length && limits ? uploadBatchError(draftFiles, limits) : null;
  const invalidFiles = draftFiles.some((file) => uploadFileError(file, limits));
  function cancel() {
    previewGenerationRef.current += 1;
    clearConflictReview();
    setDraft([]);
    setError(null);
    setReviewResult(null);
    setReviewing(false);
    setDraggingFiles(false);
    onClose();
  }
  async function addFiles() {
    if (
      !pageOpenRef.current ||
      submittingRef.current ||
      conflictReview.busy ||
      (reviewing && conflictReview.error) ||
      !draft.length ||
      !limits ||
      batchError ||
      invalidFiles ||
      !folderIsWritable(tree, destination)
    )
      return;
    const signature = draft.map((item) => item.key).join("|");
    if (submittedDraftRef.current === signature) return;
    submittingRef.current = true;
    const generation = previewGenerationRef.current;
    try {
      const preview = reviewing
        ? conflictReview.value
        : await conflictReview.inspect({
            type: "add-media",
            files: draft.map(({ key, file }) => ({
              clientId: key,
              name: file.name
            })),
            destinationFolderId: destination,
            expectedParentVersion: folderVersion(tree, destination) ?? "",
            conflict: "skip"
          });
      if (
        !preview ||
        !pageOpenRef.current ||
        generation !== previewGenerationRef.current
      )
        return;
      if (!reviewing && preview.items.some((item) => item.hasConflict)) {
        setReviewing(true);
        return;
      }
      const chosen = draft.flatMap((item, index) => {
        const checked = preview.items.find((entry) => entry.index === index);
        if (
          !checked ||
          checked.noOp ||
          (checked.hasConflict && checked.choice === "skip")
        )
          return [];
        return [
          {
            ...item,
            conflict: checked.hasConflict ? checked.choice : ("skip" as const)
          }
        ];
      });
      if (chosen.length && !uploads.enqueue(chosen)) {
        setError(
          "Wait for current uploads to finish before adding this batch."
        );
        return;
      }
      const { skipped } = reviewCounts(preview);
      setReviewResult(
        skipped
          ? `${skipped} ${skipped === 1 ? "file" : "files"} skipped.`
          : null
      );
      submittedDraftRef.current = signature;
      setDraft([]);
      setReviewing(false);
      conflictReview.clear();
      setError(null);
      if (chosen.length) onAdded(skipped);
    } finally {
      submittingRef.current = false;
    }
  }
  const destinationFolder = managementFolders(tree).find(
    (folder) => folder.id === destination
  );
  const destinationRoot = tree?.roots.find(
    (root) => root.id === destinationFolder?.rootId
  );
  return (
    <>
      <section className="add-media-page" aria-label="Add media" hidden={!open}>
        <div className="add-media-shell">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className={
              browsingDestination
                ? "text-lg font-semibold outline-none"
                : "sr-only outline-none"
            }
          >
            {browsingDestination ? "Choose destination" : "Add media"}
          </h1>
          <div className="add-media-body">
            {browsingDestination ? (
              <FolderDestinationPicker
                tree={tree}
                value={destinationDraft}
                onChange={setDestinationDraft}
                onBusyChange={setCreatingFolder}
                onCreateFolder={onSubmit}
              />
            ) : reviewing && conflictReview.value ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  disabled={conflictReview.busy}
                  onClick={() => {
                    setReviewing(false);
                    conflictReview.clear();
                  }}
                >
                  <ArrowLeft aria-hidden="true" /> Back to files
                </Button>
                <ConflictReview
                  action="add"
                  preview={conflictReview.value}
                  busy={conflictReview.busy}
                  error={conflictReview.error}
                  onChange={conflictReview.choose}
                  onRetry={conflictReview.retry}
                />
              </>
            ) : (
              <>
                <div className="add-media-destination">
                  <Folder
                    className="shrink-0 text-muted-foreground size-5"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Destination</p>
                    <p className="break-words text-sm text-muted-foreground">
                      {destinationFolder
                        ? `${destinationRoot?.label ?? "Library"}${destinationFolder.relativePath ? ` / ${destinationFolder.relativePath}` : ""}`
                        : !tree && (isLoadingFolders || retryingFolders)
                          ? "Loading folders…"
                          : "Choose a destination"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={conflictReview.busy || !tree}
                    onClick={() => {
                      setDestinationDraft(destination);
                      setBrowsingDestination(true);
                    }}
                  >
                    {destinationFolder ? "Change" : "Choose folder"}
                  </Button>
                </div>
                {!tree && !isLoadingFolders && !retryingFolders ? (
                  <div className="grid justify-items-start gap-2">
                    <p className="text-sm text-destructive" role="alert">
                      Folders could not be loaded. Try again.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRetryingFolders(true);
                        void onRefreshFolders()
                          .catch(() => undefined)
                          .finally(() => setRetryingFolders(false));
                      }}
                    >
                      Retry loading folders
                    </Button>
                  </div>
                ) : tree && !tree.roots.some((root) => root.writable) ? (
                  <p className="text-sm text-muted-foreground">
                    No folders are available for uploads. Ask the server
                    operator to enable a destination.
                  </p>
                ) : null}
                <div
                  className="add-media-choose"
                  data-has-files={draft.length > 0}
                  data-dragging={draggingFiles || undefined}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes("Files")) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setDraggingFiles(true);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null
                      )
                    )
                      setDraggingFiles(false);
                  }}
                  onDrop={() => setDraggingFiles(false)}
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="add-media-dropzone"
                    aria-describedby="add-media-limits"
                    disabled={conflictReview.busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload aria-hidden="true" className="size-5" />
                    <span>
                      {draft.length
                        ? "Choose more files"
                        : "Choose files or drop photos and videos"}
                    </span>
                  </Button>
                  <Input
                    id="add-media-files"
                    className="sr-only"
                    tabIndex={-1}
                    ref={fileInputRef}
                    type="file"
                    aria-label="Choose media"
                    accept="image/*,video/*,.heic,.heif,.mov,.mkv"
                    multiple
                    disabled={conflictReview.busy}
                    onChange={(event) => {
                      choose(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  {limits ? (
                    <p
                      id="add-media-limits"
                      className="text-xs text-muted-foreground"
                    >
                      Up to {limits.maxBatchItems} files ·{" "}
                      {formatBytes(limits.maxUploadBytes)} per file
                    </p>
                  ) : uploads.error ? (
                    <div id="add-media-limits">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void refresh().catch(() =>
                            setError(
                              "Upload limits could not be loaded. Try again."
                            )
                          )
                        }
                      >
                        Retry loading upload limits
                      </Button>
                    </div>
                  ) : (
                    <p
                      id="add-media-limits"
                      className="text-xs text-muted-foreground"
                      role="status"
                    >
                      Loading upload limits…
                    </p>
                  )}
                </div>
                {draft.length ? (
                  <div className="add-media-review">
                    <p className="text-sm" role="status">
                      {draft.length} {draft.length === 1 ? "file" : "files"}{" "}
                      selected · {formatBytes(draftTotal)}
                    </p>
                    <ul className="add-media-files" aria-label="Files to add">
                      {draft.map(({ key, file }) => {
                        const validation = uploadFileError(file, limits);
                        return (
                          <li key={key} className="add-media-file">
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(file.size)}
                              </p>
                              {validation ? (
                                <p className="text-sm text-destructive">
                                  {validation}
                                </p>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={conflictReview.busy}
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setDraft((current) =>
                                  current.filter((item) => item.key !== key)
                                )
                              }
                            >
                              Remove
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <footer className="add-media-footer">
            {batchError && !browsingDestination ? (
              <p className="text-sm text-destructive" role="alert">
                {batchError}
              </p>
            ) : null}
            {reviewResult ? (
              <p role="status" className="text-sm">
                {reviewResult}
              </p>
            ) : null}
            {error || uploads.error || (!reviewing && conflictReview.error) ? (
              <p className="text-sm text-destructive" role="alert">
                {error ?? uploads.error ?? conflictReview.error}
              </p>
            ) : null}
            <div className="add-media-actions">
              {browsingDestination ? (
                <>
                  <Button
                    variant="outline"
                    disabled={creatingFolder}
                    onClick={() => setBrowsingDestination(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      creatingFolder ||
                      !folderIsWritable(tree, destinationDraft)
                    }
                    onClick={() => {
                      setDestination(destinationDraft);
                      setBrowsingDestination(false);
                    }}
                  >
                    Use folder
                  </Button>
                </>
              ) : reviewing ? (
                <>
                  <Button variant="outline" onClick={cancel}>
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      conflictReview.busy || Boolean(conflictReview.error)
                    }
                    onClick={() => void addFiles()}
                  >
                    {conflictReview.busy
                      ? "Checking names…"
                      : conflictReview.value &&
                          reviewCounts(conflictReview.value).included
                        ? "Add files"
                        : "Done"}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={cancel}>
                    Cancel
                  </Button>
                  <Button
                    disabled={Boolean(
                      !draft.length ||
                      batchError ||
                      invalidFiles ||
                      !folderIsWritable(tree, destination) ||
                      conflictReview.busy ||
                      !limits
                    )}
                    onClick={() => void addFiles()}
                  >
                    {conflictReview.busy ? "Checking names…" : "Add files"}
                  </Button>
                </>
              )}
            </div>
          </footer>
        </div>
      </section>
      {activityOpen ? (
        <ActivityPage
          uploads={uploads}
          operations={operations}
          onRefresh={onRefresh}
          onOperation={onOperation}
          onRetry={retryOperation}
        />
      ) : null}
    </>
  );
}
