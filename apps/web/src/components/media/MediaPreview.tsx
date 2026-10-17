import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Image, Video } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { isMediaImageReady, markMediaImageReady } from "./media-image-cache";
import {
  isAnimatedImagePreview,
  mediaUrl,
  thumbnailUrl,
  videoPreviewUrl
} from "./media-urls";
import { requestPresentedVideoFrame } from "./video-frame-presentation";
import { useVideoPlayback } from "./useVideoPlayback";
import { VideoControls } from "./VideoControls";

const VIDEO_HOLD_DELAY_MS = 320;

export interface MediaPlaybackCommands {
  togglePlayback: () => void;
  enableSound: () => void;
}

interface MediaPreviewProps {
  asset: AssetRecord;
  isActive?: boolean;
  muted?: boolean;
  onAudibleAutoplayBlocked?: () => void;
  onAudiblePlaybackStarted?: () => void;
  onDimensionsKnown?: (assetId: string, width: number, height: number) => void;
  onExpand?: () => void;
  onToggleMuted?: () => void;
  onVideoControlsReady?: (
    assetId: string,
    commands: MediaPlaybackCommands | null
  ) => void;
  onVideoPress?: () => void;
  playbackPaused?: boolean;
  preloadPreview?: boolean;
  showVideoTimeline?: boolean;
  staticPreview?: boolean;
  tall?: boolean;
  thumbnailSize?: number;
  useOriginalImage?: boolean;
  useOriginalVideo?: boolean;
}

