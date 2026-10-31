import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import { observeVideoBuffering } from "./video-buffering";

interface VideoBufferingState {
  sourceKey: string;
  buffering: boolean;
}

export function useVideoBuffering({
  videoRef,
  sourceKey,
  enabled = true
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  enabled?: boolean;
}): boolean {
  const [state, setState] = useState<VideoBufferingState | null>(null);
  const bindingRef = useRef<{
    video: HTMLVideoElement;
    sourceKey: string;
    dispose: () => void;
  } | null>(null);
  const updateState = useCallback((next: VideoBufferingState | null) => {
    setState((previous) =>
      next &&
      previous?.sourceKey === next.sourceKey &&
      previous.buffering === next.buffering
        ? previous
        : next
    );
  }, []);
  // The node can change without a source-key change in conditional media views.
  useLayoutEffect(() => {
    const video = enabled && sourceKey ? videoRef.current : null;
    const binding = bindingRef.current;
    if (binding?.video === video && binding.sourceKey === sourceKey) return;
    binding?.dispose();
    bindingRef.current = null;
    if (!video) {
      updateState(null);
      return;
    }
    const dispose = observeVideoBuffering(video, (buffering) => {
      updateState({ sourceKey, buffering });
    });
    bindingRef.current = { video, sourceKey, dispose };
  });
  useLayoutEffect(
    () => () => {
      bindingRef.current?.dispose();
      bindingRef.current = null;
    },
    []
  );
  return enabled && state?.sourceKey === sourceKey && state.buffering;
}
