import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  EMPTY_VIDEO_PLAYBACK_STATE,
  observeVideoPlayback,
  type VideoPlaybackCommands,
  type VideoPlaybackState
} from "./video-playback";

interface VideoPlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  enabled?: boolean;
}

export interface VideoPlayback extends VideoPlaybackCommands {
  state: VideoPlaybackState;
}

export function useVideoPlayback({
  videoRef,
  sourceKey,
  enabled = true
}: VideoPlaybackOptions): VideoPlayback {
  const [state, setState] = useState(EMPTY_VIDEO_PLAYBACK_STATE);
  const bindingRef = useRef<{
    video: HTMLVideoElement;
    sourceKey: string;
    commands: ReturnType<typeof observeVideoPlayback>;
  } | null>(null);

  const updateState = useCallback((next: VideoPlaybackState) => {
    setState((previous) =>
      Object.keys(next).every(
        (key) =>
          previous[key as keyof VideoPlaybackState] ===
          next[key as keyof VideoPlaybackState]
      )
        ? previous
        : next
    );
  }, []);

  // Check the actual node after every commit, including conditional replacements.
  useLayoutEffect(() => {
    const video = enabled ? videoRef.current : null;
    const binding = bindingRef.current;

    if (binding?.video === video && binding.sourceKey === sourceKey) {
      return;
    }

    binding?.commands.dispose();
    bindingRef.current = null;

    if (!video) {
      updateState(EMPTY_VIDEO_PLAYBACK_STATE);
      return;
    }

    const commands = observeVideoPlayback(video, updateState);
    bindingRef.current = { video, sourceKey, commands };
  });

  useLayoutEffect(
    () => () => {
      bindingRef.current?.commands.dispose();
      bindingRef.current = null;
    },
    []
  );

  const togglePlayback = useCallback(() => {
    return bindingRef.current?.commands.togglePlayback() ?? null;
  }, []);
  const toggleMuted = useCallback(() => {
    bindingRef.current?.commands.toggleMuted();
  }, []);
  const seek = useCallback((time: number) => {
    bindingRef.current?.commands.seek(time);
  }, []);

  return { state, togglePlayback, toggleMuted, seek };
}
