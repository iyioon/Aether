import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { VideoPlaybackFailure } from "../../api/client";
import { observeVideoPlaybackFailure } from "./video-playback-failure";

export type { VideoPlaybackFailure } from "../../api/client";

export function useVideoPlaybackFailure({
  source,
  enabled = true
}: {
  source: string;
  enabled?: boolean;
}) {
  const [state, setState] = useState<{
    source: string;
    failure: VideoPlaybackFailure | null;
  } | null>(null);
  const binding = useRef<{
    source: string;
    observer: ReturnType<typeof observeVideoPlaybackFailure>;
  } | null>(null);
  useLayoutEffect(() => {
    setState(null);
    if (!enabled || !source) return;
    const observer = observeVideoPlaybackFailure(
      source,
      (failure) => setState({ source, failure }),
      document
    );
    binding.current = { source, observer };
    return () => {
      binding.current = null;
      observer.dispose();
    };
  }, [source, enabled]);
  const diagnose = useCallback(
    (
      video: HTMLVideoElement,
      onDiagnosed?: (failure: VideoPlaybackFailure) => void
    ) => {
      if (enabled && binding.current?.source === source)
        binding.current.observer.diagnose(video, onDiagnosed);
    },
    [source, enabled]
  );
  const clear = useCallback(() => {
    if (binding.current?.source === source) binding.current.observer.clear();
    else setState(null);
  }, [source]);
  return {
    failure: enabled && state?.source === source ? state.failure : null,
    diagnose,
    clear
  };
}
