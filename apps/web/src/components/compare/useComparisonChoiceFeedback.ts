import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChoiceFeedbackState,
  ComparisonDirection
} from "./comparison-types";

const FEEDBACK_VISIBLE_MS = 750;
const FEEDBACK_EXIT_MS = 150;

export function useComparisonChoiceFeedback() {
  const feedbackIdRef = useRef(0);
  const visibleTimerRef = useRef<number | null>(null);
  const removalTimerRef = useRef<number | null>(null);
  const [choiceFeedback, setChoiceFeedback] =
    useState<ChoiceFeedbackState | null>(null);

  const clearTimers = useCallback(() => {
    if (visibleTimerRef.current !== null) {
      window.clearTimeout(visibleTimerRef.current);
      visibleTimerRef.current = null;
    }
    if (removalTimerRef.current !== null) {
      window.clearTimeout(removalTimerRef.current);
      removalTimerRef.current = null;
    }
  }, []);

  const showChoiceFeedback = useCallback(
    (direction: ComparisonDirection) => {
      clearTimers();
      feedbackIdRef.current += 1;
      const feedbackId = feedbackIdRef.current;

      setChoiceFeedback({ direction, id: feedbackId, isExiting: false });
      visibleTimerRef.current = window.setTimeout(() => {
        visibleTimerRef.current = null;
        setChoiceFeedback((current) =>
          current?.id === feedbackId ? { ...current, isExiting: true } : current
        );
        removalTimerRef.current = window.setTimeout(() => {
          removalTimerRef.current = null;
          setChoiceFeedback((current) =>
            current?.id === feedbackId ? null : current
          );
        }, FEEDBACK_EXIT_MS);
      }, FEEDBACK_VISIBLE_MS);
    },
    [clearTimers]
  );

  useEffect(() => clearTimers, [clearTimers]);

  return { choiceFeedback, showChoiceFeedback };
}
