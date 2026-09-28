import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Video } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { mediaUrl, thumbnailUrl, videoPreviewUrl } from "./media-urls";

const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".avif", ".apng"]);
const VIDEO_HOLD_DELAY_MS = 320;
type VideoPosterStatus = "loading" | "ready" | "error";

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
  tall?: boolean;
  useOriginalImage?: boolean;
  useOriginalVideo?: boolean;
}

export function MediaPreview({
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
  tall = false,
  useOriginalImage = false,
  useOriginalVideo = false
}: MediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const isAnimatedImage = isAnimatedImagePreview(asset);
  const [hasError, setHasError] = useState(false);
  const [animatedImageFailed, setAnimatedImageFailed] = useState(false);
  const [originalImageFailed, setOriginalImageFailed] = useState(false);
  const [originalVideoFailed, setOriginalVideoFailed] = useState(false);
  const [videoPreviewFailed, setVideoPreviewFailed] = useState(false);
  const [videoPlaybackFailed, setVideoPlaybackFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isVideoHoldPaused, setIsVideoHoldPaused] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPosterStatus, setVideoPosterStatus] =
    useState<VideoPosterStatus>("loading");
  const [loadedImageSource, setLoadedImageSource] = useState<string | null>(
    null
  );
  const [loadedThumbnailSource, setLoadedThumbnailSource] = useState<
    string | null
  >(null);
  const posterSource = thumbnailUrl(asset.id);
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
    (isVideoPlaybackVisible || preloadPreview);

  const playVisibleVideo = useCallback(() => {
    if (
      asset.mediaType !== "video" ||
      !isActive ||
      !isVideoPlaybackVisible ||
      playbackPaused ||
      isVideoHoldPaused
    ) {
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
    asset.mediaType,
    isActive,
    isVideoHoldPaused,
    isVideoPlaybackVisible,
    muted,
    onAudibleAutoplayBlocked,
    onAudiblePlaybackStarted,
    playbackPaused
  ]);

  useEffect(() => {
    setHasError(false);
    setAnimatedImageFailed(false);
    setOriginalImageFailed(false);
    setOriginalVideoFailed(false);
    setVideoPreviewFailed(false);
    setVideoPlaybackFailed(false);
    setIsVisible(false);
    setIsVideoReady(false);
    setIsVideoHoldPaused(false);
    setVideoCurrentTime(0);
    setVideoDuration(0);
    setVideoPosterStatus("loading");
    setLoadedImageSource(null);
    setLoadedThumbnailSource(null);
  }, [asset.id, isAnimatedImage, tall]);

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
    if (asset.mediaType !== "video" && !isAnimatedImage) {
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
  }, [asset.id, asset.mediaType, isAnimatedImage]);

  useEffect(() => {
    if (asset.mediaType !== "video") {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (isActive && isVideoPlaybackVisible && !playbackPaused) {
      playVisibleVideo();
    } else {
      video.pause();
    }
  }, [
    asset.id,
    asset.mediaType,
    isActive,
    isVideoPlaybackVisible,
    playbackPaused,
    playVisibleVideo
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
      setIsVideoReady(false);
    }
  }, [asset.mediaType, shouldLoadVideo]);

  if (
    hasError ||
    (asset.mediaType === "video" &&
      videoPlaybackFailed &&
      videoPosterStatus === "error")
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
    const previewSource =
      shouldUseOriginalImage ? originalSource : thumbnailUrl(asset.id);
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
              void image
                .decode()
                .catch(() => undefined)
                .then(() => setLoadedThumbnailSource(posterSource));
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
            void image
              .decode()
              .catch(() => undefined)
              .then(() => {
                setLoadedImageSource(previewSource);
                onDimensionsKnown?.(
                  asset.id,
                  image.naturalWidth,
                  image.naturalHeight
                );
              });
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
        videoPosterStatus === "ready" ? "poster-ready" : "",
        videoPosterStatus === "error" ? "poster-error" : "",
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
        onLoad={() => setVideoPosterStatus("ready")}
        onError={() => setVideoPosterStatus("error")}
      />
      <video
        ref={videoRef}
        className={tall ? "media-video tall" : "media-video"}
        src={shouldLoadVideo ? videoSource : undefined}
        poster={posterSource}
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
        onLoadStart={() => setIsVideoReady(false)}
        onLoadedMetadata={(event) => {
          setVideoDuration(
            Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration
              : 0
          );
          setVideoCurrentTime(event.currentTarget.currentTime);
          onDimensionsKnown?.(
            asset.id,
            event.currentTarget.videoWidth,
            event.currentTarget.videoHeight
          );
        }}
        onLoadedData={() => {
          if (isVideoPlaybackVisible && !playbackPaused) {
            playVisibleVideo();
          }
        }}
        onCanPlay={() => {
          if (isVideoPlaybackVisible && !playbackPaused) {
            playVisibleVideo();
          }
        }}
        onPlaying={() => setIsVideoReady(true)}
        onTimeUpdate={(event) => {
          setVideoCurrentTime(event.currentTarget.currentTime);
        }}
        onError={() => {
          setIsVideoReady(false);

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
      {showVideoTimeline ? (
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
}

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
