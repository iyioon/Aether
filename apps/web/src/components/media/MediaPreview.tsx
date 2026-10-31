import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Image, Video } from "lucide-react";
import type { AssetRecord, PresentationAspect } from "../../api/client";
import { isMediaImageReady, markMediaImageReady } from "./media-image-cache";
import {
  imageDisplayUrl,
  isAnimatedImagePreview,
  mediaUrl,
  thumbnailUrl,
  videoPreviewUrl
} from "./media-urls";
import { requestPresentedVideoFrame } from "./video-frame-presentation";
import { useVideoPlayback } from "./useVideoPlayback";
import { useVideoBuffering } from "./useVideoBuffering";
import { VideoControls } from "./VideoControls";
import { ControlledAnimation } from "./ControlledAnimation";
import { animationPresentationKey } from "./animation-timeline";
import { usePresentationPreferences } from "./presentation-context";
import {
  getPresentationValues,
  presentationFramingForAspect
} from "./presentation-model";
import { presentationMediaStyle } from "./presentation-geometry";
import {
  bounceDurationExceeded,
  playbackVariant,
  presentationPlaybackUrl,
  presentationPosterUrl
} from "./presentation-playback";
import { useVideoPresentation } from "./useVideoPresentation";
import { usePresentationCapabilities } from "./usePresentationCapabilities";
import { useBounceCodec } from "./useBounceCodec";
import { MediaLoadingBar } from "./MediaLoadingBar";
import { MediaErrorNotice } from "./MediaErrorNotice";
import { mediaFailureNotice } from "./media-failure-notice";
import { useVideoPlaybackFailure } from "./useVideoPlaybackFailure";
import { canFallbackFromVideoFailure } from "./video-playback-failure";
import { useVideoRangePreload } from "./useVideoRangePreload";
import { releaseDetachedMedia } from "./detached-media";

const VIDEO_HOLD_DELAY_MS = 320;

export interface MediaPlaybackCommands {
  togglePlayback: () => void;
  enableSound: () => void;
}

