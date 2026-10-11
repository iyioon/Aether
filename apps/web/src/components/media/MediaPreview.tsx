import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Image, Video } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { markMediaImageReady } from "./media-image-cache";
import { mediaUrl, thumbnailUrl, videoPreviewUrl } from "./media-urls";
import { requestPresentedVideoFrame } from "./video-frame-presentation";

const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".avif", ".apng"]);
const VIDEO_HOLD_DELAY_MS = 320;

interface MediaPreviewProps {
  asset: AssetRecord;
  audiblePlaybackRequest?: number;
  isActive?: boolean;
  muted?: boolean;
  onAudibleAutoplayBlocked?: () => void;
  onAudiblePlaybackStarted?: () => void;
  onDimensionsKnown?: (assetId: string, width: number, height: number) => void;
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
  audiblePlaybackRequest = 0,
  isActive = true,
  muted = true,
  onAudibleAutoplayBlocked,
  onAudiblePlaybackStarted,
  onDimensionsKnown,
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
  const videoFrameRequestSequenceRef = useRef(0);
  const cancelVideoRevealRef = useRef<(() => void) | null>(null);
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
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
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

  const isVideoPlaybackVisible =
    isVisible || (showVideoTimeline && isActive);
  const shouldLoadVideo =
    asset.mediaType === "video" &&
    !staticPreview &&
    (isVideoPlaybackVisible || preloadPreview);
  const shouldAutoplayVideo =
    asset.mediaType === "video" &&
    !staticPreview &&
    isActive &&
    isVideoPlaybackVisible &&
    !playbackPaused &&
    !isVideoHoldPaused;
  const isVideoReady = readyVideoSource === videoSource;
  const isVideoPosterReady = loadedVideoPosterSource === posterSource;
  const didVideoPosterFail = failedVideoPosterSource === posterSource;

  const playVisibleVideo = useCallback(() => {
    if (!shouldAutoplayVideo) {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.muted = muted;
    video
      .play()
      .then(() => {
        if (!muted && !video.muted) {
          onAudiblePlaybackStarted?.();
        }
      })
      .catch(() => {
        if (muted) {
          return;
        }

        video.muted = true;
        onAudibleAutoplayBlocked?.();
        video.play().catch(() => undefined);
      });
  }, [
    muted,
    onAudibleAutoplayBlocked,
    onAudiblePlaybackStarted,
    shouldAutoplayVideo
  ]);

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
    setVideoCurrentTime(0);
    setVideoDuration(0);
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
      setIsVideoHoldPaused(false);
    }
  }, [isActive]);

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
      video.pause();
    }
  }, [
    asset.id,
    asset.mediaType,
    playVisibleVideo,
    shouldAutoplayVideo
  ]);

  useEffect(() => {
    if (asset.mediaType !== "video" || audiblePlaybackRequest <= 0) {
      return;
    }

    playVisibleVideo();
  }, [asset.mediaType, audiblePlaybackRequest, playVisibleVideo]);

  const startVideoHold = useCallback(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    holdTriggeredRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      holdTriggeredRef.current = true;
      video.pause();
      setIsVideoHoldPaused(true);
    }, VIDEO_HOLD_DELAY_MS);
  }, []);

  const resumeVideoAfterHold = useCallback(() => {
    const video = videoRef.current;

    if (!video || !isActive || !isVideoPlaybackVisible || playbackPaused) {
      return;
    }

    video.muted = muted;
    video
      .play()
      .then(() => {
        if (!muted && !video.muted) {
          onAudiblePlaybackStarted?.();
        }
      })
      .catch(() => {
        if (muted) {
          return;
        }

        video.muted = true;
        onAudibleAutoplayBlocked?.();
        video.play().catch(() => undefined);
      });
  }, [
    isActive,
    isVideoPlaybackVisible,
    muted,
    onAudibleAutoplayBlocked,
    onAudiblePlaybackStarted,
    playbackPaused
  ]);

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

  const seekVideo = useCallback((time: number) => {
    const video = videoRef.current;

    if (!video || !Number.isFinite(time)) {
      return;
    }

    video.currentTime = time;
    setVideoCurrentTime(time);
  }, []);

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
        {asset.mediaType === "video" ? <Video size={30} /> : <Image size={30} />}
      </div>
    );
  }

  if (asset.mediaType === "image") {
    const originalSource = mediaUrl(asset.id);
    const isProgressiveImage = useOriginalImage && !originalImageFailed;
    const shouldUseOriginalImage =
      isProgressiveImage ||
      (isAnimatedImage && isVisible && !animatedImageFailed);
    const previewSource = shouldUseOriginalImage
      ? originalSource
      : thumbnailUrl(asset.id, thumbnailSize);
    const isImageReady = loadedImageSource === previewSource;
    const isThumbnailReady =
      isProgressiveImage && loadedThumbnailSource === posterSource;

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
                if (!shouldUseOriginalImage) {
                  markMediaImageReady(previewSource);
                }
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
            if (showVideoTimeline) {
              setVideoDuration(
                Number.isFinite(event.currentTarget.duration)
                  ? event.currentTarget.duration
                  : 0
              );
              setVideoCurrentTime(event.currentTarget.currentTime);
            }
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
            if (shouldAutoplayVideo) {
              revealVideoAfterPresentedFrame(event.currentTarget);
            }
          }}
          onTimeUpdate={
            showVideoTimeline
              ? (event) => setVideoCurrentTime(event.currentTarget.currentTime)
              : undefined
          }
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
          />
          <span className="media-video-progress-track" aria-hidden="true">
            <span
              style={{
                width: `${
                  videoDuration > 0
                    ? (videoCurrentTime / videoDuration) * 100
                    : 0
                }%`
              }}
            />
          </span>
          <input
            className="media-video-timeline"
            type="range"
            min="0"
            max={videoDuration || 1}
            step="0.01"
            value={Math.min(videoCurrentTime, videoDuration || 1)}
            aria-label={`Seek ${asset.name}`}
            aria-valuetext={`${formatVideoTime(videoCurrentTime)} of ${formatVideoTime(videoDuration)}`}
            onChange={(event) => seekVideo(event.currentTarget.valueAsNumber)}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </>
      ) : null}
    </span>
  );
});

function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const roundedSeconds = Math.floor(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function isAnimatedImagePreview(asset: AssetRecord): boolean {
  return (
    asset.mediaType === "image" &&
    ANIMATED_IMAGE_EXTENSIONS.has(asset.extension.toLocaleLowerCase("en-US"))
  );
}
