import { useEffect, useRef } from "react";
import { preloadVideoRange } from "./video-range-preload";

/** One bounded request for the eligible next Feed video; never a media element. */
export function useVideoRangePreload(source: string, enabled: boolean) {
  const preparedSource = useRef("");
  useEffect(() => {
    if (!enabled || !source || preparedSource.current === source) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const timer = window.setTimeout(cancel, 4_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", cancel);
    void preloadVideoRange(source, controller.signal).then((ready) => {
      if (ready && !controller.signal.aborted) preparedSource.current = source;
    });
    return () => {
      cancel();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", cancel);
    };
  }, [source, enabled]);
}
