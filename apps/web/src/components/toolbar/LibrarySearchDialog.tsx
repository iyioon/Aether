import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Check, ChevronDown, Folder, Search, X } from "lucide-react";
import type { TreeResponse } from "../../api/client";
import {
  MAX_SEARCH_LENGTH,
  MAX_TAG_FILTERS,
  normalizeLibrarySearch
} from "../library-state";
import { useTagSuggestions } from "../tags/useTagSuggestions";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { FilterControls } from "./FilterControls";
import {
  addPendingSearchTag,
  matchingSearchFolders,
  searchFolders,
  type LibrarySearchValues,
  type SearchFolder
} from "./search-state";
import "./search-dialog.css";

interface LibrarySearchDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  value: LibrarySearchValues;
  tree: TreeResponse | null;
  isLoadingTree: boolean;
  onRefreshFolders: () => Promise<unknown>;
  onSearch: (value: LibrarySearchValues) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function LibrarySearchDialog(props: LibrarySearchDialogProps) {
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      {props.isOpen ? <SearchDialogContent {...props} /> : null}
    </Dialog>
  );
}

function SearchDialogContent({
  value,
  tree,
  isLoadingTree,
  onRefreshFolders,
  onOpenChange,
  onSearch,
  onCloseAutoFocus
}: LibrarySearchDialogProps) {
  const [draft, setDraft] = useState(() => ({
    ...value,
    tags: [...value.tags]
  }));
  const [tagDraft, setTagDraft] = useState("");
  const [isRetryingFolders, setRetryingFolders] = useState(false);
  const activeRef = useRef(true);
  const retryPendingRef = useRef(false);
  const inputId = useId();
  const scopeDescriptionId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(
    null
  );
  const folders = useMemo(() => searchFolders(tree), [tree]);
  const folderId =
    draft.folderId ?? value.folderId ?? tree?.roots[0]?.folderId ?? null;
  const foldersPending = !tree && (isLoadingTree || isRetryingFolders);
  const foldersFailed = !tree && !foldersPending;
  const unavailableFolder = Boolean(
    tree && folderId && !folders.some((folder) => folder.id === folderId)
  );
  const canSearch = Boolean(tree && folderId && !unavailableFolder);
  const suggestions = useTagSuggestions({
    query: tagDraft,
    enabled:
      draft.tagStatus !== "untagged" && draft.tags.length < MAX_TAG_FILTERS
  });

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  async function retryFolders() {
    if (retryPendingRef.current) return;
    retryPendingRef.current = true;
    setRetryingFolders(true);
    try {
      await onRefreshFolders();
    } catch {
      // Keep the field error and draft available for another attempt.
    } finally {
      retryPendingRef.current = false;
      if (activeRef.current) setRetryingFolders(false);
    }
  }

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const dialog = dialogElement;
    if (!viewport || !dialog) return;
    let frame: number | null = null;
    function updateViewport() {
      frame = null;
      if (!viewport || !dialog) return;
      const values = {
        height: viewport.height,
        width: viewport.width,
        top: viewport.offsetTop,
        left: viewport.offsetLeft
      };
      if (
        !Object.values(values).every(Number.isFinite) ||
        values.height <= 0 ||
        values.width <= 0
      )
        return;
      for (const [name, value] of Object.entries(values))
        dialog.style.setProperty(
          `--library-search-viewport-${name}`,
          `${value}px`
        );
    }
    function scheduleViewportUpdate() {
      if (frame === null) frame = window.requestAnimationFrame(updateViewport);
    }
    updateViewport();
    viewport.addEventListener("resize", scheduleViewportUpdate);
    viewport.addEventListener("scroll", scheduleViewportUpdate);
    window.addEventListener("resize", scheduleViewportUpdate);
    return () => {
      viewport.removeEventListener("resize", scheduleViewportUpdate);
      viewport.removeEventListener("scroll", scheduleViewportUpdate);
      window.removeEventListener("resize", scheduleViewportUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
      for (const name of ["height", "width", "top", "left"])
        dialog.style.removeProperty(`--library-search-viewport-${name}`);
    };
  }, [dialogElement]);

  function addTag(rawTag: string) {
    const next = addPendingSearchTag(draft, rawTag);
    if (next === draft) return;
    setDraft(next);
    setTagDraft("");
  }

  function clearSearch() {
    setDraft((current) => ({
      ...current,
      search: "",
      tags: [],
      tagMatch: "all",
      tagStatus: "all",
      mediaType: "all",
      scoreFilter: "all"
    }));
    setTagDraft("");
    searchRef.current?.focus({ preventScroll: true });
  }

  return (
    <DialogContent
      ref={setDialogElement}
      className="library-search-dialog"
      showCloseButton={false}
      aria-describedby={undefined}
      onCloseAutoFocus={onCloseAutoFocus}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" && event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        searchRef.current?.focus({ preventScroll: true });
      }}
    >
      <form
        className="library-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSearch) return;
          onSearch({
            ...addPendingSearchTag(draft, tagDraft),
            folderId,
            search: normalizeLibrarySearch(draft.search)
          });
          onOpenChange(false);
        }}
      >
        <DialogHeader className="library-search-heading">
          <DialogTitle>Search</DialogTitle>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </DialogHeader>
        <div className="library-search-body">
          <div className="library-search-field">
            <Label htmlFor={inputId}>Filename or path</Label>
            <div className="library-search-input">
              <Search aria-hidden="true" />
              <Input
                id={inputId}
                ref={searchRef}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                maxLength={MAX_SEARCH_LENGTH}
                value={draft.search}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    search: event.target.value
                  }))
                }
              />
            </div>
          </div>
          <div className="library-search-field" aria-busy={foldersPending}>
            <Label id={`${scopeDescriptionId}-label`}>Folder</Label>
            <SearchFolderPicker
              folders={folders}
              folderId={folderId}
              descriptionId={
                unavailableFolder
                  ? `${scopeDescriptionId} ${scopeDescriptionId}-error`
                  : foldersFailed
                    ? `${scopeDescriptionId}-error`
                    : tree
                      ? scopeDescriptionId
                      : undefined
              }
              invalid={unavailableFolder}
              loading={foldersPending}
              disabled={!tree || !folders.length}
              onChange={(folderId) =>
                setDraft((current) => ({ ...current, folderId }))
              }
            />
            {tree ? (
              <p id={scopeDescriptionId} className="library-search-scope-note">
                {folders.length
                  ? "Includes subfolders"
                  : "No folders are available"}
              </p>
            ) : null}
            {foldersFailed ? (
              <>
                <p
                  id={`${scopeDescriptionId}-error`}
                  className="library-search-folder-error"
                  role="alert"
                >
                  Folders could not be loaded.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => void retryFolders()}
                >
                  Retry loading folders
                </Button>
              </>
            ) : null}
            {unavailableFolder ? (
              <p
                id={`${scopeDescriptionId}-error`}
                className="library-search-folder-error"
                role="alert"
              >
                This folder is no longer available. Choose another folder.
              </p>
            ) : null}
          </div>
          <FilterControls
            filterTagSuggestions={suggestions}
            mediaType={draft.mediaType}
            scoreFilter={draft.scoreFilter}
            tagFilters={draft.tags}
            tagMatch={draft.tagMatch}
            tagStatus={draft.tagStatus}
            tagFilterDraft={tagDraft}
            onSetTagMatch={(tagMatch) =>
              setDraft((current) => ({ ...current, tagMatch }))
            }
            onSetTagStatus={(tagStatus) => {
              setDraft((current) => ({
                ...current,
                tagStatus,
                tags: tagStatus === "untagged" ? [] : current.tags
              }));
              if (tagStatus === "untagged") setTagDraft("");
            }}
            onAddTagFilter={addTag}
            onSetMediaType={(mediaType) =>
              setDraft((current) => ({ ...current, mediaType }))
            }
            onRemoveTagFilter={(tag) =>
              setDraft((current) => ({
                ...current,
                tags: current.tags.filter((selected) => selected !== tag)
              }))
            }
            onSetScoreFilter={(scoreFilter) =>
              setDraft((current) => ({ ...current, scoreFilter }))
            }
            onSetTagFilterDraft={setTagDraft}
          />
        </div>
        <div className="library-search-footer">
          <Button type="button" variant="ghost" onClick={clearSearch}>
            Clear
          </Button>
          <div className="library-search-submit-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSearch}>
              Search
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}

