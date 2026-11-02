import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileOperation,
  FileOperationInput,
  TreeResponse
} from "../../api/client";
import {
  useMediaUploads,
  type Transfer,
  type UploadProgress
} from "./useMediaUploads";
export type { UploadProgress } from "./useMediaUploads";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Progress } from "../ui/progress";
import { ActivityContents, ActivityPanel } from "./ActivitySheet";
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

const uploadStatusLabels: Record<Transfer["state"], string> = {
  queued: "Queued",
  uploading: "Uploading",
  paused: "Paused",
  checking: "Checking",
  received: "Preparing media",
  error: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
  completed: "Completed",
  expired: "Expired"
};

export function AddMediaDialog({
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
  incomingMedia
}: {
  operations: FileOperation[];
  onRefresh: () => Promise<void>;
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
  const incomingIdRef = useRef<number | null>(null);
  const submittedDraftRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const [resumeTarget, setResumeTarget] = useState<Transfer | null>(null);
  const conflictReview = useConflictReview();
  const clearConflictReview = conflictReview.clear;
  const [reviewing, setReviewing] = useState(false);
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
  const { transfers, limits, refresh, running } = uploads;
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
      setReviewResult(null);
      setReviewing(false);
      clearConflictReview();
      setDraft((current) => [
        ...current,
        ...picked.map((file) => ({ key: crypto.randomUUID(), file }))
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
  const batchError = draft.length ? uploadBatchError(draftFiles, limits) : null;
  const invalidFiles = draftFiles.some((file) => uploadFileError(file, limits));
  async function addFiles() {
    if (
      submittingRef.current ||
      conflictReview.busy ||
      (reviewing && conflictReview.error) ||
      !draft.length ||
      batchError ||
      invalidFiles ||
      !folderIsWritable(tree, destination)
    )
      return;
    const signature = draft.map((item) => item.key).join("|");
    if (submittedDraftRef.current === signature) return;
    submittingRef.current = true;
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
      if (!preview) return;
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
    <ActivityPanel open={open} onClose={onClose} busy={creatingFolder}>
      <div className="grid gap-6 px-4 pb-6">
        {browsingDestination ? (
          <section className="grid gap-4" aria-label="Upload destination">
            <h2 className="font-semibold">Choose destination</h2>
            <FolderDestinationPicker
              tree={tree}
              value={destinationDraft}
              onChange={setDestinationDraft}
              onBusyChange={setCreatingFolder}
              onCreateFolder={onSubmit}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={creatingFolder}
                onClick={() => setBrowsingDestination(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  creatingFolder || !folderIsWritable(tree, destinationDraft)
                }
                onClick={() => {
                  setDestination(destinationDraft);
                  setBrowsingDestination(false);
                }}
              >
                Use folder
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section className="grid gap-4" aria-labelledby="add-media-heading">
              <h2 id="add-media-heading" className="font-semibold">
                Add media
              </h2>
              {reviewing && conflictReview.value ? (
                <>
                  <ConflictReview
                    action="add"
                    preview={conflictReview.value}
                    busy={conflictReview.busy}
                    error={conflictReview.error}
                    onChange={conflictReview.choose}
                    onRetry={conflictReview.retry}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      disabled={conflictReview.busy}
                      onClick={() => {
                        setReviewing(false);
                        conflictReview.clear();
                      }}
                    >
                      Back
                    </Button>
                    <Button
                      disabled={
                        conflictReview.busy || Boolean(conflictReview.error)
                      }
                      onClick={() => void addFiles()}
                    >
                      {conflictReview.busy
                        ? "Checking names…"
                        : reviewCounts(conflictReview.value).included
                          ? "Add files"
                          : "Done"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Label>Destination</Label>
                      <p className="break-words text-sm text-muted-foreground">
                        {destinationFolder
                          ? `${destinationRoot?.label ?? "Library"}${destinationFolder.relativePath ? ` / ${destinationFolder.relativePath}` : ""}`
                          : "Choose a writable folder"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={conflictReview.busy}
                      onClick={() => {
                        setDestinationDraft(destination);
                        setBrowsingDestination(true);
                      }}
                    >
                      Change
                    </Button>
                  </div>
                  {!tree?.roots.some((root) => root.writable) ? (
                    <p className="text-sm text-muted-foreground">
                      No writable media roots are configured. Ask the server
                      operator to enable a destination.
                    </p>
                  ) : null}
                  <Input
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
                    <p className="text-xs text-muted-foreground">
                      Up to {limits.maxBatchItems} files per batch;{" "}
                      {formatBytes(limits.maxUploadBytes)} per file;{" "}
                      {formatBytes(limits.maxStagingBytes)} in unfinished
                      uploads.
                    </p>
                  ) : (
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
                      Load upload limits
                    </Button>
                  )}
                  {draft.length ? (
                    <div className="grid gap-3">
                      <p className="text-sm" role="status">
                        {draft.length} {draft.length === 1 ? "file" : "files"}{" "}
                        selected · {formatBytes(draftTotal)}
                      </p>
                      <ul className="grid gap-2" aria-label="Files to add">
                        {draft.map(({ key, file }) => {
                          const validation = uploadFileError(file, limits);
                          return (
                            <li
                              key={key}
                              className="grid gap-1 rounded-lg border p-3"
                            >
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="break-words text-sm">
                                    {file.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatBytes(file.size)}
                                  </p>
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
                              </div>
                              {validation ? (
                                <p className="text-sm text-destructive">
                                  {validation}
                                </p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {batchError ? (
                        <p className="text-sm text-destructive" role="alert">
                          {batchError}
                        </p>
                      ) : null}
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          disabled={conflictReview.busy}
                          onClick={() => {
                            setDraft([]);
                            setError(null);
                          }}
                        >
                          Discard
                        </Button>
                        <Button
                          disabled={Boolean(
                            batchError ||
                            invalidFiles ||
                            !folderIsWritable(tree, destination) ||
                            conflictReview.busy
                          )}
                          onClick={() => void addFiles()}
                        >
                          {conflictReview.busy
                            ? "Checking names…"
                            : "Add files"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
              {reviewResult ? (
                <p role="status" className="text-sm">
                  {reviewResult}
                </p>
              ) : null}
              {error ||
              uploads.error ||
              (!reviewing && conflictReview.error) ? (
                <p className="text-sm text-destructive" role="alert">
                  {error ?? uploads.error ?? conflictReview.error}
                </p>
              ) : null}
            </section>
            {transfers.length ? (
              <section className="grid gap-3" aria-label="Uploads">
                {transfers.map((transfer) => (
                  <section
                    key={transfer.key}
                    className="grid gap-2 rounded-lg border p-3"
                  >
                    <div className="flex justify-between gap-2">
                      <strong className="min-w-0 break-words text-sm">
                        {transfer.name}
                      </strong>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {uploadStatusLabels[transfer.state]}
                      </span>
                    </div>
                    <Progress
                      value={
                        transfer.size
                          ? (transfer.accepted / transfer.size) * 100
                          : 0
                      }
                      aria-label={`Upload ${transfer.name}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(transfer.accepted)} of{" "}
                      {formatBytes(transfer.size)}
                    </span>
                    {transfer.error ? (
                      <p role="alert" className="text-sm text-destructive">
                        {transfer.error}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      {transfer.state === "uploading" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            uploads.pause(transfer);
                          }}
                        >
                          Pause
                        </Button>
                      ) : ["paused", "error"].includes(transfer.state) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={running >= 2}
                          onClick={() => {
                            if (transfer.file)
                              void uploads.resume(transfer, transfer.file);
                            else setResumeTarget(transfer);
                          }}
                        >
                          Resume
                        </Button>
                      ) : null}
                      {![
                        "received",
                        "cancelled",
                        "completed",
                        "failed",
                        "expired"
                      ].includes(transfer.state) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void uploads.cancel(transfer)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </section>
                ))}
              </section>
            ) : null}
            {resumeTarget ? (
              <div className="grid gap-2">
                <Label htmlFor="resume-file">
                  Reselect {resumeTarget.name}
                </Label>
                <Input
                  id="resume-file"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploads.resume(resumeTarget, file);
                      setResumeTarget(null);
                    }
                  }}
                />
              </div>
            ) : null}
            <ActivityContents
              open={open}
              operations={operations.filter(
                (operation) =>
                  operation.type !== "add-media" ||
                  operation.status !== "completed" ||
                  !transfers.some(
                    (transfer) => transfer.operationId === operation.id
                  )
              )}
              onRefresh={onRefresh}
              onOperation={onOperation}
              onRetry={onSubmit}
            />
          </>
        )}
      </div>
    </ActivityPanel>
  );
}
