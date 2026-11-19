import { useEffect, useRef, type RefObject } from "react";
import {
  hasShortcutModifier,
  isDirectionalKeyboardTarget,
  isEditableKeyboardTarget,
  isKeyboardActivationTarget
} from "../../lib/keyboard";
import { presentationTimingKeyTarget } from "./presentation-timing-keyboard";

interface PreviewKeyboardControls {
  enabled: boolean;
  playbackTab: boolean;
  isPlaying: boolean;
  playheadMs: number;
  durationMs: number;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (time: number) => void;
}

export function usePresentationPreviewKeyboard(
  bodyRef: RefObject<HTMLDivElement | null>,
  controls: PreviewKeyboardControls
) {
  const currentRef = useRef(controls);
  currentRef.current = controls;
  useEffect(() => {
    const editor = bodyRef.current?.closest('[role="dialog"]');
    if (!editor) return;
    const keydown = (event: Event) => {
      if (
        !(event instanceof KeyboardEvent) ||
        event.defaultPrevented ||
        event.isComposing ||
        hasShortcutModifier(event) ||
        !(event.target instanceof Element) ||
        !editor.contains(editor.ownerDocument.activeElement)
      )
        return;
      const target = event.target;
      const current = currentRef.current;
      if (
        !current.enabled ||
        isEditableKeyboardTarget(target) ||
        target.closest(
          '[role="combobox"], [role="listbox"], [role="menu"], [role="radiogroup"]'
        )
      )
        return;
      if (event.key === " ") {
        if (
          isKeyboardActivationTarget(target) &&
          !target.closest('[role="slider"]')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        current.isPlaying = !current.isPlaying;
        current.onPlayingChange(current.isPlaying);
      } else if (
        current.playbackTab &&
        ["ArrowLeft", "ArrowRight"].includes(event.key) &&
        !isDirectionalKeyboardTarget(target)
      ) {
        const time = presentationTimingKeyTarget(
          event,
          current.playheadMs,
          0,
          current.durationMs
        );
        if (time === null) return;
        event.preventDefault();
        event.stopPropagation();
        current.playheadMs = time;
        current.isPlaying = false;
        current.onSeek(time);
      }
    };
    editor.addEventListener("keydown", keydown);
    return () => editor.removeEventListener("keydown", keydown);
  }, [bodyRef]);
}
