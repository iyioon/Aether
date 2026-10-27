import { useEffect, useRef, useState } from "react";
import type {
  AssetRecord,
  PresentationMediaCapabilities
} from "../../api/client";
import type { MediaPresentationPreviewProps } from "./MediaPresentationEditor";
import { ControlledAnimation } from "./ControlledAnimation";
import { MediaErrorNotice } from "./MediaErrorNotice";
import { imageDisplayUrl, mediaUrl, thumbnailUrl } from "./media-urls";
import { presentationMediaStyle } from "./presentation-geometry";
import { presentationRange } from "./presentation-model";

interface PresentationPreviewProps extends MediaPresentationPreviewProps {
  asset: AssetRecord;
  capabilities: PresentationMediaCapabilities;
}

export function PresentationPreview({
  asset,
  capabilities,
  presentation,
  playheadMs,
  isPlaying,
  muted,
  videoRef,
  onTimeChange,
  onDurationChange,
  onPlayingChange,
  onMutedChange,
  onPlaybackAvailableChange
}: PresentationPreviewProps) {
  const emittedRef = useRef<number | null>(null);
  const [imageError, setImageError] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [observedDuration, setObservedDuration] = useState(0);
  const duration =
    capabilities.durationMs ?? asset.durationMs ?? observedDuration;
  const [start, end] = presentationRange(presentation, duration);
  const callbacks = useRef({
    onTimeChange,
    onDurationChange,
    onPlayingChange,
    onPlaybackAvailableChange
  });
  callbacks.current = {
    onTimeChange,
    onDurationChange,
    onPlayingChange,
    onPlaybackAvailableChange
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = presentation.playbackRate;
    if (playheadMs !== emittedRef.current) {
      const target = isPlaying
        ? Math.max(start, Math.min(Math.max(start, end - 1), playheadMs))
        : Math.max(0, Math.min(Math.max(0, duration - 1), playheadMs));
      video.currentTime = target / 1000;
    }
  }, [
    playheadMs,
    start,
    end,
    duration,
    isPlaying,
    presentation.playbackRate,
    videoRef
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isPlaying || document.hidden) {
      video.pause();
      return;
    }
    let frame = 0;
    let stopped = false;
    let lastPublish = -Infinity;
    const publish = () => {
      const time = video.currentTime * 1000;
      emittedRef.current = time;
      callbacks.current.onTimeChange(time);
    };
    const play = () => {
      setPlaybackFailed(false);
      void video.play().catch(() => {
        if (!stopped) {
          setPlaybackFailed(true);
          callbacks.current.onPlayingChange(false);
        }
      });
    };
    const tick = (now: number) => {
      if (stopped || document.hidden) return;
      if (
        end > start &&
        (video.currentTime * 1000 >= end - 20 || video.ended)
      ) {
        video.currentTime = start / 1000;
        play();
      }
      if (now - lastPublish >= 125) {
        publish();
        lastPublish = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      stopped = true;
      video.pause();
      cancelAnimationFrame(frame);
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    play();
    frame = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [isPlaying, start, end, presentation.playbackRate, videoError, videoRef]);

  const style = presentationMediaStyle(presentation, "cover");
  if (imageError) return <MediaErrorNotice message="Preview unavailable." />;
  if (capabilities.kind === "animation")
    return (
      <ControlledAnimation
        asset={asset}
        renditionKey={capabilities.renditionKeys.full}
        presentation={presentation}
        highlightsOnly
        active
        controls={false}
        showRetry
        playheadMs={playheadMs}
        isPlaying={isPlaying}
        onTimeChange={onTimeChange}
        onDurationChange={onDurationChange}
        onError={() => {
          onPlayingChange(false);
          onPlaybackAvailableChange(false);
        }}
        onReady={() => onPlaybackAvailableChange(true)}
      />
    );
  if (asset.mediaType === "image")
    return (
      <img
        src={imageDisplayUrl(asset)}
        alt={asset.name}
        draggable={false}
        style={style}
        onError={() => setImageError(true)}
      />
    );
  if (videoError)
    return (
      <>
        <img
          src={thumbnailUrl(asset)}
          alt={asset.name}
          draggable={false}
          style={style}
          onError={() => setImageError(true)}
        />
        <MediaErrorNotice message="Video preview unavailable." />
      </>
    );
  return (
    <>
      <video
        ref={videoRef}
        src={mediaUrl(asset)}
        style={style}
        muted={muted}
        playsInline
        preload="auto"
        aria-label={`Preview ${asset.name}`}
        onVolumeChange={(event) => {
          const video = event.currentTarget;
          onMutedChange(video.muted || video.volume === 0);
        }}
        onPause={(event) => {
          const video = event.currentTarget;
          const time = video.currentTime * 1000;
          emittedRef.current = time;
          callbacks.current.onTimeChange(time);
          // A queued cleanup pause may arrive after playback has restarted.
          if (video.isConnected && video.paused && !video.ended)
            callbacks.current.onPlayingChange(false);
        }}
        onError={() => {
          setVideoError(true);
          callbacks.current.onPlayingChange(false);
          callbacks.current.onPlaybackAvailableChange(false);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration) && video.duration > 0) {
            setObservedDuration(video.duration * 1000);
            callbacks.current.onDurationChange(video.duration * 1000);
          }
          const maximum = Math.max(
            0,
            (Number.isFinite(video.duration)
              ? video.duration * 1000
              : duration) - 1
          );
          const target = isPlaying
            ? Math.max(start, Math.min(Math.max(start, end - 1), playheadMs))
            : Math.max(0, Math.min(maximum, playheadMs));
          video.currentTime = target / 1000;
        }}
      />
      {playbackFailed ? (
        <MediaErrorNotice message="Preview couldn’t play. Press Play to retry." />
      ) : null}
    </>
  );
}
