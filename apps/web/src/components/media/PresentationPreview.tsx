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
import { observePresentationVideoSeeking } from "./presentation-preview-video";
import { releaseDetachedMedia } from "./detached-media";

interface PresentationPreviewProps extends MediaPresentationPreviewProps {
  asset: AssetRecord;
  capabilities: PresentationMediaCapabilities;
}

export function PresentationPreview({
  asset,
  capabilities,
  presentation,
  playheadMs,
  seekRequest,
  isPlaying,
  muted,
  videoRef,
  onTimeChange,
  onDurationChange,
  onPlayingChange,
  onMutedChange,
  onPlaybackAvailableChange,
  onRetry
}: PresentationPreviewProps) {
  const seeking = useRef<ReturnType<
    typeof observePresentationVideoSeeking
  > | null>(null);
  const appliedSeekRequest = useRef<number | null>(null);
  const [imageError, setImageError] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [observedDuration, setObservedDuration] = useState(0);
  const duration =
    capabilities.durationMs ??
    (observedDuration > 0 ? observedDuration : (asset.durationMs ?? 0));
  const [start, end] = presentationRange(presentation, duration);
  const latest = useRef({ playheadMs, seekRequest, start, end });
  latest.current = { playheadMs, seekRequest, start, end };
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
    const controller = observePresentationVideoSeeking(video);
    seeking.current = controller;
    appliedSeekRequest.current = null;
    return () => {
      controller.dispose();
      if (seeking.current === controller) seeking.current = null;
      releaseDetachedMedia(video);
    };
  }, [videoError, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = presentation.playbackRate;
  }, [presentation.playbackRate, videoError, videoRef]);

  useEffect(() => {
    const controller = seeking.current;
    if (!controller) return;
    const current = latest.current;
    appliedSeekRequest.current = current.seekRequest;
    controller.seek(current.playheadMs);
  }, [seekRequest, videoError, videoRef]);

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
      if (appliedSeekRequest.current !== latest.current.seekRequest) return;
      const time = seeking.current?.readTime();
      if (time !== null && time !== undefined)
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
      const { start, end } = latest.current;
      const time = seeking.current?.readTime();
      if (
        time !== null &&
        time !== undefined &&
        appliedSeekRequest.current === latest.current.seekRequest &&
        end > start &&
        (time >= end - 20 || video.ended)
      ) {
        seeking.current?.seek(start);
        if (video.paused) play();
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
  }, [isPlaying, videoError, videoRef]);

  const style = presentationMediaStyle(presentation, "cover");
  if (imageError)
    return (
      <MediaErrorNotice message="Preview unavailable." onRetry={onRetry} />
    );
  if (capabilities.kind === "animation")
    return (
      <ControlledAnimation
        asset={asset}
        renditionKey={capabilities.renditionKeys.full}
        presentation={presentation}
        highlightsOnly
        active
        controls={false}
        showRetry={Boolean(onRetry)}
        onRetry={onRetry}
        playheadMs={playheadMs}
        seekRequest={seekRequest}
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
        <MediaErrorNotice
          message="Video preview unavailable."
          onRetry={onRetry}
        />
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
          if (!video.isConnected || videoRef.current !== video) return;
          onMutedChange(video.muted || video.volume === 0);
        }}
        onPause={(event) => {
          const video = event.currentTarget;
          if (!video.isConnected || videoRef.current !== video) return;
          if (appliedSeekRequest.current === latest.current.seekRequest) {
            const time = seeking.current?.readTime();
            if (time !== null && time !== undefined)
              callbacks.current.onTimeChange(time);
          }
          // A queued cleanup pause may arrive after playback has restarted.
          if (video.paused && !video.ended)
            callbacks.current.onPlayingChange(false);
        }}
        onError={(event) => {
          if (
            !event.currentTarget.isConnected ||
            videoRef.current !== event.currentTarget
          )
            return;
          setVideoError(true);
          callbacks.current.onPlayingChange(false);
          callbacks.current.onPlaybackAvailableChange(false);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (!video.isConnected || videoRef.current !== video) return;
          callbacks.current.onPlaybackAvailableChange(true);
          if (Number.isFinite(video.duration) && video.duration > 0) {
            setObservedDuration(video.duration * 1000);
            callbacks.current.onDurationChange(video.duration * 1000);
          }
        }}
      />
      {playbackFailed ? (
        <MediaErrorNotice message="Preview couldn’t play. Press Play to retry." />
      ) : null}
    </>
  );
}
