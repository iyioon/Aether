import { useState } from "react";
import type { BounceCodec } from "./presentation-playback";

function preferredCodec(): BounceCodec {
  if (typeof document === "undefined") return "h264";
  const video = document.createElement("video");
  return video.canPlayType('video/mp4; codecs="hvc1.2.4.L153.B0"')
    ? "hevc"
    : "h264";
}

/** Both encodings retain the decoded source pixels; support varies by device. */
export function useBounceCodec(sourceKey: string) {
  const [preferred] = useState(preferredCodec);
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const codec = fallbackKey === sourceKey ? "h264" : preferred;
  return {
    codec,
    tryFallback: () => {
      if (codec !== "hevc") return false;
      setFallbackKey(sourceKey);
      return true;
    }
  };
}