function SearchFolderPicker({
  folders,
  folderId,
  descriptionId,
  invalid,
  loading,
  disabled,
  onChange
}: {
  folders: SearchFolder[];
  folderId: string | null;
  descriptionId?: string;
  invalid: boolean;
  loading: boolean;
  disabled: boolean;
  onChange: (folderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabDirectionRef = useRef<"forward" | "backward" | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = folders.find((folder) => folder.id === folderId);
  const label = loading
    ? "Loading folders…"
    : (selected?.label ??
      (disabled
        ? "Choose folder"
        : folderId
          ? "Folder unavailable"
          : "Choose folder"));
  const { options, total } = matchingSearchFolders(folders, query, folderId);
  const activeFolder = options[Math.min(activeIndex, options.length - 1)];
  const activeId = activeFolder ? `${listId}-${activeFolder.id}` : undefined;

  useEffect(() => {
    if (open && activeId)
      optionRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, open]);

  function chooseFolder(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery("");
          const { options: initialOptions } = matchingSearchFolders(
            folders,
            "",
            folderId
          );
          setActiveIndex(
            Math.max(
              0,
              initialOptions.findIndex((folder) => folder.id === folderId)
            )
          );
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          ref={triggerRef}
          variant="outline"
          className="library-search-folder-trigger"
          aria-label={`Folder, ${label}`}
          aria-describedby={descriptionId}
          aria-invalid={invalid}
          disabled={disabled}
        >
          <Folder aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="library-search-folder-picker"
        align="start"
        collisionPadding={12}
        aria-label="Choose folder"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
          if (activeId)
            optionRefs.current
              .get(activeId)
              ?.scrollIntoView({ block: "nearest" });
        }}
        onCloseAutoFocus={(event) => {
          const direction = tabDirectionRef.current;
          tabDirectionRef.current = null;
          if (!direction) return;
          event.preventDefault();
          const trigger = triggerRef.current;
          if (!trigger?.isConnected) return;
          if (direction === "backward") {
            trigger.focus({ preventScroll: true });
            return;
          }
          const dialog = trigger.closest(".library-search-dialog");
          const controls = Array.from(
            dialog?.querySelectorAll<HTMLElement>(
              "a[href], button, input, textarea, select, [tabindex]"
            ) ?? []
          ).filter(
            (control) =>
              control.tabIndex >= 0 &&
              !control.matches(":disabled") &&
              !control.closest('[inert], [aria-hidden="true"]') &&
              control.getClientRects().length > 0 &&
              window.getComputedStyle(control).visibility !== "hidden"
          );
          (controls[controls.indexOf(trigger) + 1] ?? trigger).focus({
            preventScroll: true
          });
        }}
      >
        <Input
          ref={inputRef}
          role="combobox"
          aria-label="Find folder"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          placeholder="Find folder"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Tab" &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey
            ) {
              event.preventDefault();
              event.stopPropagation();
              tabDirectionRef.current = event.shiftKey ? "backward" : "forward";
              setOpen(false);
              return;
            }
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) =>
                Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    current + (event.key === "ArrowDown" ? 1 : -1)
                  )
                )
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (activeFolder) chooseFolder(activeFolder.id);
            }
          }}
        />
        <div
          id={listId}
          className="library-search-folders"
          role="listbox"
          aria-label="Folders"
        >
          {options.map((folder) => {
            const id = `${listId}-${folder.id}`;
            return (
              <Button
                id={id}
                ref={(button) => {
                  if (button) optionRefs.current.set(id, button);
                  else optionRefs.current.delete(id);
                }}
                key={folder.id}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={folder.id === folderId}
                variant="ghost"
                className="library-search-folder-option"
                data-active={activeFolder?.id === folder.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseFolder(folder.id)}
              >
                <Folder aria-hidden="true" />
                <span>{folder.label}</span>
                {folder.id === folderId ? <Check aria-hidden="true" /> : null}
              </Button>
            );
          })}
        </div>
        {!total ? (
          <p className="library-search-scope-note" role="status">
            No folders match
          </p>
        ) : null}
        {total > options.length ? (
          <p className="library-search-scope-note" role="status">
            Showing {options.length} of {total} folders. Type to narrow the
            list.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
