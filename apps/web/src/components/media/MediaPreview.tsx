import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Video } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { mediaUrl, thumbnailUrl, videoPreviewUrl } from "./media-urls";

const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".avif", ".apng"]);

interface MediaPreviewProps {
  asset: AssetRecord;
  audiblePlaybackRequest?: number;
  isActive?: boolean;
  muted?: boolean;
  onAudibleAutoplayBlocked?: () => void;
  onAudiblePlaybackStarted?: () => void;
  onDimensionsKnown?: (assetId: string, width: number, height: number) => void;
  playbackPaused?: boolean;
  preloadPreview?: boolean;
  tall?: boolean;
}

export function MediaPreview({
  asset,
  audiblePlaybackRequest = 0,
  isActive = true,
  muted = true,
  onAudibleAutoplayBlocked,
  onAudiblePlaybackStarted,
  onDimensionsKnown,
  playbackPaused = false,
  preloadPreview = false,
  tall = false
}: MediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isAnimatedImage = isAnimatedImagePreview(asset);
  const [hasError, setHasError] = useState(false);
  const [animatedImageFailed, setAnimatedImageFailed] = useState(false);
  const [videoPreviewFailed, setVideoPreviewFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const videoSource =
    asset.mediaType === "video"
      ? videoPreviewFailed
        ? mediaUrl(asset.id)
        : videoPreviewUrl(asset.id, tall ? 720 : 480)
      : "";
  const shouldLoadVideo =
    asset.mediaType === "video" && (isVisible || preloadPreview);

  const playVisibleVideo = useCallback(() => {
    if (asset.mediaType !== "video" || !isActive || !isVisible || playbackPaused) {
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
    isVisible,
    muted,
    onAudibleAutoplayBlocked,
    onAudiblePlaybackStarted,
    playbackPaused
  ]);

  useEffect(() => {
    setHasError(false);
    setAnimatedImageFailed(false);
    setVideoPreviewFailed(false);
    setIsVisible(false);
    setIsVideoReady(false);
  }, [asset.id, isAnimatedImage, tall]);

  useEffect(() => {
    if (asset.mediaType !== "video" && !isAnimatedImage) {
      return;
    }

    const previewElement =
      asset.mediaType === "video" ? videoRef.current : imageRef.current;

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
        videoRef.current?.pause();
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

    if (isActive && isVisible && !playbackPaused) {
      playVisibleVideo();
    } else {
      video.pause();
    }
  }, [
    asset.id,
    asset.mediaType,
    isActive,
    isVisible,
    playbackPaused,
    playVisibleVideo
  ]);

  useEffect(() => {
    if (asset.mediaType !== "video" || audiblePlaybackRequest <= 0) {
      return;
    }

    playVisibleVideo();
  }, [asset.mediaType, audiblePlaybackRequest, playVisibleVideo]);

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

  if (hasError) {
    return (
      <div className={tall ? "media-placeholder tall" : "media-placeholder"}>
        {asset.mediaType === "video" ? <Video size={30} /> : <Image size={30} />}
      </div>
    );
  }

  if (asset.mediaType === "image") {
    const previewSource =
      isAnimatedImage && isVisible && !animatedImageFailed
        ? mediaUrl(asset.id)
        : thumbnailUrl(asset.id);

    return (
      <img
        ref={imageRef}
        className={tall ? "media-image tall" : "media-image"}
        src={previewSource}
        alt={asset.name}
        data-preview-source={
          isAnimatedImage && isVisible && !animatedImageFailed
            ? "original"
            : "thumbnail"
        }
        loading={isAnimatedImage && isVisible ? "eager" : "lazy"}
        decoding="async"
        onLoad={(event) => {
          onDimensionsKnown?.(
            asset.id,
            event.currentTarget.naturalWidth,
            event.currentTarget.naturalHeight
          );
        }}
        onError={() => {
          if (isAnimatedImage && isVisible && !animatedImageFailed) {
            setAnimatedImageFailed(true);
            return;
          }

          setHasError(true);
        }}
      />
    );
  }

  return (
    <span
      className={[
        "media-video-shell",
        tall ? "tall" : "",
        isVideoReady ? "ready" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        className="media-video-poster"
        src={thumbnailUrl(asset.id)}
        alt=""
        aria-hidden="true"
        loading={preloadPreview ? "eager" : "lazy"}
        decoding="async"
      />
      <video
        ref={videoRef}
        className={tall ? "media-video tall" : "media-video"}
        src={shouldLoadVideo ? videoSource : undefined}
        poster={thumbnailUrl(asset.id)}
        data-preview-source={
          shouldLoadVideo
            ? videoPreviewFailed
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
        onLoadedMetadata={(event) => {
          onDimensionsKnown?.(
            asset.id,
            event.currentTarget.videoWidth,
            event.currentTarget.videoHeight
          );
        }}
        onLoadedData={() => {
          setIsVideoReady(true);

          if (isVisible && !playbackPaused) {
            playVisibleVideo();
          }
        }}
        onCanPlay={() => {
          setIsVideoReady(true);

          if (isVisible && !playbackPaused) {
            playVisibleVideo();
          }
        }}
        onError={() => {
          setIsVideoReady(false);

          if (!videoPreviewFailed) {
            setVideoPreviewFailed(true);
            return;
          }

          setHasError(true);
        }}
      />
    </span>
  );
}

function isAnimatedImagePreview(asset: AssetRecord): boolean {
  return (
    asset.mediaType === "image" &&
    ANIMATED_IMAGE_EXTENSIONS.has(asset.extension.toLocaleLowerCase("en-US"))
  );
}
