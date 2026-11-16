import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from "lucide-react";
import { useTheme } from "next-themes";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const MODAL_SELECTOR =
  '[data-state="open"]:is([data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="sheet-content"], [data-slot="sidebar"][data-mobile="true"])';
const TOAST_OFFSET = {
  top: "calc(24px + var(--media-safe-area-top, env(safe-area-inset-top, 0px)))",
  right:
    "calc(24px + var(--media-safe-area-right, env(safe-area-inset-right, 0px)))",
  bottom:
    "calc(24px + var(--media-safe-area-bottom, env(safe-area-inset-bottom, 0px)))",
  left: "calc(24px + var(--media-safe-area-left, env(safe-area-inset-left, 0px)))"
};

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "toast-portal";
    return element;
  });
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const relocate = () => {
      const fullscreen = document.fullscreenElement;
      const root =
        fullscreen instanceof HTMLElement &&
        !(fullscreen instanceof HTMLMediaElement)
          ? fullscreen
          : document.body;
      const target =
        Array.from(root.querySelectorAll<HTMLElement>(MODAL_SELECTOR)).at(-1) ??
        root;
      if (host.parentElement === target) return;
      const focused = document.activeElement;
      const restore = focused instanceof HTMLElement && host.contains(focused);
      // Moving the stable portal keeps Sonner's timers and announcements intact.
      target.append(host);
      if (
        restore &&
        (document.activeElement === document.body ||
          document.activeElement === focused)
      )
        focused.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(relocate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-modal"]
    });
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !(event.target instanceof Node) ||
        !host.contains(event.target)
      )
        return;
      // Radix handles Escape during document capture, before React bubbling.
      event.preventDefault();
      event.stopPropagation();
      const modal = host.closest<HTMLElement>(MODAL_SELECTOR);
      const previous = returnFocusRef.current;
      if (
        previous?.isConnected &&
        !previous.closest('[inert], [aria-hidden="true"]') &&
        (!modal || modal.contains(previous))
      )
        previous.focus({ preventScroll: true });
      else modal?.focus({ preventScroll: true });
    };
    document.addEventListener("fullscreenchange", relocate);
    window.addEventListener("keydown", handleEscape, { capture: true });
    relocate();
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", relocate);
      window.removeEventListener("keydown", handleEscape, { capture: true });
      host.remove();
    };
  }, [host]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Toast actions are outside the modal's React tree, even after DOM relocation.
    event.stopPropagation();
    const modal = host.closest<HTMLElement>(MODAL_SELECTOR);
    if (event.key !== "Tab" || !modal) return;
    const tabbable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        !element.closest('[inert], [aria-hidden="true"]') &&
        element.getClientRects().length > 0 &&
        window.getComputedStyle(element).visibility !== "hidden"
    );
    const edge = event.shiftKey ? tabbable[0] : tabbable.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? tabbable.at(-1) : tabbable[0])?.focus({
        preventScroll: true
      });
    }
  };

  return createPortal(
    <div
      className="toast-event-boundary"
      role="presentation"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onFocusCapture={(event) => {
        if (
          event.relatedTarget instanceof HTMLElement &&
          !host.contains(event.relatedTarget)
        )
          returnFocusRef.current = event.relatedTarget;
      }}
    >
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        offset={TOAST_OFFSET}
        mobileOffset={TOAST_OFFSET}
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)"
          } as React.CSSProperties
        }
        {...props}
      />
    </div>,
    host
  );
};

export { Toaster };
