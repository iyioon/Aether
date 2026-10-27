export const PRESENTATION_TIMING_KEYBOARD_HINT =
  "Arrows: 0.1s · Shift: 1ms · Page Up/Down: 1s · Home/End: limits.";

interface TimingKeyboardInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}

export function isModifiedPresentationTimingKey(
  event: TimingKeyboardInput
): boolean {
  return Boolean(
    (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) &&
    [
      "ArrowRight",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End"
    ].includes(event.key)
  );
}

export function presentationTimingKeyTarget(
  event: TimingKeyboardInput,
  currentMs: number,
  minimumMs: number,
  maximumMs: number
): number | null {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    ![currentMs, minimumMs, maximumMs].every(Number.isFinite) ||
    minimumMs < 0 ||
    maximumMs < minimumMs
  )
    return null;

  const arrowStep = event.shiftKey ? 1 : 100;
  let target: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      target = currentMs + arrowStep;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      target = currentMs - arrowStep;
      break;
    case "PageUp":
      target = currentMs + 1000;
      break;
    case "PageDown":
      target = currentMs - 1000;
      break;
    case "Home":
      target = minimumMs;
      break;
    case "End":
      target = maximumMs;
      break;
    default:
      return null;
  }
  return Math.max(minimumMs, Math.min(maximumMs, target));
}