interface MediaPreviewProps {
  controlsContainer?: HTMLElement | null;
  noticeContainer?: HTMLElement | null;
  asset: AssetRecord;
  applyPlaybackPreferences?: boolean;
  framingAspect?: PresentationAspect;
  defaultFit?: "contain" | "cover";
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
  controlsContainer,
  noticeContainer,
  applyPlaybackPreferences = true,
  defaultFit = "cover",
  framingAspect = "Original",
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
  const preferences = usePresentationPreferences();
  playbackPaused = playbackPaused || preferences.isPlaybackPaused;
  const highlightsOnly = preferences.highlightsOnly;
  const surfaceRef = useRef<HTMLSpanElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (!video) return;
    return () => {
      if (videoRef.current === video) videoRef.current = null;
      releaseDetachedMedia(video);
    };
  }, []);
  const attachImage = useCallback((image: HTMLImageElement | null) => {
    imageRef.current = image;
    if (!image) return;
    return () => {
      if (imageRef.current === image) imageRef.current = null;
      releaseDetachedMedia(image);
    };
  }, []);
  const attachPoster = useCallback((image: HTMLImageElement | null) => {
    if (image) return () => releaseDetachedMedia(image);
  }, []);
  const visibilityBindingRef = useRef<{
    element: Element;
    video: HTMLVideoElement | null;
    key: string;
    dispose: () => void;
  } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const videoPlaybackRequestSequenceRef = useRef(0);
  const videoFrameRequestSequenceRef = useRef(0);
  const cancelVideoRevealRef = useRef<(() => void) | null>(null);
  const shouldAutoplayVideoRef = useRef(false);
  const videoSourceRef = useRef("");
  const feedResumePositionRef = useRef<{ source: string; time: number } | null>(
    null
  );
  const userPausedRef = useRef(false);
  const isAnimatedImage = !staticPreview && isAnimatedImagePreview(asset);
  const [hasError, setHasError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
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
  const [failedThumbnailSource, setFailedThumbnailSource] = useState<
    string | null
  >(null);
  const [readyAnimationKey, setReadyAnimationKey] = useState<string | null>(
    null
  );
  const animationCandidate =
    asset.mediaType === "image" &&
    /\.(gif|webp|apng|png|avif)$/i.test(asset.name);
  const variant = applyPlaybackPreferences
    ? playbackVariant(asset, highlightsOnly)
    : highlightsOnly && asset.presentation?.highlight
      ? "highlight"
      : "full";
  const {
    capabilities,
    error: capabilitiesError,
    limitExceeded,
    retry: retryCapabilities
  } = usePresentationCapabilities(
    asset,
    !staticPreview &&
      !isPageHidden &&
      (showVideoTimeline ? isActive || preloadPreview : isVisible) &&
      (animationCandidate ||
        variant === "bounce" ||
        (variant === "highlight" && (!useOriginalVideo || originalVideoFailed)))
  );
  const playbackAsset = capabilities
    ? {
        ...asset,
        durationMs: capabilities.durationMs ?? asset.durationMs,
        ...(asset.presentation
          ? {
              presentation: {
                ...asset.presentation,
                renditionKeys: capabilities.renditionKeys
              }
            }
          : {})
      }
    : asset;
  const controlledAnimation =
    capabilities?.kind === "animation" && !staticPreview;
  const values = getPresentationValues(asset.presentation);
  const animationDisplayKey = animationPresentationKey(
    `${asset.id}:${capabilities?.renditionKeys.full ?? ""}`,
    values.highlight,
    highlightsOnly
  );
  const framedValues = {
    ...values,
    ...presentationFramingForAspect(values, framingAspect)
  };
  const bounceOverBudget =
    variant === "bounce" &&
    (capabilities?.bounceOverBudget ||
      bounceDurationExceeded(playbackAsset, capabilities?.maxBounceDurationMs));
  const bounceUnavailable =
    variant === "bounce" && capabilities?.bounceUnavailable;
  const bounceCodec = useBounceCodec(
    asset.presentation?.renditionKeys.bounce ?? asset.id
  );
  const mediaStyle = presentationMediaStyle(framedValues, defaultFit);
  const posterSource =
    presentationPosterUrl(playbackAsset, highlightsOnly, thumbnailSize) ??
    thumbnailUrl(asset, thumbnailSize);
  const videoSource =
    asset.mediaType === "video"
      ? variant === "bounce"
        ? presentationPlaybackUrl(playbackAsset, variant, bounceCodec.codec)
        : variant === "highlight"
          ? useOriginalVideo && !originalVideoFailed
            ? mediaUrl(asset)
            : presentationPlaybackUrl(playbackAsset, variant)
          : useOriginalVideo
            ? originalVideoFailed
              ? videoPreviewUrl(asset, tall ? 720 : 480)
              : mediaUrl(asset)
            : videoPreviewFailed
              ? mediaUrl(asset)
              : videoPreviewUrl(asset, tall ? 720 : 480)
      : "";
  const playbackFailure = useVideoPlaybackFailure({
    source: videoSource,
    enabled: asset.mediaType === "video" && !staticPreview
  });
  useVideoRangePreload(
    videoSource,
    showVideoTimeline &&
      preloadPreview &&
      !isActive &&
      !staticPreview &&
      !isPageHidden &&
      !playbackPaused &&
      asset.mediaType === "video" &&
      !bounceOverBudget &&
      !bounceUnavailable &&
      !capabilitiesError &&
      (variant !== "bounce" || capabilities !== null)
  );
  const failureNotice = mediaFailureNotice({
    kind:
      asset.mediaType === "image"
        ? "animation"
        : variant === "bounce"
          ? "bounce"
          : "video",
    error: capabilitiesError ?? playbackFailure.failure,
    bounceUnavailable,
    bounceOverBudget,
    limitExceeded
  });

  const isVideoPlaybackVisible = isVisible || (showVideoTimeline && isActive);
  const shouldLoadVideo =
    asset.mediaType === "video" &&
    !staticPreview &&
    !bounceOverBudget &&
    !bounceUnavailable &&
    (variant !== "bounce" || capabilities !== null) &&
    (showVideoTimeline ? isActive : isVideoPlaybackVisible || preloadPreview);
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
  const isVideoBuffering = useVideoBuffering({
    videoRef,
    sourceKey: shouldLoadVideo ? videoSource : "",
    enabled: isVideoPlaybackAllowed
  });
  const presentationVideo = useVideoPresentation(
    videoRef,
    playback,
    playbackAsset,
    variant,
    applyPlaybackPreferences,
    capabilities?.bounceTimeline
  );
  const isVideoReady =
    readyVideoSource === videoSource && presentationVideo.isReady;
  const didVideoPosterFail = failedVideoPosterSource === posterSource;
  const isVideoPosterReady =
    !didVideoPosterFail &&
    (loadedVideoPosterSource === posterSource ||
      isMediaImageReady(posterSource));

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

      video.muted = variant === "bounce" || requestedMuted;
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
    [muted, variant, onAudibleAutoplayBlocked, onAudiblePlaybackStarted]
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
    const video = videoRef.current;
    if (
      isVideoPlaybackVisible &&
      !isPageHidden &&
      !isVideoReady &&
      presentationVideo.isReady &&
      shouldLoadVideo &&
      video &&
      video.readyState >= 2 &&
      !video.seeking
    )
      revealVideoAfterPresentedFrame(video);
  }, [
    isVideoPlaybackVisible,
    isPageHidden,
    isVideoReady,
    presentationVideo.isReady,
    shouldLoadVideo,
    revealVideoAfterPresentedFrame
  ]);

  useEffect(() => {
    cancelPendingVideoReveal();
    videoFrameRequestSequenceRef.current += 1;
    setReadyVideoSource(null);
    setVideoPlaybackFailed(false);
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
    setFailedThumbnailSource(null);
    setReadyAnimationKey(null);
    cancelPendingVideoReveal();
    videoFrameRequestSequenceRef.current += 1;
  }, [asset.id, asset.mtimeMs, asset.sizeBytes, cancelPendingVideoReveal]);

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
    if (staticPreview || (asset.mediaType !== "video" && !animationCandidate))
      return;

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
  }, [asset.mediaType, animationCandidate, staticPreview]);

  useEffect(
    () => () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }
    },
    []
  );

  const publishVisibility = useCallback((visible: boolean) => {
    setIsVisible(visible);
  }, []);
  useLayoutEffect(() => {
    const previewElement =
      surfaceRef.current ??
      (asset.mediaType === "video" ? videoRef.current : imageRef.current);
    const video = videoRef.current;
    const key = `${asset.id}:${asset.mtimeMs}:${asset.sizeBytes}:${asset.mediaType}:${animationCandidate}:${staticPreview}`;
    const binding = visibilityBindingRef.current;
    if (
      binding?.element === previewElement &&
      binding.video === video &&
      binding.key === key
    )
      return;
    binding?.dispose();
    visibilityBindingRef.current = null;
    if (!previewElement) return;
    if (typeof IntersectionObserver === "undefined") {
      publishVisibility(true);
      visibilityBindingRef.current = {
        element: previewElement,
        video,
        key,
        dispose: () => video?.pause()
      };
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];

        if (!active || !firstEntry) {
          return;
        }

        publishVisibility(firstEntry.isIntersecting);
      },
      asset.mediaType === "video"
        ? { threshold: 0.45 }
        : { rootMargin: "180px 0px", threshold: 0.01 }
    );

    observer.observe(previewElement);
    visibilityBindingRef.current = {
      element: previewElement,
      video,
      key,
      dispose: () => {
        active = false;
        observer.disconnect();
        video?.pause();
      }
    };
  });
  useLayoutEffect(
    () => () => {
      visibilityBindingRef.current?.dispose();
      visibilityBindingRef.current = null;
    },
    []
  );

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
  }, [
    asset.id,
    asset.mediaType,
    playVisibleVideo,
    shouldAutoplayVideo,
    retryAttempt
  ]);

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
    if (!showVideoTimeline || asset.mediaType !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    const remember = () => {
      if (
        video.getAttribute("src") === videoSource &&
        video.readyState >= 1 &&
        Number.isFinite(video.currentTime)
      )
        feedResumePositionRef.current = {
          source: videoSource,
          time: video.currentTime
        };
    };
    const restore = () => {
      const saved = feedResumePositionRef.current;
      // Highlight entry continues to use its selected-start section observer.
      if (
        variant === "highlight" ||
        !saved ||
        saved.source !== videoSource ||
        video.getAttribute("src") !== videoSource ||
        !Number.isFinite(video.duration)
      )
        return;
      try {
        video.currentTime = Math.max(
          0,
          Math.min(saved.time, video.duration - 0.001)
        );
      } catch {
        // Native metadata can become obsolete while a source is unloading.
      }
    };
    for (const event of ["timeupdate", "seeked", "pause"])
      video.addEventListener(event, remember);
    video.addEventListener("loadedmetadata", restore);
    return () => {
      for (const event of ["timeupdate", "seeked", "pause"])
        video.removeEventListener(event, remember);
      video.removeEventListener("loadedmetadata", restore);
    };
  }, [asset.mediaType, showVideoTimeline, videoSource, variant, retryAttempt]);

  useEffect(() => {
    if (asset.mediaType === "video" && !shouldLoadVideo) {
      cancelPendingVideoReveal();
      videoFrameRequestSequenceRef.current += 1;
      setReadyVideoSource(null);
      if (showVideoTimeline) videoRef.current?.load();
    }
  }, [
    asset.mediaType,
    cancelPendingVideoReveal,
    shouldLoadVideo,
    showVideoTimeline
  ]);

  const videoToggle = (
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
  );

  const transport = (
    <VideoControls
      className="video-controls--feed"
      playback={presentationVideo.playback}
      minimumTime={presentationVideo.minimumTime}
      sectionLabel={presentationVideo.sectionLabel}
      hasAudio={presentationVideo.hasAudio}
      seekLabel={`Seek ${asset.name}`}
      onTogglePlayback={toggleVideoPlayback}
      onToggleMuted={onToggleMuted}
      onExpand={onExpand}
      expandLabel={`Open ${asset.name} in viewer`}
    />
  );

  const retryMedia = () => {
    playbackFailure.clear();
    cancelPendingVideoReveal();
    videoPlaybackRequestSequenceRef.current += 1;
    videoFrameRequestSequenceRef.current += 1;
    setHasError(false);
    setAnimatedImageFailed(false);
    setOriginalImageFailed(false);
    setOriginalVideoFailed(false);
    setVideoPreviewFailed(false);
    setVideoPlaybackFailed(false);
    setReadyVideoSource(null);
    setLoadedVideoPosterSource(null);
    setFailedVideoPosterSource(null);
    setLoadedImageSource(null);
    setLoadedThumbnailSource(null);
    setFailedThumbnailSource(null);
    setRetryAttempt((attempt) => attempt + 1);
    if (capabilitiesError) retryCapabilities();
  };
  const errorNotice = (message: string, canRetry = true) => {
    const notice = (
      <MediaErrorNotice
        message={message}
        compact={!showVideoTimeline}
        onRetry={canRetry ? retryMedia : undefined}
      />
    );
    return noticeContainer ? createPortal(notice, noticeContainer) : notice;
  };
  const placeholder = (
    <span
      ref={surfaceRef}
      className={tall ? "media-placeholder tall" : "media-placeholder"}
    >
      {asset.mediaType === "video" ? <Video size={30} /> : <Image size={30} />}
      {errorNotice(
        asset.mediaType === "video"
          ? "Preview unavailable."
          : "Image unavailable."
      )}
    </span>
  );

  if (hasError) {
    return placeholder;
  }

  if (asset.mediaType === "image") {
    const originalSource = imageDisplayUrl(asset);
    const shouldUseOriginalImage =
      (!animationCandidate || capabilities?.kind === "still") &&
      ((useOriginalImage && !originalImageFailed) ||
        (isAnimatedImage && isActive && isVisible && !animatedImageFailed));
    const isProgressiveImage = shouldUseOriginalImage;
    const hasImagePoster =
      useOriginalImage ||
      isProgressiveImage ||
      (animationCandidate && !staticPreview);
    const previewSource = shouldUseOriginalImage
      ? originalSource
      : posterSource;
    const isImageReady =
      loadedImageSource === previewSource ||
      (!shouldUseOriginalImage && isMediaImageReady(previewSource));
    const isThumbnailReady =
      hasImagePoster &&
      failedThumbnailSource !== posterSource &&
      (loadedThumbnailSource === posterSource ||
        isMediaImageReady(posterSource));

    if (
      hasImagePoster &&
      failedThumbnailSource === posterSource &&
      !shouldUseOriginalImage &&
      !controlledAnimation &&
      (staticPreview || capabilities?.kind === "still")
    )
      return placeholder;

    return (
      <span
        ref={surfaceRef}
        className={[
          "media-image-shell",
          tall ? "tall" : "",
          isProgressiveImage ? "progressive" : "",
          isThumbnailReady ? "thumbnail-ready" : "",
          controlledAnimation && readyAnimationKey === animationDisplayKey
            ? "animation-ready"
            : "",
          isImageReady ? "ready" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {!controlledAnimation &&
        isVisible &&
        isActive &&
        !isPageHidden &&
        !capabilitiesError &&
        (!isImageReady ||
          (!staticPreview && animationCandidate && !capabilities)) ? (
          <MediaLoadingBar />
        ) : null}
        {capabilitiesError && !controlledAnimation
          ? errorNotice(failureNotice.message, failureNotice.canRetry)
          : (originalImageFailed || animatedImageFailed) && !controlledAnimation
            ? errorNotice("Image unavailable.")
            : null}
        <span className="media-image-loading" aria-hidden="true" />
        {hasImagePoster && failedThumbnailSource !== posterSource ? (
          <img
            key={`${posterSource}:${retryAttempt}`}
            ref={attachPoster}
            aria-hidden={
              shouldUseOriginalImage || controlledAnimation || undefined
            }
            style={mediaStyle}
            className={
              tall
                ? "media-image media-image-thumbnail tall"
                : "media-image media-image-thumbnail"
            }
            src={posterSource}
            alt={
              shouldUseOriginalImage || controlledAnimation ? "" : asset.name
            }
            data-preview-source={
              !shouldUseOriginalImage && !controlledAnimation
                ? "thumbnail"
                : undefined
            }
            decoding="async"
            fetchPriority={isActive ? "high" : "auto"}
            loading={isActive ? "eager" : "lazy"}
            onLoad={(event) => {
              const image = event.currentTarget;
              const ready = () => {
                if (
                  !image.isConnected ||
                  image.getAttribute("src") !== posterSource ||
                  image.naturalWidth === 0
                )
                  return;
                markMediaImageReady(posterSource);
                setLoadedThumbnailSource(posterSource);
                if (!shouldUseOriginalImage && !controlledAnimation)
                  onDimensionsKnown?.(
                    asset.id,
                    image.naturalWidth,
                    image.naturalHeight
                  );
              };
              void image.decode().then(ready, ready);
            }}
            onError={(event) => {
              if (event.currentTarget.isConnected)
                setFailedThumbnailSource(posterSource);
            }}
          />
        ) : null}
        {controlledAnimation ? (
          <ControlledAnimation
            asset={playbackAsset}
            maxCanvasDimension={
              useOriginalImage || useOriginalVideo ? undefined : thumbnailSize
            }
            onRetry={retryCapabilities}
            showRetry
            noticeContainer={noticeContainer}
            showPoster={false}
            onReadyChange={(ready) =>
              setReadyAnimationKey(ready ? animationDisplayKey : null)
            }
            renditionKey={capabilities.renditionKeys.full}
            presentation={
              applyPlaybackPreferences
                ? framedValues
                : {
                    ...framedValues,
                    playbackRate: 1,
                    loopMode: "repeat"
                  }
            }
            highlightsOnly={highlightsOnly}
            active={isActive && isVisible}
            paused={playbackPaused}
            controls={showVideoTimeline}
            controlsClassName="video-controls--feed"
            controlsContainer={controlsContainer}
            onPlaybackReady={(commands) =>
              onVideoControlsReady?.(
                asset.id,
                commands
                  ? {
                      togglePlayback: () => {
                        commands.togglePlayback();
                      },
                      enableSound: () => undefined
                    }
                  : null
              )
            }
            defaultFit={defaultFit}
            onExpand={onExpand}
          />
        ) : !hasImagePoster || shouldUseOriginalImage ? (
          <img
            key={`${previewSource}:${retryAttempt}`}
            ref={attachImage}
            style={mediaStyle}
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
              const ready = () => {
                if (
                  imageRef.current !== image ||
                  !image.isConnected ||
                  image.getAttribute("src") !== previewSource ||
                  image.naturalWidth === 0
                )
                  return;
                markMediaImageReady(previewSource);
                setLoadedImageSource(previewSource);
                onDimensionsKnown?.(
                  asset.id,
                  image.naturalWidth,
                  image.naturalHeight
                );
              };
              void image.decode().then(ready, ready);
            }}
            onError={(event) => {
              if (
                !event.currentTarget.isConnected ||
                imageRef.current !== event.currentTarget
              )
                return;
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
        ) : null}
      </span>
    );
  }

  return (
    <span
      ref={surfaceRef}
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
      {isVideoPlaybackVisible &&
      isActive &&
      !isPageHidden &&
      (!isVideoReady || isVideoBuffering) &&
      !videoPlaybackFailed &&
      !capabilitiesError &&
      !bounceUnavailable &&
      !bounceOverBudget &&
      !staticPreview ? (
        <MediaLoadingBar />
      ) : null}
      <span className="media-video-loading" aria-hidden="true" />
      {!didVideoPosterFail ? (
        <img
          key={`${posterSource}:${retryAttempt}`}
          ref={attachPoster}
          className="media-video-poster"
          style={mediaStyle}
          src={posterSource}
          alt=""
          aria-hidden="true"
          loading={tall || preloadPreview ? "eager" : "lazy"}
          fetchPriority={isActive ? "high" : "auto"}
          decoding="async"
          onLoad={(event) => {
            const image = event.currentTarget;
            const markPosterReady = () => {
              if (!image.isConnected || image.naturalWidth === 0) {
                return;
              }

              markMediaImageReady(posterSource);
              setLoadedVideoPosterSource(posterSource);
            };

            void image.decode().then(markPosterReady, markPosterReady);
          }}
          onError={(event) => {
            if (event.currentTarget.isConnected) {
              setFailedVideoPosterSource(posterSource);
            }
          }}
        />
      ) : null}
      {!staticPreview ? (
        <video
          key={retryAttempt}
          ref={attachVideo}
          style={mediaStyle}
          className={tall ? "media-video tall" : "media-video"}
          src={shouldLoadVideo ? videoSource : undefined}
          autoPlay={shouldAutoplayVideo}
          data-preview-source={
            shouldLoadVideo
              ? variant === "bounce"
                ? "bounce"
                : variant === "highlight"
                  ? !useOriginalVideo || originalVideoFailed
                    ? "highlight-fallback"
                    : "original"
                  : useOriginalVideo
                    ? originalVideoFailed
                      ? "preview-fallback"
                      : "original"
                    : videoPreviewFailed
                      ? "original"
                      : "preview"
              : "poster"
          }
          data-presentation-timeline={
            variant === "highlight" &&
            (!useOriginalVideo || originalVideoFailed)
              ? "local"
              : "source"
          }
          muted={variant === "bounce" || muted}
          loop={variant !== "highlight"}
          playsInline
          preload={
            shouldLoadVideo
              ? showVideoTimeline || preloadPreview
                ? "auto"
                : "metadata"
              : "none"
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
          onLoadedData={(event) => {
            if (
              isVideoPlaybackVisible &&
              !isPageHidden &&
              presentationVideo.isReady
            )
              revealVideoAfterPresentedFrame(event.currentTarget);
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
          onError={(event) => {
            const video = event.currentTarget;
            if (
              !video.isConnected ||
              videoRef.current !== video ||
              video.getAttribute("src") !== videoSource
            )
              return;
            cancelPendingVideoReveal();
            videoFrameRequestSequenceRef.current += 1;
            setReadyVideoSource(null);
            setVideoPlaybackFailed(true);
            playbackFailure.diagnose(video, (failure) => {
              if (
                videoRef.current !== video ||
                !video.isConnected ||
                !canFallbackFromVideoFailure(failure)
              )
                return;
              if (variant === "bounce" && bounceCodec.tryFallback()) return;
              if (useOriginalVideo && !originalVideoFailed) {
                setOriginalVideoFailed(true);
              } else if (
                variant === "full" &&
                !useOriginalVideo &&
                !videoPreviewFailed
              ) {
                setVideoPreviewFailed(true);
              }
            });
          }}
        />
      ) : null}
      {bounceUnavailable ||
      bounceOverBudget ||
      limitExceeded ||
      capabilitiesError ||
      videoPlaybackFailed
        ? errorNotice(failureNotice.message, failureNotice.canRetry)
        : didVideoPosterFail && !isVideoReady
          ? errorNotice("Preview unavailable.")
          : null}
      {showVideoTimeline && !staticPreview ? (
        <>
          {controlsContainer ? (
            createPortal(
              <>
                {videoToggle}
                {transport}
              </>,
              controlsContainer
            )
          ) : (
            <>
              {videoToggle}
              {transport}
            </>
          )}
        </>
      ) : null}
    </span>
  );
});
