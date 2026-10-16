import { useEffect, useRef } from "react";

export function usePageLifecycle(callbacks: {
  onHidden?: () => void;
  onResume?: () => void;
}) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  useEffect(() => {
    let lastResume = 0;
    const resume = () => {
      if (
        document.visibilityState === "hidden" ||
        Date.now() - lastResume < 1000
      )
        return;
      lastResume = Date.now();
      callbacksRef.current.onResume?.();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden")
        callbacksRef.current.onHidden?.();
      else resume();
    };
    const hide = () => callbacksRef.current.onHidden?.();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, []);
}
