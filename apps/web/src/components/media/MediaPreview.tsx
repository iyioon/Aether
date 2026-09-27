import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Video } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { mediaUrl, thumbnailUrl, videoPreviewUrl } from "./media-urls";

const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".avif", ".apng"]);
type VideoPosterStatus = "loading" | "ready" | "error";

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
  const [videoPlaybackFailed, setVideoPlaybackFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [videoPosterStatus, setVideoPosterStatus] =
    useState<VideoPosterStatus>("loading");
  const [loadedImageSource, setLoadedImageSource] = useState<string | null>(
    null
  );
  const posterSource = thumbnailUrl(asset.id);
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
    setVideoPlaybackFailed(false);
    setIsVisible(false);
    setIsVideoReady(false);
    setVideoPosterStatus("loading");
    setLoadedImageSource(null);
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
    const previewSource =
      isAnimatedImage && isVisible && !animatedImageFailed
        ? mediaUrl(asset.id)
        : thumbnailUrl(asset.id);
    const isImageReady = loadedImageSource === previewSource;

    return (
      <span
        className={[
          "media-image-shell",
          tall ? "tall" : "",
          isImageReady ? "ready" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="media-image-loading" aria-hidden="true" />
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
            setLoadedImageSource(previewSource);
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
        isVideoReady && videoPosterStatus !== "loading" ? "ready" : ""
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
        loading={preloadPreview ? "eager" : "lazy"}
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
        onLoadStart={() => setIsVideoReady(false)}
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

          setVideoPlaybackFailed(true);
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
