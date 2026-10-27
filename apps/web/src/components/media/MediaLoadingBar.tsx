import { useEffect, useState } from "react";
import { Progress } from "../ui/progress";

/** Media preparation has no reliable percentage until decoding completes. */
export function MediaLoadingBar() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const hide = () => setHidden(true);
    const resume = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", resume);
    };
  }, []);
  return hidden ? null : (
    <Progress
      value={null}
      className="media-loading-bar"
      aria-label="Loading media"
    />
  );
}