export const MediaPreview = memo(function MediaPreview({
  asset,
  isActive = true,
  muted = true,
  onAudibleAutoplayBlocked,
  onAudiblePlaybackStarted,
  onDimensionsKnown,
  onExpand,
  onToggleMuted,
  onVideoControlsReady,
  onVideoPress,
  playbackPaused = false,
  preloadPreview = false,
  showVideoTimeline = false,
  staticPreview = false,
  tall = false,
  thumbnailSize = 640,
  useOriginalImage = false,
  useOriginalVideo = false
}: MediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const videoPlaybackRequestSequenceRef = useRef(0);
  const videoFrameRequestSequenceRef = useRef(0);
  const cancelVideoRevealRef = useRef<(() => void) | null>(null);
  const shouldAutoplayVideoRef = useRef(false);
  const videoSourceRef = useRef("");
  const userPausedRef = useRef(false);
  const isAnimatedImage = !staticPreview && isAnimatedImagePreview(asset);
  const [hasError, setHasError] = useState(false);
  const [animatedImageFailed, setAnimatedImageFailed] = useState(false);
  const [originalImageFailed, setOriginalImageFailed] = useState(false);
  const [originalVideoFailed, setOriginalVideoFailed] = useState(false);
  const [videoPreviewFailed, setVideoPreviewFailed] = useState(false);
  const [videoPlaybackFailed, setVideoPlaybackFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [readyVideoSource, setReadyVideoSource] = useState<string | null>(null);
  const [isVideoHoldPaused, setIsVideoHoldPaused] = useState(false);
  const [isVideoUserPaused, setIsVideoUserPaused] = useState(false);
  const [isVideoResumePaused, setIsVideoResumePaused] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(
    () => document.visibilityState === "hidden"
  );
  const [loadedVideoPosterSource, setLoadedVideoPosterSource] = useState<
    string | null
  >(null);
  const [failedVideoPosterSource, setFailedVideoPosterSource] = useState<
    string | null
  >(null);
  const [loadedImageSource, setLoadedImageSource] = useState<string | null>(
    null
  );
  const [loadedThumbnailSource, setLoadedThumbnailSource] = useState<
    string | null
  >(null);
  const posterSource = thumbnailUrl(asset.id, thumbnailSize);
  const videoSource =
    asset.mediaType === "video"
      ? useOriginalVideo
        ? originalVideoFailed
          ? videoPreviewUrl(asset.id, tall ? 720 : 480)
          : mediaUrl(asset.id)
        : videoPreviewFailed
          ? mediaUrl(asset.id)
          : videoPreviewUrl(asset.id, tall ? 720 : 480)
      : "";

  const isVideoPlaybackVisible = isVisible || (showVideoTimeline && isActive);
  const shouldLoadVideo =
    asset.mediaType === "video" &&
    !staticPreview &&
    (isVideoPlaybackVisible || preloadPreview);
  const isVideoPlaybackAllowed =
    asset.mediaType === "video" &&
    !staticPreview &&
    isActive &&
    isVideoPlaybackVisible &&
    !playbackPaused &&
    !isPageHidden;
  const shouldAutoplayVideo =
    isVideoPlaybackAllowed &&
    !isVideoHoldPaused &&
    !isVideoUserPaused &&
    !isVideoResumePaused;
  shouldAutoplayVideoRef.current = shouldAutoplayVideo;
  videoSourceRef.current = videoSource;
  const playback = useVideoPlayback({
    videoRef,
    sourceKey: shouldLoadVideo ? videoSource : "",
    enabled: asset.mediaType === "video" && showVideoTimeline && !staticPreview
  });
  const isVideoReady = readyVideoSource === videoSource;
  const isVideoPosterReady =
    loadedVideoPosterSource === posterSource || isMediaImageReady(posterSource);
  const didVideoPosterFail = failedVideoPosterSource === posterSource;

  const playVisibleVideo = useCallback(
    (requestedMuted = muted) => {
      if (!shouldAutoplayVideoRef.current) {
        return;
      }

      const video = videoRef.current;

      if (!video) {
        return;
      }

      const requestedSource = videoSourceRef.current;
      const requestSequence = ++videoPlaybackRequestSequenceRef.current;
      const isCurrentRequest = () =>
        videoPlaybackRequestSequenceRef.current === requestSequence &&
        videoRef.current === video &&
        videoSourceRef.current === requestedSource &&
        shouldAutoplayVideoRef.current;

      video.muted = requestedMuted;
      if (!requestedMuted && video.volume === 0) {
        video.volume = 1;
      }
      video
        .play()
        .then(() => {
          if (!isCurrentRequest()) {
            if (!shouldAutoplayVideoRef.current || videoRef.current !== video) {
              video.pause();
            }
            return;
          }
          if (!requestedMuted && !video.muted) {
            onAudiblePlaybackStarted?.();
          }
        })
        .catch(() => {
          if (requestedMuted || !isCurrentRequest()) {
            return;
          }

          video.muted = true;
          onAudibleAutoplayBlocked?.();
          video
            .play()
            .then(() => {
              if (
                !shouldAutoplayVideoRef.current ||
                videoRef.current !== video
              ) {
                video.pause();
              }
            })
            .catch(() => undefined);
        });
    },
    [muted, onAudibleAutoplayBlocked, onAudiblePlaybackStarted]
  );

  const cancelPendingVideoReveal = useCallback(() => {
    cancelVideoRevealRef.current?.();
    cancelVideoRevealRef.current = null;
  }, []);

  const revealVideoAfterPresentedFrame = useCallback(
    (video: HTMLVideoElement) => {
      cancelPendingVideoReveal();
      const requestSequence = videoFrameRequestSequenceRef.current + 1;
      videoFrameRequestSequenceRef.current = requestSequence;

      const reveal = () => {
        cancelVideoRevealRef.current = null;
        if (
          videoFrameRequestSequenceRef.current === requestSequence &&
          videoRef.current === video
        ) {
          setReadyVideoSource(videoSource);
        }
      };

      cancelVideoRevealRef.current = requestPresentedVideoFrame(video, reveal);
    },
    [cancelPendingVideoReveal, videoSource]
  );

  useEffect(
    () => () => {
      cancelPendingVideoReveal();
    },
    [cancelPendingVideoReveal]
  );

  useEffect(() => {
    cancelPendingVideoReveal();
    videoFrameRequestSequenceRef.current += 1;
    setReadyVideoSource(null);
  }, [cancelPendingVideoReveal, videoSource]);

  useEffect(() => {
    setHasError(false);
    setAnimatedImageFailed(false);
    setOriginalImageFailed(false);
    setOriginalVideoFailed(false);
    setVideoPreviewFailed(false);
    setVideoPlaybackFailed(false);
    setIsVisible(false);
    setReadyVideoSource(null);
    setIsVideoHoldPaused(false);
    setIsVideoUserPaused(false);
    userPausedRef.current = false;
    setIsVideoResumePaused(false);
    setLoadedVideoPosterSource(null);
    setFailedVideoPosterSource(null);
    setLoadedImageSource(null);
    setLoadedThumbnailSource(null);
    cancelPendingVideoReveal();
    videoFrameRequestSequenceRef.current += 1;
  }, [
    asset.id,
    cancelPendingVideoReveal,
    isAnimatedImage,
    tall,
    thumbnailSize,
    staticPreview
  ]);

  useEffect(() => {
    if (!isActive) {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      holdTriggeredRef.current = false;
      setIsVideoHoldPaused(false);
    }
  }, [isActive]);

  useEffect(() => {
    if (asset.mediaType !== "video" || staticPreview) return;

    const hide = () => {
      shouldAutoplayVideoRef.current = false;
      videoPlaybackRequestSequenceRef.current += 1;
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      holdTriggeredRef.current = false;
      setIsVideoHoldPaused(false);
      const video = videoRef.current;
      if (video && !video.muted) {
        setIsVideoResumePaused(true);
      }
      video?.pause();
      setIsPageHidden(true);
    };
    const resume = () => {
      if (document.visibilityState !== "hidden") setIsPageHidden(false);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
      else resume();
    };

    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", resume);
    };
  }, [asset.mediaType, staticPreview]);

  useEffect(
    () => () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (
      (asset.mediaType === "video" && staticPreview) ||
      (asset.mediaType !== "video" && !isAnimatedImage)
    ) {
      return;
    }

    const previewElement =
      asset.mediaType === "video" ? videoRef.current : imageRef.current;
    const video = videoRef.current;

    if (!previewElement) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];

        if (!firstEntry) {
          return;
        }

        setIsVisible(firstEntry.isIntersecting);
      },
      asset.mediaType === "video"
        ? { threshold: 0.45 }
        : { rootMargin: "180px 0px", threshold: 0.01 }
    );

    observer.observe(previewElement);

    return () => {
      observer.disconnect();

      if (asset.mediaType === "video") {
        video?.pause();
      }
    };
  }, [asset.id, asset.mediaType, isAnimatedImage, staticPreview]);

  useEffect(() => {
    if (asset.mediaType !== "video") {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (shouldAutoplayVideo) {
      playVisibleVideo();
    } else {
      videoPlaybackRequestSequenceRef.current += 1;
      video.pause();
    }
  }, [asset.id, asset.mediaType, playVisibleVideo, shouldAutoplayVideo]);

  const toggleVideoPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isVideoPlaybackAllowed) return;

    if (!video.paused) {
      userPausedRef.current = true;
      shouldAutoplayVideoRef.current = false;
      videoPlaybackRequestSequenceRef.current += 1;
      setIsVideoUserPaused(true);
      video.pause();
      return;
    }

    userPausedRef.current = false;
    setIsVideoUserPaused(false);
    setIsVideoResumePaused(false);
    shouldAutoplayVideoRef.current = !isVideoHoldPaused;
    playVisibleVideo();
  }, [isVideoHoldPaused, isVideoPlaybackAllowed, playVisibleVideo]);

  const enableVideoSound = useCallback(() => {
    if (!isVideoPlaybackAllowed || userPausedRef.current || isVideoHoldPaused) {
      return;
    }

    setIsVideoResumePaused(false);
    shouldAutoplayVideoRef.current = true;
    playVisibleVideo(false);
  }, [isVideoHoldPaused, isVideoPlaybackAllowed, playVisibleVideo]);

  useEffect(() => {
    if (!showVideoTimeline || !onVideoControlsReady) return;

    onVideoControlsReady(asset.id, {
      togglePlayback: toggleVideoPlayback,
      enableSound: enableVideoSound
    });
    return () => onVideoControlsReady(asset.id, null);
  }, [
    asset.id,
    enableVideoSound,
    onVideoControlsReady,
    showVideoTimeline,
    toggleVideoPlayback
  ]);

  const startVideoHold = useCallback(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    holdTriggeredRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      holdTriggeredRef.current = true;
      shouldAutoplayVideoRef.current = false;
      videoPlaybackRequestSequenceRef.current += 1;
      video.pause();
      setIsVideoHoldPaused(true);
    }, VIDEO_HOLD_DELAY_MS);
  }, []);

  const resumeVideoAfterHold = useCallback(() => {
    if (
      !isVideoPlaybackAllowed ||
      userPausedRef.current ||
      isVideoResumePaused
    ) {
      return;
    }
    shouldAutoplayVideoRef.current = true;
    playVisibleVideo();
  }, [isVideoPlaybackAllowed, isVideoResumePaused, playVisibleVideo]);

  const finishVideoHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (!holdTriggeredRef.current) {
      onVideoPress?.();
      return;
    }

    holdTriggeredRef.current = false;
    setIsVideoHoldPaused(false);
    resumeVideoAfterHold();
  }, [onVideoPress, resumeVideoAfterHold]);

  const cancelVideoHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (!holdTriggeredRef.current) {
      return;
    }

    holdTriggeredRef.current = false;
    setIsVideoHoldPaused(false);
    resumeVideoAfterHold();
  }, [resumeVideoAfterHold]);

  useEffect(() => {
    if (asset.mediaType !== "video" || !preloadPreview || isVisible) {
      return;
    }

    videoRef.current?.load();
  }, [asset.id, asset.mediaType, isVisible, preloadPreview, videoSource]);

  useEffect(() => {
    if (asset.mediaType === "video" && !shouldLoadVideo) {
      cancelPendingVideoReveal();
      videoFrameRequestSequenceRef.current += 1;
      setReadyVideoSource(null);
    }
  }, [asset.mediaType, cancelPendingVideoReveal, shouldLoadVideo]);

  if (
    hasError ||
    (asset.mediaType === "video" &&
      (videoPlaybackFailed || staticPreview) &&
      didVideoPosterFail)
  ) {
    return (
      <div className={tall ? "media-placeholder tall" : "media-placeholder"}>
        {asset.mediaType === "video" ? (
          <Video size={30} />
        ) : (
          <Image size={30} />
        )}
      </div>
    );
  }

  if (asset.mediaType === "image") {
    const originalSource = mediaUrl(asset.id);
    const shouldUseOriginalImage =
      (useOriginalImage && !originalImageFailed) ||
      (isAnimatedImage && isVisible && !animatedImageFailed);
    const isProgressiveImage = shouldUseOriginalImage;
    const previewSource = shouldUseOriginalImage
      ? originalSource
      : thumbnailUrl(asset.id, thumbnailSize);
    const isImageReady =
      loadedImageSource === previewSource ||
      (!shouldUseOriginalImage && isMediaImageReady(previewSource));
    const isThumbnailReady =
      isProgressiveImage &&
      (loadedThumbnailSource === posterSource ||
        isMediaImageReady(posterSource));

    return (
      <span
        className={[
          "media-image-shell",
          tall ? "tall" : "",
          isProgressiveImage ? "progressive" : "",
          isThumbnailReady ? "thumbnail-ready" : "",
          isImageReady ? "ready" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="media-image-loading" aria-hidden="true" />
        {isProgressiveImage ? (
          <img
            aria-hidden="true"
            className={
              tall
                ? "media-image media-image-thumbnail tall"
                : "media-image media-image-thumbnail"
            }
            src={posterSource}
            alt=""
            decoding="async"
            fetchPriority={isActive ? "high" : "auto"}
            loading={isActive ? "eager" : "lazy"}
            onLoad={(event) => {
              const image = event.currentTarget;
              void image.decode().then(
                () => {
                  markMediaImageReady(posterSource);
                  setLoadedThumbnailSource(posterSource);
                },
                () => setLoadedThumbnailSource(posterSource)
              );
            }}
          />
        ) : null}
        <img
          ref={imageRef}
          className={[
            "media-image",
            isProgressiveImage ? "media-image-original" : "",
            tall ? "tall" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          src={previewSource}
          alt={asset.name}
          data-preview-source={
            shouldUseOriginalImage ? "original" : "thumbnail"
          }
          loading={
            (useOriginalImage && isActive) || (isAnimatedImage && isVisible)
              ? "eager"
              : "lazy"
          }
          decoding="async"
          fetchPriority={useOriginalImage && isActive ? "high" : "auto"}
          onLoad={(event) => {
            const image = event.currentTarget;
            void image.decode().then(
              () => {
                markMediaImageReady(previewSource);
                setLoadedImageSource(previewSource);
                onDimensionsKnown?.(
                  asset.id,
                  image.naturalWidth,
                  image.naturalHeight
                );
              },
              () => {
                setLoadedImageSource(previewSource);
                onDimensionsKnown?.(
                  asset.id,
                  image.naturalWidth,
                  image.naturalHeight
                );
              }
            );
          }}
          onError={() => {
            if (useOriginalImage && !originalImageFailed) {
              setOriginalImageFailed(true);
              setAnimatedImageFailed(true);
              return;
            }

            if (isAnimatedImage && isVisible && !animatedImageFailed) {
              setAnimatedImageFailed(true);
              return;
            }

            setHasError(true);
          }}
        />
      </span>
    );
  }

  return (
    <span
      className={[
        "media-video-shell",
        tall ? "tall" : "",
        isVideoPosterReady ? "poster-ready" : "",
        didVideoPosterFail ? "poster-error" : "",
        isVideoReady ? "ready" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="media-video-loading" aria-hidden="true" />
      <img
        className="media-video-poster"
        src={posterSource}
        alt=""
        aria-hidden="true"
        loading={tall || preloadPreview ? "eager" : "lazy"}
        fetchPriority={isActive ? "high" : "auto"}
        decoding="async"
        onLoad={(event) => {
          const image = event.currentTarget;
          void image.decode().then(
            () => {
              markMediaImageReady(posterSource);
              setLoadedVideoPosterSource(posterSource);
            },
            () => setLoadedVideoPosterSource(posterSource)
          );
        }}
        onError={() => setFailedVideoPosterSource(posterSource)}
      />
      {!staticPreview ? (
        <video
          ref={videoRef}
          className={tall ? "media-video tall" : "media-video"}
          src={shouldLoadVideo ? videoSource : undefined}
          autoPlay={shouldAutoplayVideo}
          data-preview-source={
            shouldLoadVideo
              ? useOriginalVideo
                ? originalVideoFailed
                  ? "preview-fallback"
                  : "original"
                : videoPreviewFailed
                  ? "original"
                  : "preview"
              : "poster"
          }
          muted={muted}
          loop
          playsInline
          preload={
            shouldLoadVideo ? (preloadPreview ? "auto" : "metadata") : "none"
          }
          onLoadStart={() => {
            cancelPendingVideoReveal();
            videoFrameRequestSequenceRef.current += 1;
            setReadyVideoSource(null);
          }}
          onLoadedMetadata={(event) => {
            onDimensionsKnown?.(
              asset.id,
              event.currentTarget.videoWidth,
              event.currentTarget.videoHeight
            );
          }}
          onLoadedData={() => {
            if (shouldAutoplayVideo) {
              playVisibleVideo();
            }
          }}
          onPlaying={(event) => {
            if (shouldAutoplayVideo) {
              revealVideoAfterPresentedFrame(event.currentTarget);
            }
          }}
          onSeeked={(event) => {
            if (isVideoPlaybackAllowed) {
              revealVideoAfterPresentedFrame(event.currentTarget);
            }
          }}
          onError={() => {
            cancelPendingVideoReveal();
            videoFrameRequestSequenceRef.current += 1;
            setReadyVideoSource(null);

            if (useOriginalVideo && !originalVideoFailed) {
              setOriginalVideoFailed(true);
              return;
            }

            if (!useOriginalVideo && !videoPreviewFailed) {
              setVideoPreviewFailed(true);
              return;
            }

            setVideoPlaybackFailed(true);
          }}
        />
      ) : null}
      {showVideoTimeline && !staticPreview ? (
        <>
          <button
            className="media-video-playback-toggle"
            type="button"
            aria-label={`Toggle controls for ${asset.name}; press and hold to pause`}
            onClick={(event) => {
              event.stopPropagation();

              if (event.detail === 0) {
                onVideoPress?.();
              }
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              startVideoHold();
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              finishVideoHold();
            }}
            onPointerCancel={cancelVideoHold}
            onLostPointerCapture={cancelVideoHold}
          />
          <VideoControls
            className="video-controls--feed"
            playback={playback}
            seekLabel={`Seek ${asset.name}`}
            onTogglePlayback={toggleVideoPlayback}
            onToggleMuted={onToggleMuted}
            onExpand={onExpand}
            expandLabel={`Open ${asset.name} in viewer`}
          />
        </>
      ) : null}
    </span>
  );
});
