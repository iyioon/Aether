import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from "react";
import {
  Download,
  FolderInput,
  Info,
  MoreHorizontal,
  Pencil,
  Trash2
} from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { isKeyboardActivationTarget } from "../../lib/keyboard";
import { downloadUrl } from "../media/media-urls";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "../ui/context-menu";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";

export function GalleryCardActions({
  asset,
  disabled,
  children,
  onInfo,
  onEdit,
  onManage
}: {
  asset: AssetRecord;
  disabled: boolean;
  children: ReactElement;
  onInfo: (asset: AssetRecord) => void;
  onEdit: (asset: AssetRecord) => void;
  onManage?: (
    asset: AssetRecord,
    action: "rename-media" | "move-media" | "trash"
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const touchPointerRef = useRef<number | null>(null);
  const blockTouchMenuRef = useRef(false);
  const suppressClickRef = useRef(false);
  const gestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => gestureCleanupRef.current?.(), []);

  function finishAction(event: Event) {
    event.preventDefault();
    restoreFocusRef.current?.focus({ preventScroll: true });
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }

  function actions(kind: "context" | "dropdown") {
    const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
    const Separator =
      kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
    return (
      <>
        <Item
          onSelect={() => {
            pendingActionRef.current = () => onInfo(asset);
          }}
        >
          <Info aria-hidden="true" /> Info
        </Item>
        <Item
          onSelect={() => {
            pendingActionRef.current = () => onEdit(asset);
          }}
        >
          <Pencil aria-hidden="true" /> Edit media
        </Item>
        <Item asChild>
          <a href={downloadUrl(asset.id)} download>
            <Download aria-hidden="true" /> Download
          </a>
        </Item>
        {onManage ? (
          <>
            <Separator />
            <Item
              onSelect={() => {
                pendingActionRef.current = () =>
                  onManage(asset, "rename-media");
              }}
            >
              <Pencil aria-hidden="true" /> Rename…
            </Item>
            <Item
              onSelect={() => {
                pendingActionRef.current = () => onManage(asset, "move-media");
              }}
            >
              <FolderInput aria-hidden="true" /> Move to…
            </Item>
            <Separator />
            <Item
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                pendingActionRef.current = () => onManage(asset, "trash");
              }}
            >
              <Trash2 aria-hidden="true" /> Move to Trash
            </Item>
          </>
        ) : null}
      </>
    );
  }

  const card = children as ReactElement<{ children?: ReactNode }>;
  const moreOptions = !disabled ? (
    <DropdownMenu
      open={moreOpen}
      onOpenChange={(next) => {
        if (next) {
          pendingActionRef.current = null;
          restoreFocusRef.current = moreTriggerRef.current;
        }
        setMoreOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={moreTriggerRef}
          className="gallery-card-options media-overlay-button"
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`More options for ${asset.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="gallery-card-menu"
        align="end"
        collisionPadding={12}
        aria-label={`Options for ${asset.name}`}
        onCloseAutoFocus={finishAction}
      >
        {actions("dropdown")}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <ContextMenu
      open={open && !disabled}
      onOpenChange={(nextOpen) => {
        if (nextOpen && blockTouchMenuRef.current) return;
        if (nextOpen && !disabled) {
          pendingActionRef.current = null;
          restoreFocusRef.current =
            document.activeElement instanceof HTMLElement &&
            triggerRef.current?.contains(document.activeElement)
              ? document.activeElement
              : (triggerRef.current?.querySelector<HTMLButtonElement>(
                  ".media-preview-button"
                ) ?? null);
          if (touchPointerRef.current !== null) suppressClickRef.current = true;
        }
        setOpen(nextOpen && !disabled);
      }}
    >
      <ContextMenuTrigger
        asChild
        ref={triggerRef}
        disabled={disabled}
        onPointerDownCapture={(event) => {
          gestureCleanupRef.current?.();
          suppressClickRef.current = false;
          touchPointerRef.current = null;
          blockTouchMenuRef.current = false;
          if (event.pointerType === "mouse" || disabled) return;

          // Score holds and other curation gestures keep their own behavior.
          blockTouchMenuRef.current =
            isKeyboardActivationTarget(event.target) &&
            !(
              event.target instanceof Element &&
              event.target.closest(".media-preview-button")
            );
          touchPointerRef.current = event.pointerId;
          const trigger = event.currentTarget;
          const cancelLongPress = () => {
            trigger.dispatchEvent(
              new PointerEvent("pointercancel", {
                bubbles: true,
                pointerId: event.pointerId,
                pointerType: event.pointerType
              })
            );
          };
          const endGesture = () => {
            touchPointerRef.current = null;
            gestureCleanupRef.current?.();
          };
          const cancelGesture = () => {
            cancelLongPress();
            endGesture();
          };
          window.addEventListener("scroll", cancelGesture, {
            capture: true,
            passive: true
          });
          window.addEventListener("pointerup", endGesture, { once: true });
          window.addEventListener("pointercancel", endGesture, { once: true });
          window.addEventListener("blur", cancelGesture, { once: true });
          gestureCleanupRef.current = () => {
            window.removeEventListener("scroll", cancelGesture, true);
            window.removeEventListener("pointerup", endGesture);
            window.removeEventListener("pointercancel", endGesture);
            window.removeEventListener("blur", cancelGesture);
            gestureCleanupRef.current = null;
          };
        }}
        onClickCapture={(event) => {
          if (suppressClickRef.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (
            disabled ||
            (event.key !== "ContextMenu" &&
              !(event.shiftKey && event.key === "F10"))
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          blockTouchMenuRef.current = false;
          const bounds =
            event.target instanceof HTMLElement
              ? event.target.getBoundingClientRect()
              : event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left + Math.min(bounds.width / 2, 24),
              clientY: bounds.top + Math.min(bounds.height / 2, 24)
            })
          );
        }}
      >
        {cloneElement(card, undefined, card.props.children, moreOptions)}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="gallery-card-menu"
        aria-label={`Options for ${asset.name}`}
        collisionPadding={12}
        onCloseAutoFocus={finishAction}
      >
        {actions("context")}
      </ContextMenuContent>
    </ContextMenu>
  );
}
