import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageOff,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert
} from "lucide-react";
import {
  ApiError,
  getTrash,
  type FileOperation,
  type TrashRecord,
  type TreeRoot
} from "../../api/client";
import { usePageLifecycle } from "../../hooks/usePageLifecycle";
import { createUuid } from "../../lib/uuid";
import { restoreFocusAfterClose } from "../../lib/focus-restoration";
import { formatBytes } from "../media/media-format";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";
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
import type { ManagementTarget } from "./FileOperationDialog";

export function TrashPage({
  roots = [],
  operations = [],
  revision,
  onManage,
  onEmptyTrash,
  onOpenActivity,
  onRefreshOperations
}: {
  roots?: TreeRoot[];
  operations?: FileOperation[];
  revision: string | undefined;
  onManage: (target: ManagementTarget) => void;
  onEmptyTrash: (input: {
    requestId: string;
    expectedRevision: string;
    expectedCount: number;
  }) => Promise<FileOperation>;
  onOpenActivity?: () => void;
  onRefreshOperations?: (signal?: AbortSignal) => Promise<void>;
}) {
  const [items, setItems] = useState<TrashRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [loadedSearch, setLoadedSearch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [totalRetained, setTotalRetained] = useState(0);
  const [emptySnapshot, setEmptySnapshot] = useState<{
    requestId: string;
    expectedRevision: string;
    expectedCount: number;
  } | null>(null);
  const [emptyPending, setEmptyPending] = useState(false);
  const [emptyError, setEmptyError] = useState<string | null>(null);
  const [emptyUnknown, setEmptyUnknown] = useState(false);
  const emptyPendingRef = useRef(false);
  const emptyTrashTriggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [checkingOperations, setCheckingOperations] = useState(
    Boolean(onRefreshOperations)
  );
  const [operationsKnown, setOperationsKnown] = useState(!onRefreshOperations);
  const [operationsError, setOperationsError] = useState<string | null>(null);
  const operationsRequestRef = useRef<AbortController | null>(null);
  const refreshOperations = useCallback(async () => {
    if (!onRefreshOperations) {
      setOperationsKnown(true);
      setCheckingOperations(false);
      setOperationsError(null);
      return;
    }
    operationsRequestRef.current?.abort();
    const controller = new AbortController();
    operationsRequestRef.current = controller;
    setCheckingOperations(true);
    setOperationsKnown(false);
    setOperationsError(null);
    try {
      await onRefreshOperations(controller.signal);
      if (!controller.signal.aborted) setOperationsKnown(true);
    } catch {
      if (!controller.signal.aborted)
        setOperationsError(
          "Activity could not be loaded. Try again before restoring or deleting items."
        );
    } finally {
      if (!controller.signal.aborted) setCheckingOperations(false);
    }
  }, [onRefreshOperations]);
  useEffect(() => {
    void refreshOperations();
    return () => operationsRequestRef.current?.abort();
  }, [refreshOperations]);
  const acceptedRevisionRef = useRef<string | null>(null);
  const appendRef = useRef<AbortController | null>(null);
  const queryRef = useRef(search);
  queryRef.current = search;
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  function refreshAll() {
    refresh();
    void refreshOperations();
  }
  usePageLifecycle({ onResume: refresh });
  useEffect(() => {
    const controller = new AbortController();
    appendRef.current?.abort();
    appendRef.current = null;
    setLoadingMore(false);
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    void getTrash(controller.signal, { search })
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items);
        setLoadedSearch(search);
        setTotal(result.page.total);
        setTotalRetained(result.totalRetained);
        acceptedRevisionRef.current = result.revision;
        setRetentionDays(result.retentionDays);
        const ids = new Set(result.items.map((item) => item.id));
        setSelected(
          (current) => new Set([...current].filter((id) => ids.has(id)))
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Trash could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, reload, search]);
  const visible = loading || loadedSearch === search ? items : [];
  const staleResults = loading || loadedSearch !== search;
  async function loadMore() {
    if (staleResults || appendRef.current || items.length >= total) return;
    const query = search;
    const controller = new AbortController();
    appendRef.current = controller;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const result = await getTrash(controller.signal, {
        search: query,
        offset: items.length
      });
      if (controller.signal.aborted || queryRef.current !== query) return;
      if (result.revision !== acceptedRevisionRef.current) {
        refresh();
        return;
      }
      const existing = new Set(items.map((item) => item.id));
      if (result.items.some((item) => existing.has(item.id))) {
        refresh();
        return;
      }
      setItems((current) => [...current, ...result.items]);
      setTotal(result.page.total);
    } catch {
      if (!controller.signal.aborted)
        setLoadMoreError("More items could not be loaded.");
    } finally {
      if (appendRef.current === controller) {
        appendRef.current = null;
        setLoadingMore(false);
      }
    }
  }
  useEffect(() => () => appendRef.current?.abort(), []);
  const pendingOperations = operations.filter((operation) =>
    ["queued", "running", "needs_attention"].includes(operation.status)
  );
  const emptyOperation = pendingOperations.find(
    (operation) => operation.type === "empty-trash"
  );
  const pendingById = new Map<string, FileOperation>();
  for (const operation of pendingOperations) {
    if (operation.type !== "restore" && operation.type !== "purge") continue;
    for (const item of operation.items) {
      if (
        item.trashId &&
        !["completed", "failed", "cancelled"].includes(item.status) &&
        !pendingById.has(item.trashId)
      )
        pendingById.set(item.trashId, operation);
    }
  }
  const hasPendingMutation = Boolean(emptyOperation || pendingById.size);
  const mutationsUnavailable = checkingOperations || !operationsKnown;
  const selectedItems = items.filter((item) => selected.has(item.id));
  const selectionPending = Boolean(
    emptyOperation || selectedItems.some((item) => pendingById.has(item.id))
  );
  function action(type: "restore" | "purge", records = selectedItems) {
    if (
      records.length &&
      !mutationsUnavailable &&
      !emptyOperation &&
      !records.some((item) => pendingById.has(item.id))
    )
      onManage({ type, trash: records });
  }
  async function emptyTrash() {
    if (!emptySnapshot || emptyPendingRef.current || mutationsUnavailable)
      return;
    emptyPendingRef.current = true;
    setEmptyPending(true);
    setEmptyError(null);
    try {
      await onEmptyTrash(emptySnapshot);
      if (!mountedRef.current) return;
      setEmptySnapshot(null);
      setSelected(new Set());
    } catch (caught) {
      if (!mountedRef.current) return;
      const known =
        caught instanceof ApiError &&
        caught.status >= 400 &&
        caught.status < 500;
      if (known) {
        setEmptySnapshot(null);
        setActionError(
          "Trash changed or could not be emptied. Review the current items and try again."
        );
        refresh();
      } else {
        setEmptyUnknown(true);
        setEmptyError(
          "The request could not be confirmed. Retry checks the same operation; progress is available in Activity."
        );
      }
    } finally {
      emptyPendingRef.current = false;
      if (mountedRef.current) setEmptyPending(false);
    }
  }
  return (
    <section
      className="trash-page mx-auto grid w-full max-w-5xl gap-4 p-4 md:p-6"
      aria-labelledby="trash-title"
    >
      <h1
        ref={headingRef}
        id="trash-title"
        tabIndex={-1}
        className="sr-only outline-none"
      >
        Trash
      </h1>
      <div className="trash-toolbar">
        <div className="trash-search-row">
          <div className="trash-search">
            <Search aria-hidden="true" className="size-4" />
            <Input
              aria-label="Search Trash"
              placeholder="Search Trash"
              value={search}
              maxLength={128}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelected(new Set());
              }}
            />
          </div>
          <div className="trash-page-actions">
            <Button
              ref={emptyTrashTriggerRef}
              type="button"
              variant="outline"
              disabled={
                loading ||
                !totalRetained ||
                !acceptedRevisionRef.current ||
                mutationsUnavailable ||
                hasPendingMutation
              }
              onClick={() => {
                if (!acceptedRevisionRef.current) return;
                setEmptyError(null);
                setActionError(null);
                setEmptyUnknown(false);
                setEmptySnapshot({
                  requestId: createUuid(),
                  expectedRevision: acceptedRevisionRef.current,
                  expectedCount: totalRetained
                });
              }}
            >
              Empty Trash
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Refresh Trash"
              disabled={loading}
              onClick={refreshAll}
            >
              <RefreshCw />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground" role="status">
          {loading
            ? "Loading Trash…"
            : loadedSearch === search
              ? search.trim()
                ? `${total} of ${totalRetained} items`
                : `${total} ${total === 1 ? "item" : "items"}`
              : null}
          {retentionDays !== null
            ? ` · Kept for ${retentionDays} ${retentionDays === 1 ? "day" : "days"}`
            : ""}
        </p>
        {emptyOperation ? (
          <div className="trash-operation-status">
            <p className="text-sm text-muted-foreground">
              {emptyOperation.status === "needs_attention"
                ? "Empty Trash needs attention."
                : "Emptying Trash…"}
            </p>
            {onOpenActivity ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onOpenActivity}
              >
                View activity
              </Button>
            ) : null}
          </div>
        ) : null}
        {selectedItems.length ? (
          <div className="trash-selection-bar">
            <div className="trash-selection-summary">
              <span className="text-sm" role="status">
                {selectedItems.length} selected
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                staleResults || mutationsUnavailable || selectionPending
              }
              onClick={() => action("restore")}
            >
              <RotateCcw />
              Restore
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                staleResults || mutationsUnavailable || selectionPending
              }
              onClick={() => action("purge")}
            >
              <Trash2 />
              Delete permanently
            </Button>
          </div>
        ) : null}
      </div>
      {!loading && !error && checkingOperations ? (
        <p className="text-sm text-muted-foreground" role="status">
          Checking activity…
        </p>
      ) : null}
      {operationsError && !error ? (
        <div className="trash-error trash-baseline-error" role="alert">
          <p className="text-sm text-destructive">{operationsError}</p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refreshOperations()}
            >
              Retry loading Activity
            </Button>
            {onOpenActivity ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onOpenActivity}
              >
                View activity
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error || actionError ? (
        <div className="trash-error" role="alert">
          <p className="text-sm text-destructive">{error ?? actionError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => {
              setActionError(null);
              refreshAll();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {!loading && !error && !visible.length ? (
        <div className="trash-empty-state">
          <Trash2 aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search.trim() ? "No items match this search." : "Trash is empty."}
          </p>
          {search.trim() ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSearch("")}
            >
              Clear search
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="trash-list" aria-busy={loading}>
        {loading && !visible.length ? (
          <div aria-hidden="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="trash-item flex gap-3 p-4">
                <Skeleton className="size-14 shrink-0" />
                <div className="grid flex-1 gap-2 py-1">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {visible.map((item) => {
          const pendingOperation = emptyOperation ?? pendingById.get(item.id);
          const needsAttention = pendingOperation?.status === "needs_attention";
          const pendingLabel = needsAttention
            ? "Needs attention"
            : pendingOperation?.type === "restore"
              ? "Restoring…"
              : "Deleting…";
          const rootLabel = roots.find(
            (root) => root.id === item.originalRootId
          )?.label;
          const parentPath = item.originalRelativePath.includes("/")
            ? item.originalRelativePath.slice(
                0,
                item.originalRelativePath.lastIndexOf("/")
              )
            : "";
          const originalFolder =
            [rootLabel, parentPath].filter(Boolean).join(" / ") ||
            "Root folder";
          const daysRemaining = Math.max(
            0,
            Math.ceil((Date.parse(item.expiresAt) - Date.now()) / 86_400_000)
          );
          return (
            <article
              key={item.id}
              className="trash-item flex min-w-0 items-center gap-3 p-4"
              data-selected={selected.has(item.id)}
            >
              <Label className="trash-selection-label flex shrink-0 items-center gap-3">
                <Checkbox
                  aria-label={`Select ${item.name}`}
                  checked={selected.has(item.id)}
                  disabled={
                    staleResults ||
                    mutationsUnavailable ||
                    Boolean(pendingOperation) ||
                    (!selected.has(item.id) && selected.size >= 100)
                  }
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                <div
                  className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <ImageOff className="size-5" />
                  <img
                    className="absolute inset-0 size-full object-cover"
                    src={`/api/trash/${encodeURIComponent(item.id)}/thumbnail`}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                </div>
              </Label>
              <div className="trash-item-details min-w-0 flex-1">
                <h2 className="break-words text-sm font-medium">{item.name}</h2>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={originalFolder}
                >
                  Original folder: {originalFolder}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(item.sizeBytes)} · Deleted{" "}
                  <time
                    dateTime={item.deletedAt}
                    title={new Date(item.deletedAt).toLocaleString()}
                  >
                    {new Date(item.deletedAt).toLocaleDateString()}
                  </time>
                </p>
                <p className="text-xs text-muted-foreground">
                  <time
                    dateTime={item.expiresAt}
                    title={new Date(item.expiresAt).toLocaleString()}
                  >
                    {daysRemaining} {daysRemaining === 1 ? "day" : "days"}{" "}
                    remaining
                  </time>
                </p>
              </div>
              {!selected.size || pendingOperation ? (
                <div className="trash-item-actions">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="trash-item-restore"
                    aria-label={
                      pendingOperation
                        ? needsAttention
                          ? `Needs attention for ${item.name}`
                          : `${pendingOperation.type === "restore" ? "Restoring" : "Deleting"} ${item.name}`
                        : `Restore ${item.name}`
                    }
                    disabled={
                      staleResults ||
                      mutationsUnavailable ||
                      Boolean(pendingOperation)
                    }
                    onClick={() => action("restore", [item])}
                  >
                    {pendingOperation ? (
                      needsAttention ? (
                        <TriangleAlert aria-hidden="true" />
                      ) : (
                        <LoaderCircle
                          aria-hidden="true"
                          className="motion-safe:animate-spin"
                        />
                      )
                    ) : (
                      <RotateCcw aria-hidden="true" />
                    )}
                    {pendingOperation ? pendingLabel : "Restore"}
                  </Button>
                  {pendingOperation && !emptyOperation && onOpenActivity ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`View activity for ${item.name}`}
                      onClick={onOpenActivity}
                    >
                      View activity
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {selected.size >= 100 ? (
        <p className="text-sm text-muted-foreground">
          Up to 100 items can be selected at once.
        </p>
      ) : null}
      {loadMoreError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadMoreError}
        </p>
      ) : null}
      {loadedSearch === search && items.length < total ? (
        <Button
          className="justify-self-center"
          type="button"
          variant="outline"
          disabled={loading || loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : loadMoreError ? "Retry" : "Load more"}
        </Button>
      ) : null}
      <AlertDialog
        open={Boolean(emptySnapshot)}
        onOpenChange={(open) => {
          if (!open && !emptyPendingRef.current) setEmptySnapshot(null);
        }}
      >
        <AlertDialogContent
          className="management-confirmation"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusAfterClose(emptyTrashTriggerRef.current);
          }}
          onEscapeKeyDown={(event) => {
            if (emptyPendingRef.current) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete all {emptySnapshot?.expectedCount} retained
              items, including items hidden by search, and their Aether
              metadata. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {emptyError ? (
            <p role="alert" className="text-sm text-destructive">
              {emptyError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emptyPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={emptyPending || mutationsUnavailable}
              onClick={(event) => {
                event.preventDefault();
                void emptyTrash();
              }}
            >
              {emptyPending
                ? "Submitting…"
                : emptyUnknown
                  ? "Retry"
                  : "Empty Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
