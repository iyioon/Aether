import { hasShortcutModifier } from "../../lib/keyboard";
import { MAX_PRESENTATION_ZOOM, presentationClamp } from "./presentation-model";

type FramingKeyEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing"
>;

export type FramingKeyboardCommand =
  { type: "zoom"; amount: number } | { type: "position"; x: number; y: number };

export function framingKeyboardCommand(
  event: FramingKeyEvent
): FramingKeyboardCommand | null {
  if (event.isComposing || hasShortcutModifier(event)) return null;
  const fine = event.shiftKey || event.key === "_" || event.key === "+";
  const amount = fine ? 0.01 : 0.05;
  if (event.key === "-" || event.key === "_")
    return { type: "zoom", amount: -amount };
  if (event.key === "=" || event.key === "+") return { type: "zoom", amount };
  const movement = event.shiftKey ? 1 : 12;
  switch (event.key) {
    case "ArrowLeft":
      return { type: "position", x: movement, y: 0 };
    case "ArrowRight":
      return { type: "position", x: -movement, y: 0 };
    case "ArrowUp":
      return { type: "position", x: 0, y: movement };
    case "ArrowDown":
      return { type: "position", x: 0, y: -movement };
    default:
      return null;
  }
}

export function zoomAfterKeyboardAdjustment(zoom: number, amount: number) {
  return presentationClamp(
    Math.round((zoom + amount) * 100) / 100,
    1,
    MAX_PRESENTATION_ZOOM
  );
}
