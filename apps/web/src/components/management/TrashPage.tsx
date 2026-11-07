import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  ApiError,
  getTrash,
  type FileOperation,
  type TrashRecord
} from "../../api/client";
import { usePageLifecycle } from "../../hooks/usePageLifecycle";
import { createUuid } from "../../lib/uuid";
import { restoreFocusAfterClose } from "../../lib/focus-restoration";
import { formatBytes } from "../media/media-format";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
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
  revision,
  onManage,
  onEmptyTrash
}: {
  revision: string | undefined;
  onManage: (target: ManagementTarget) => void;
  onEmptyTrash: (input: {
    requestId: string;
    expectedRevision: string;
    expectedCount: number;
  }) => Promise<FileOperation>;
}) {
  const [items, setItems] = useState<TrashRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [loadedSearch, setLoadedSearch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
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
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [loadingMore, setLoadingMore] = useState(false);
  const acceptedRevisionRef = useRef<string | null>(null);
  const appendRef = useRef<AbortController | null>(null);
  const queryRef = useRef(search);
  queryRef.current = search;
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  usePageLifecycle({ onResume: refresh });
  useEffect(() => {
    const controller = new AbortController();
    appendRef.current?.abort();
    appendRef.current = null;
    setLoadingMore(false);
    setLoading(true);
    setError(null);
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
        if (!controller.signal.aborted)
          setError("Trash could not be loaded. Try again.");
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
        setError("More items could not be loaded. Try again.");
    } finally {
      if (appendRef.current === controller) {
        appendRef.current = null;
        setLoadingMore(false);
      }
    }
  }
  useEffect(() => () => appendRef.current?.abort(), []);
  const selectedItems = items.filter((item) => selected.has(item.id));
  function action(type: "restore" | "purge", records = selectedItems) {
    if (records.length) onManage({ type, trash: records });
  }
  async function emptyTrash() {
    if (!emptySnapshot || emptyPendingRef.current) return;
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
      className="trash-page mx-auto grid w-full max-w-5xl gap-5 p-4 md:p-6"
      aria-labelledby="trash-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 id="trash-title" className="text-xl font-semibold">
            Trash
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Items are kept for {retentionDays} days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            ref={emptyTrashTriggerRef}
            type="button"
            variant="outline"
            disabled={loading || !totalRetained || !acceptedRevisionRef.current}
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
            onClick={refresh}
          >
            <RefreshCw />
          </Button>
        </div>
      </header>
      <div className="trash-toolbar grid min-w-0 items-center gap-2">
        <Input
          className={`min-w-0 flex-1${selectedItems.length ? "" : " col-span-full"}`}
          aria-label="Search Trash"
          placeholder="Search Trash"
          value={search}
          maxLength={128}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelected(new Set());
          }}
        />
        {selectedItems.length ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={staleResults}
              onClick={() => action("restore")}
            >
              <RotateCcw />
              Restore
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={staleResults}
              onClick={() => action("purge")}
            >
              <Trash2 />
              Delete permanently
            </Button>
          </>
        ) : null}
      </div>
      {error || actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? actionError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" role="status">
          {loading
            ? "Loading Trash…"
            : loadedSearch === search
              ? `${total} ${total === 1 ? "item" : "items"}`
              : null}
          {selectedItems.length ? ` · ${selectedItems.length} selected` : ""}
        </p>
        {selectedItems.length ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </Button>
        ) : null}
      </div>
      {!loading && !error && !visible.length ? (
        <p className="text-sm text-muted-foreground">
          {search.trim() ? "No items match this search." : "Trash is empty."}
        </p>
      ) : null}
      <div
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"
        aria-busy={loading}
      >
        {visible.map((item) => (
          <article
            key={item.id}
            className="trash-item flex min-w-0 items-center gap-3 rounded-lg border p-3"
          >
            <Label className="trash-selection-label flex shrink-0 items-center gap-3">
              <Checkbox
                aria-label={`Select ${item.name}`}
                checked={selected.has(item.id)}
                disabled={
                  staleResults ||
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
              {item.originalRelativePath.includes("/") ? (
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={item.originalRelativePath}
                >
                  {item.originalRelativePath.slice(
                    0,
                    item.originalRelativePath.lastIndexOf("/")
                  )}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {formatBytes(item.sizeBytes)} · Deleted{" "}
                {new Date(item.deletedAt).toLocaleDateString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {Math.max(
                  0,
                  Math.ceil(
                    (Date.parse(item.expiresAt) - Date.now()) / 86_400_000
                  )
                )}{" "}
                days remaining
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="trash-item-restore"
              aria-label={`Restore ${item.name}`}
              disabled={staleResults}
              onClick={() => action("restore", [item])}
            >
              <RotateCcw />
              Restore
            </Button>
          </article>
        ))}
      </div>
      {selected.size >= 100 ? (
        <p className="text-sm text-muted-foreground">
          Up to 100 items can be selected at once.
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
          {loadingMore ? "Loading…" : "Load more"}
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
              disabled={emptyPending}
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
