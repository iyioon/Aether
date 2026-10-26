import { useEffect, useRef, useState, type ReactElement } from "react";
import { Download, Info, Pencil } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { isKeyboardActivationTarget } from "../../lib/keyboard";
import { downloadUrl } from "../media/media-urls";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "../ui/context-menu";

export function GalleryCardActions({
  asset,
  disabled,
  children,
  onInfo,
  onEdit
}: {
  asset: AssetRecord;
  disabled: boolean;
  children: ReactElement;
  onInfo: (asset: AssetRecord) => void;
  onEdit: (asset: AssetRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const touchPointerRef = useRef<number | null>(null);
  const blockTouchMenuRef = useRef(false);
  const suppressClickRef = useRef(false);
  const gestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => gestureCleanupRef.current?.(), []);

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
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="gallery-card-menu"
        aria-label={`Options for ${asset.name}`}
        collisionPadding={12}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocusRef.current?.focus({ preventScroll: true });
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          action?.();
        }}
      >
        <ContextMenuItem
          onSelect={() => {
            pendingActionRef.current = () => onInfo(asset);
          }}
        >
          <Info aria-hidden="true" /> Info
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            pendingActionRef.current = () => onEdit(asset);
          }}
        >
          <Pencil aria-hidden="true" /> Edit media
        </ContextMenuItem>
        <ContextMenuItem asChild>
          <a href={downloadUrl(asset.id)} download>
            <Download aria-hidden="true" /> Download
          </a>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
