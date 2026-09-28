const EDITABLE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']"
].join(", ");

const ACTIVATION_TARGET_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "video",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='slider']"
].join(", ");

const DIRECTIONAL_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "video",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='slider']",
  "[role='radio']",
  "[role='tab']"
].join(", ");

const OPEN_KEYBOARD_LAYER_SELECTOR = [
  "[data-slot='alert-dialog-content'][data-state='open']",
  "[data-slot='dialog-content'][data-state='open']",
  "[data-slot='dropdown-menu-content'][data-state='open']",
  "[data-slot='popover-content'][data-state='open']",
  "[data-slot='sheet-content'][data-state='open']"
].join(", ");

export type FeedKeyboardCommand =
  "first" | "last" | "next" | "open" | "previous" | "toggle-playback";

export type ViewerKeyboardCommand =
  | "decrease-score"
  | "details"
  | "increase-score"
  | "next"
  | "previous"
  | "toggle-playback"
  | "toggle-sound";

export function feedKeyboardCommand(key: string): FeedKeyboardCommand | null {
  switch (key) {
    case "ArrowDown":
    case "PageDown":
      return "next";
    case "ArrowUp":
    case "PageUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Enter":
      return "open";
    case " ":
      return "toggle-playback";
    default:
      return null;
  }
}

export function viewerKeyboardCommand(
  key: string
): ViewerKeyboardCommand | null {
  switch (key) {
    case "ArrowDown":
      return "decrease-score";
    case "ArrowLeft":
      return "previous";
    case "ArrowRight":
      return "next";
    case "ArrowUp":
      return "increase-score";
    case " ":
      return "toggle-playback";
    default: {
      const normalizedKey = key.toLocaleLowerCase("en-US");

      if (normalizedKey === "m") {
        return "toggle-sound";
      }

      if (normalizedKey === "i") {
        return "details";
      }

      return null;
    }
  }
}

export function scoreAfterKeyboardAdjustment(
  score: number,
  direction: -1 | 1
): number {
  return Math.max(0, score + direction);
}

export function hasShortcutModifier(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">
): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return targetMatches(target, EDITABLE_TARGET_SELECTOR);
}

export function isKeyboardActivationTarget(
  target: EventTarget | null
): boolean {
  return targetMatches(target, ACTIVATION_TARGET_SELECTOR);
}

export function isDirectionalKeyboardTarget(
  target: EventTarget | null
): boolean {
  return targetMatches(target, DIRECTIONAL_TARGET_SELECTOR);
}

export function hasOpenKeyboardLayer(root: ParentNode = document): boolean {
  return Boolean(root.querySelector(OPEN_KEYBOARD_LAYER_SELECTOR));
}

function targetMatches(target: EventTarget | null, selector: string): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    Boolean(target.closest(selector))
  );
}
