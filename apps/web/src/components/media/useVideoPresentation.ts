import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import type {
  AssetRecord,
  PresentationMediaCapabilities
} from "../../api/client";
import type { VideoPlayback } from "./useVideoPlayback";
import {
  sourceTimeForPlayback,
  sourceTimeForVideoBounce,
  videoBounceSeekTime,
  type PresentationVariant
} from "./presentation-playback";
import { observeVideoSection, videoSectionTime } from "./video-section";

export function useVideoPresentation(
  videoRef: RefObject<HTMLVideoElement | null>,
  playback: VideoPlayback,
  asset: AssetRecord,
  variant: PresentationVariant,
  enabled = true,
  bounceTimeline?: PresentationMediaCapabilities["bounceTimeline"]
) {
  const rate = enabled ? (asset.presentation?.playbackRate ?? 1) : 1;
  const range = asset.presentation?.highlight;
  const start = variant === "full" ? 0 : (range?.startMs ?? 0) / 1000;
  const end =
    variant === "full"
      ? playback.state.duration
      : range
        ? range.endMs / 1000
        : (asset.durationMs ?? 0) / 1000;
  const [{ isReady, localTimeline }, setState] = useState({
    isReady: false,
    localTimeline: false
  });
  const publishState = useCallback(
    (next: Partial<{ isReady: boolean; localTimeline: boolean }>) => {
      setState((previous) =>
        Object.entries(next).every(
          ([key, value]) => previous[key as keyof typeof previous] === value
        )
          ? previous
          : { ...previous, ...next }
      );
    },
    []
  );
  const sectionBinding = useRef<{
    video: HTMLVideoElement;
    key: string;
    dispose: () => void;
  } | null>(null);
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = rate;
      video.defaultPlaybackRate = rate;
      video.preservesPitch = true;
      if (variant === "bounce") video.muted = true;
    }
    const local = video?.dataset.presentationTimeline === "local";
    publishState({ localTimeline: local });
    const key = `${asset.id}:${video?.getAttribute("src")}:${start}:${end}:${local}`;
    const binding = sectionBinding.current;
    if (variant === "highlight" && video && end > start) {
      if (binding?.video === video && binding.key === key) return;
      binding?.dispose();
      sectionBinding.current = {
        video,
        key,
        dispose: observeVideoSection(
          video,
          { start: local ? 0 : start, end: local ? end - start : end },
          (isReady) => publishState({ isReady })
        )
      };
    } else {
      binding?.dispose();
      sectionBinding.current = null;
      publishState({ isReady: false });
    }
  });
  useLayoutEffect(
    () => () => {
      sectionBinding.current?.dispose();
      sectionBinding.current = null;
    },
    []
  );
  const bounce = variant === "bounce";
  const mapped: VideoPlayback =
    variant === "full"
      ? playback
      : {
          ...playback,
          state: {
            ...playback.state,
            currentTime: bounce
              ? sourceTimeForVideoBounce(
                  playback.state.currentTime,
                  start,
                  end,
                  bounceTimeline
                )
              : localTimeline
                ? sourceTimeForPlayback(
                    playback.state.currentTime,
                    start,
                    end,
                    false
                  )
                : Math.max(start, Math.min(end, playback.state.currentTime)),
            duration: end,
            bufferedEnd: Math.min(
              end,
              (bounce || localTimeline ? start : 0) + playback.state.bufferedEnd
            ),
            muted: bounce || playback.state.muted
          },
          seek: (time) =>
            playback.seek(
              bounce
                ? videoBounceSeekTime(time, start, end, bounceTimeline)
                : localTimeline
                  ? videoSectionTime(time, { start, end }) - start
                  : videoSectionTime(time, { start, end })
            )
        };
  return {
    playback: mapped,
    minimumTime: start,
    sectionLabel:
      variant === "full" ? undefined : bounce ? "Bounce" : "Looping highlight",
    hasAudio: !bounce,
    isReady: variant !== "highlight" || isReady
  };
}
