import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

const INITIAL_REPEAT_DELAY_MS = 420;
const REPEAT_INTERVAL_MS = 120;
const FAST_REPEAT_INTERVAL_MS = 70;
const FAST_REPEAT_AFTER_MS = 1_200;

interface UsePressRepeatOptions {
  disabled?: boolean;
  onPress: () => void;
  onRepeat?: () => void;
  onRepeatEnd?: () => void;
}

export function usePressRepeat({
  disabled = false,
  onPress,
  onRepeat = onPress,
  onRepeatEnd
}: UsePressRepeatOptions) {
  const disabledRef = useRef(disabled);
  const isPressingRef = useRef(false);
  const isRepeatingRef = useRef(false);
  const onPressRef = useRef(onPress);
  const onRepeatRef = useRef(onRepeat);
  const onRepeatEndRef = useRef(onRepeatEnd);
  const pressStartedAtRef = useRef(0);
  const suppressPointerClickRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  disabledRef.current = disabled;
  onPressRef.current = onPress;
  onRepeatRef.current = onRepeat;
  onRepeatEndRef.current = onRepeatEnd;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopPress = useCallback(() => {
    if (!isPressingRef.current) {
      return;
    }

    isPressingRef.current = false;
    clearTimer();

    if (isRepeatingRef.current) {
      isRepeatingRef.current = false;
      suppressPointerClickRef.current = true;
      onRepeatEndRef.current?.();
    }
  }, [clearTimer]);

  const runRepeat = useCallback(function repeat() {
    if (!isPressingRef.current || disabledRef.current) {
      return;
    }

    isRepeatingRef.current = true;
    suppressPointerClickRef.current = true;
    onRepeatRef.current();

    const heldForMs = window.performance.now() - pressStartedAtRef.current;
    const interval =
      heldForMs >= FAST_REPEAT_AFTER_MS
        ? FAST_REPEAT_INTERVAL_MS
        : REPEAT_INTERVAL_MS;
    timerRef.current = window.setTimeout(repeat, interval);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (
        disabledRef.current ||
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) {
        return;
      }

      clearTimer();
      isPressingRef.current = true;
      isRepeatingRef.current = false;
      suppressPointerClickRef.current = false;
      pressStartedAtRef.current = window.performance.now();
      timerRef.current = window.setTimeout(
        runRepeat,
        INITIAL_REPEAT_DELAY_MS
      );
    },
    [clearTimer, runRepeat]
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (disabledRef.current) {
        return;
      }

      if (event.detail > 0 && suppressPointerClickRef.current) {
        suppressPointerClickRef.current = false;
        event.preventDefault();
        return;
      }

      suppressPointerClickRef.current = false;
      onPressRef.current();
    },
    []
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (isPressingRef.current || suppressPointerClickRef.current) {
        event.preventDefault();
      }
    },
    []
  );

  useEffect(() => {
    if (disabled) {
      stopPress();
    }
  }, [disabled, stopPress]);

  useEffect(
    () => () => {
      isPressingRef.current = false;
      clearTimer();
    },
    [clearTimer]
  );

  return {
    onBlur: stopPress,
    onClick: handleClick,
    onContextMenu: handleContextMenu,
    onPointerCancel: stopPress,
    onPointerDown: handlePointerDown,
    onPointerLeave: stopPress,
    onPointerUp: stopPress
  };
}
