import { useLayoutEffect, type RefObject } from "react";
import type { AssetRecord } from "../../api/client";
import type { VideoPlayback } from "./useVideoPlayback";
import {
  sourceTimeForPlayback,
  sourceTimeForVideoBounce,
  videoBounceSeekTime,
  type PresentationVariant
} from "./presentation-playback";

export function useVideoPresentation(
  videoRef: RefObject<HTMLVideoElement | null>,
  playback: VideoPlayback,
  asset: AssetRecord,
  variant: PresentationVariant,
  enabled = true
) {
  const rate = enabled ? (asset.presentation?.playbackRate ?? 1) : 1;
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = rate;
      video.defaultPlaybackRate = rate;
      video.preservesPitch = true;
      if (variant === "bounce") video.muted = true;
    }
  });
  const range = asset.presentation?.highlight;
  const start = variant === "full" ? 0 : (range?.startMs ?? 0) / 1000;
  const end =
    variant === "full"
      ? playback.state.duration
      : range
        ? range.endMs / 1000
        : (asset.durationMs ?? (playback.state.duration + 2 / 24) * 500) / 1000;
  const bounce = variant === "bounce";
  const mapped: VideoPlayback =
    variant === "full"
      ? playback
      : {
          ...playback,
          state: {
            ...playback.state,
            currentTime: bounce
              ? sourceTimeForVideoBounce(playback.state.currentTime, start, end)
              : sourceTimeForPlayback(
                  playback.state.currentTime,
                  start,
                  end,
                  false
                ),
            duration: end,
            bufferedEnd: Math.min(end, start + playback.state.bufferedEnd),
            muted: bounce || playback.state.muted
          },
          seek: (time) =>
            playback.seek(
              bounce
                ? videoBounceSeekTime(time, start, end)
                : Math.max(0, Math.min(end - start, time - start))
            )
        };
  return {
    playback: mapped,
    minimumTime: start,
    sectionLabel:
      variant === "full" ? undefined : bounce ? "Bounce" : "Looping highlight",
    hasAudio: !bounce
  };
}
