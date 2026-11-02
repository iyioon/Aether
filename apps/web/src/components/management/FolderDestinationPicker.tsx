import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Folder,
  FolderPlus,
  HardDrive
} from "lucide-react";
import {
  ApiError,
  getFileOperation,
  type FileOperation,
  type FileOperationInput,
  type TreeResponse
} from "../../api/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "../ui/breadcrumb";
import {
  destinationBreadcrumbs,
  destinationChildren,
  destinationFolderIndex,
  destinationIsProhibited,
  destinationUnavailableReason,
  type DestinationFolder
} from "./folder-destination-state";
import {
  folderIsWritable,
  invalidName,
  isOperationTerminal,
  managementError
} from "./management-model";

export interface FolderDestinationPickerProps {
  tree: TreeResponse | null;
  value: string;
  onChange: (folderId: string) => void;
  disabled?: boolean;
  sourceFolderId?: string;
  allowOriginal?: boolean;
  onCreateFolder?: (input: FileOperationInput) => Promise<FileOperation>;
  onBusyChange?: (busy: boolean) => void;
}

/** Folder navigation embedded in the task's existing Dialog or Sheet. */
export function FolderDestinationPicker({
  tree,
  value,
  onChange,
  disabled = false,
  sourceFolderId,
  allowOriginal = false,
  onCreateFolder,
  onBusyChange
}: FolderDestinationPickerProps) {
  const [added, setAdded] = useState<DestinationFolder[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const invalidFolderName = Boolean(name && invalidName(name));
  const requestRef = useRef<FileOperationInput | null>(null);
  const pendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const activeRef = useRef(true);
  const busyCallbackRef = useRef(onBusyChange);
  busyCallbackRef.current = onBusyChange;
  const listRef = useRef<HTMLDivElement | null>(null);
  const breadcrumbRef = useRef<HTMLElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreCreateFocusRef = useRef(false);
  const nameId = useId();
  const index = useMemo(
    () => destinationFolderIndex(tree, added),
    [tree, added]
  );
  const current = index.get(value);
  const breadcrumbs = useMemo(
    () => destinationBreadcrumbs(index, value),
    [index, value]
  );
  const children = useMemo(
    () => destinationChildren(index, value),
    [index, value]
  );
  const writable =
    current && (current.writable ?? folderIsWritable(tree, current.id));
  const prohibited = destinationIsProhibited(index, value, sourceFolderId);
  const busy = disabled || saving;
  const canCreate = Boolean(
    onCreateFolder &&
    current &&
    writable &&
    !prohibited &&
    (current.sourceVersion ?? current.version)
  );

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    if (breadcrumbRef.current)
      breadcrumbRef.current.scrollLeft = breadcrumbRef.current.scrollWidth;
  }, [value]);
  useEffect(() => {
    if (creating && !saving) nameRef.current?.focus();
    else if (!creating && restoreCreateFocusRef.current) {
      restoreCreateFocusRef.current = false;
      createButtonRef.current?.focus({ preventScroll: true });
    }
  }, [creating, saving]);

  function navigate(id: string) {
    if (busy || unconfirmed) return;
    setCreating(false);
    setName("");
    setError(null);
    onChange(id);
  }

  async function createFolder() {
    if (
      !onCreateFolder ||
      pendingRef.current ||
      !canCreate ||
      (!unconfirmed && invalidName(name))
    )
      return;
    const input = requestRef.current ?? {
      requestId: crypto.randomUUID(),
      type: "create-folder" as const,
      items: [],
      destinationFolderId: value,
      expectedParentVersion: current!.sourceVersion ?? current!.version,
      name,
      conflict: "skip" as const
    };
    requestRef.current = input;
    pendingRef.current = true;
    setSaving(true);
    setError(null);
    busyCallbackRef.current?.(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      let operation = await onCreateFolder(input);
      const deadline = Date.now() + 30_000;
      while (!isOperationTerminal(operation)) {
        if (Date.now() > deadline) throw new Error("pending_creation");
        await waitForReceipt(controller.signal);
        operation = await getFileOperation(operation.id, controller.signal);
      }
      if (!activeRef.current || controller.signal.aborted) return;
      const folder = operation.items.find(
        (item) => item.status === "completed" && item.folder
      )?.folder;
      if (!folder) {
        requestRef.current = null;
        setUnconfirmed(false);
        setError(
          managementError({
            code: operation.items.find((item) => item.errorCode)?.errorCode
          })
        );
        return;
      }
      const created: DestinationFolder = {
        ...folder,
        label: folder.label ?? folder.name,
        writable: true
      };
      setAdded((previous) => [
        ...previous.filter((entry) => entry.id !== created.id),
        created
      ]);
      requestRef.current = null;
      setUnconfirmed(false);
      restoreCreateFocusRef.current = true;
      setCreating(false);
      setName("");
      onChange(created.id);
    } catch (caught) {
      if (!activeRef.current || controller.signal.aborted) return;
      const known =
        caught instanceof ApiError &&
        [400, 403, 404, 409, 429].includes(caught.status);
      if (known) requestRef.current = null;
      setUnconfirmed(!known);
      setError(
        known
          ? managementError(caught)
          : "Folder creation could not be confirmed. Retry checks the same request."
      );
    } finally {
      pendingRef.current = false;
      controllerRef.current = null;
      if (activeRef.current) {
        setSaving(false);
        busyCallbackRef.current?.(false);
      }
    }
  }

  function row(folder: DestinationFolder, root = false) {
    const forbidden = destinationIsProhibited(index, folder.id, sourceFolderId);
    const reason = forbidden
      ? "Inside the folder being moved"
      : destinationUnavailableReason(tree, folder);
    return (
      <li key={folder.id}>
        <Button
          type="button"
          variant="ghost"
          className="destination-folder-row"
          disabled={busy || unconfirmed || Boolean(reason)}
          onClick={() => navigate(folder.id)}
          aria-label={`Open ${folder.label}${reason ? `, ${reason}` : ""}`}
        >
          {root ? <HardDrive /> : <Folder />}
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate">{folder.label}</span>
            {reason ? (
              <span className="block text-xs text-muted-foreground">
                {reason}
              </span>
            ) : null}
          </span>
          <ChevronRight className="shrink-0 text-muted-foreground" />
        </Button>
      </li>
    );
  }

  return (
    <section className="destination-browser" aria-label="Destination folders">
      <div className="destination-browser-navigation">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={busy || unconfirmed || !current}
          aria-label="Back to parent folder"
          onClick={() => navigate(current?.parentId ?? "")}
        >
          <ArrowLeft />
        </Button>
        <Breadcrumb
          ref={breadcrumbRef}
          className="min-w-0 flex-1 overflow-x-auto"
          aria-label="Destination path"
        >
          <BreadcrumbList className="flex-nowrap whitespace-nowrap">
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={busy || unconfirmed}
                  onClick={() => navigate("")}
                >
                  Media roots
                </Button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {breadcrumbs.map((folder, position) => (
              <Fragment key={folder.id}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {position === breadcrumbs.length - 1 ? (
                    <BreadcrumbPage>{folder.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        disabled={busy || unconfirmed}
                        onClick={() => navigate(folder.id)}
                      >
                        {folder.label}
                      </Button>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {!current && allowOriginal ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy || unconfirmed}
          aria-pressed={!value}
          onClick={() => navigate("")}
        >
          Original folder
        </Button>
      ) : null}
      <div className="destination-folder-list" ref={listRef}>
        {current ? (
          children.length ? (
            <ul>{children.map((folder) => row(folder))}</ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No folders
            </p>
          )
        ) : (
          <ul>
            {[...index.values()]
              .filter((folder) => folder.relativePath === "")
              .map((folder) => row(folder, true))}
          </ul>
        )}
      </div>
      {current && (!writable || prohibited) ? (
        <p className="text-sm text-muted-foreground">
          {prohibited
            ? "Choose a folder outside the folder being moved."
            : destinationUnavailableReason(tree, current)}
        </p>
      ) : null}
      {creating ? (
        <div className="destination-new-folder">
          <Label htmlFor={nameId}>Folder name</Label>
          <Input
            id={nameId}
            ref={nameRef}
            value={name}
            disabled={busy || unconfirmed}
            aria-invalid={invalidFolderName}
            aria-describedby={invalidFolderName ? `${nameId}-error` : undefined}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createFolder();
              }
            }}
          />
          {invalidFolderName ? (
            <p id={`${nameId}-error`} className="text-sm text-destructive">
              Enter a name without slashes, a leading dot or surrounding spaces.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                restoreCreateFocusRef.current = true;
                setCreating(false);
                setError(null);
                requestRef.current = null;
                setUnconfirmed(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || (!unconfirmed && invalidName(name))}
              onClick={() => void createFolder()}
            >
              {saving ? "Creating…" : unconfirmed ? "Retry" : "Create"}
            </Button>
          </div>
        </div>
      ) : canCreate ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          ref={createButtonRef}
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          <FolderPlus />
          New folder
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function waitForReceipt(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 350);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
