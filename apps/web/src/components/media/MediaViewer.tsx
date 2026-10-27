import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent as ReactTouchEvent
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Pencil,
  X
} from "lucide-react";
import type { AssetRecord, PresentationAspect } from "../../api/client";
import {
  hasShortcutModifier,
  isDirectionalKeyboardTarget,
  isEditableKeyboardTarget,
  isKeyboardActivationTarget,
  scoreAfterKeyboardAdjustment,
  viewerKeyboardCommand
} from "../../lib/keyboard";
import { panelExitDurationMs } from "../../lib/motion";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../ui/dialog";
import { isMediaImageReady, markMediaImageReady } from "./media-image-cache";
import {
  imageDisplayUrl,
  downloadUrl,
  mediaUrl,
  thumbnailUrl
} from "./media-urls";
import { requestPresentedVideoFrame } from "./video-frame-presentation";
import { VideoControls } from "./VideoControls";
import { useVideoPlayback, type VideoPlayback } from "./useVideoPlayback";
import { usePresentationPreferences } from "./presentation-context";
import { usePresentationCapabilities } from "./usePresentationCapabilities";
import {
  getPresentationValues,
  presentationFramingForAspect
} from "./presentation-model";
import { galleryAspectRatio } from "../gallery/gallery-layout";
import { ViewerViewOptions } from "./ViewerViewOptions";
import { presentationMediaStyle } from "./presentation-geometry";
import {
  bounceDurationExceeded,
  playbackVariant,
  presentationPlaybackUrl,
  presentationPosterUrl
} from "./presentation-playback";
import { useVideoPresentation } from "./useVideoPresentation";
import { useBounceCodec } from "./useBounceCodec";
import { ControlledAnimation } from "./ControlledAnimation";
import { animationPresentationKey } from "./animation-timeline";
import { MediaLoadingBar } from "./MediaLoadingBar";
import { MediaErrorNotice } from "./MediaErrorNotice";
import { mediaFailureNotice } from "./media-failure-notice";
import { useVideoPlaybackFailure } from "./useVideoPlaybackFailure";
import {
  canPresentVideoFullscreen,
  toggleVideoFullscreen
} from "./video-fullscreen";

interface MediaViewerProps {
  asset: AssetRecord;
  applyPlaybackPreferences?: boolean;
  framingAspect?: PresentationAspect;
  useSavedFraming: boolean;
  onFramingChange: (enabled: boolean) => void;
  hasNext: boolean;
  hasPrevious: boolean;
  isInfoOpen: boolean;
  onClose: () => void;
  onScoreChange: (score: number) => void;
  onToggleInfo: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onEditAsset?: (asset: AssetRecord) => void;
  onHighlightsOnlyChange: (value: boolean) => void;
}

interface ViewerStageSize {
  width: number;
  height: number;
}

interface ViewerTouchStart {
  x: number;
  y: number;
}

interface ViewerPosterState {
  assetId: string;
  source: string;
  status: "ready" | "error";
}

interface ViewerScoreFeedback {
  assetId: string;
  direction: -1 | 1;
  id: number;
  isExiting: boolean;
  score: number;
}

const CONTROL_HIDE_DELAY_MS = 1_800;
const SCORE_FEEDBACK_IDLE_MS = 750;
const SCORE_FEEDBACK_EXIT_MS = 150;
const SWIPE_DISTANCE_PX = 56;

export function MediaViewer({
  asset,
  applyPlaybackPreferences = true,
  framingAspect = "Original",
  useSavedFraming,
  onFramingChange,
  hasNext,
  hasPrevious,
  isInfoOpen,
  onClose,
  onScoreChange,
  onToggleInfo,
  onNext,
  onPrevious,
  onEditAsset,
  onHighlightsOnlyChange
}: MediaViewerProps) {
  const { highlightsOnly: savedHighlightsOnly, isPlaybackPaused } =
    usePresentationPreferences();
  const highlightsOnly = savedHighlightsOnly;
  const playbackBlocked = isPlaybackPaused;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsOpenRef = useRef(false);
  const [originalVideoFailed, setOriginalVideoFailed] = useState(false);
  const isAnimationCandidate =
    asset.mediaType === "image" &&
    /\.(gif|webp|png|apng|avif)$/i.test(asset.name);
  const capabilityState = usePresentationCapabilities(
    asset,
    (asset.mediaType === "video" &&
      ((applyPlaybackPreferences &&
        playbackVariant(asset, highlightsOnly) === "bounce") ||
        originalVideoFailed)) ||
      isAnimationCandidate
  );
  const viewerImageSource =
    isAnimationCandidate && capabilityState.capabilities?.kind !== "still"
      ? null
      : imageDisplayUrl(asset);
  const values = getPresentationValues(asset.presentation);
  const presentation = {
    ...values,
    ...(useSavedFraming
      ? presentationFramingForAspect(values, framingAspect)
      : { fit: "contain" as const, focalX: 0.5, focalY: 0.5, zoom: 1 })
  };
  const defaultFit = useSavedFraming ? "cover" : "contain";
  const effectiveAsset = useMemo(
    () =>
      capabilityState.capabilities && asset.presentation
        ? {
            ...asset,
            durationMs:
              capabilityState.capabilities.durationMs ?? asset.durationMs,
            presentation: {
              ...asset.presentation,
              renditionKeys: capabilityState.capabilities.renditionKeys
            }
          }
        : asset,
    [asset, capabilityState.capabilities]
  );
  const variant = applyPlaybackPreferences
    ? playbackVariant(effectiveAsset, highlightsOnly)
    : highlightsOnly && effectiveAsset.presentation?.highlight
      ? "highlight"
      : "full";
  const bounceOverBudget =
    variant === "bounce" &&
    (capabilityState.capabilities?.bounceOverBudget ||
      bounceDurationExceeded(
        effectiveAsset,
        capabilityState.capabilities?.maxBounceDurationMs
      ));
  const bounceUnavailable =
    variant === "bounce" && capabilityState.capabilities?.bounceUnavailable;
  const bounceCodec = useBounceCodec(
    effectiveAsset.presentation?.renditionKeys.bounce ?? asset.id
  );
  const videoSource =
    variant === "bounce" &&
    (!capabilityState.capabilities || bounceUnavailable || bounceOverBudget)
      ? ""
      : variant !== "bounce" && !originalVideoFailed
        ? mediaUrl(asset)
        : presentationPlaybackUrl(effectiveAsset, variant, bounceCodec.codec) ||
          mediaUrl(asset);
  const playbackFailure = useVideoPlaybackFailure({
    source: videoSource,
    enabled: asset.mediaType === "video" && variant === "bounce"
  });
  const isControlledAnimation =
    capabilityState.capabilities?.kind === "animation";
  const mediaStyle = presentationMediaStyle(presentation, defaultFit);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [failedAnimationKey, setFailedAnimationKey] = useState<string | null>(
    null
  );
  const [animationFailure, setAnimationFailure] = useState<unknown>(null);
  const animationKey = `${asset.id}:${effectiveAsset.presentation?.renditionKeys.full ?? ""}:${retryAttempt}`;
  const animationDisplayKey = animationPresentationKey(
    animationKey,
    presentation.highlight,
    highlightsOnly
  );
  const viewerStageRef = useRef<HTMLDivElement | null>(null);
  const [viewerStageElement, setViewerStageElement] =
    useState<HTMLDivElement | null>(null);
  const attachViewerStage = useCallback((element: HTMLDivElement | null) => {
    viewerStageRef.current = element;
    setViewerStageElement(element);
  }, []);
  const viewerDialogRef = useRef<HTMLDivElement | null>(null);
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);
  const animationPlaybackRef = useRef<VideoPlayback | null>(null);
  const nativeFullscreenRef = useRef(false);
  const nativeFullscreenCleanupRef = useRef<(() => void) | null>(null);
  const userPausedRef = useRef(false);
  const resumeMutedPlaybackRef = useRef(false);
  const controlsInteractionRef = useRef(false);
  const playbackBlockedRef = useRef(playbackBlocked);
  playbackBlockedRef.current = playbackBlocked;
  const infoOpenRef = useRef(isInfoOpen);
  infoOpenRef.current = isInfoOpen;
  const activeAssetIdRef = useRef(asset.id);
  const cancelVideoRevealRef = useRef<(() => void) | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const displayedScoreRef = useRef<number>(asset.score);
  const isClosingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const scoreFeedbackIdRef = useRef(0);
  const scoreFeedbackRemovalTimerRef = useRef<number | null>(null);
  const scoreFeedbackTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<ViewerTouchStart | null>(null);
  const suppressMediaClickRef = useRef(false);
  const videoFrameRequestSequenceRef = useRef(0);
  const previousViewedAssetRef = useRef({
    id: asset.id,
    videoSource: "",
    posterSource: "",
    retryAttempt: -1
  });
  const [isOpen, setIsOpen] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isViewerVideoMuted, setIsViewerVideoMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useNativeControls, setUseNativeControls] = useState(false);
  const [readyImageSource, setReadyImageSource] = useState<string | null>(null);
  const [failedImageSource, setFailedImageSource] = useState<string | null>(
    null
  );
  const [imagePosterState, setImagePosterState] =
    useState<ViewerPosterState | null>(null);
  const [readyAnimationKey, setReadyAnimationKey] = useState<string | null>(
    null
  );
  const [readyVideoAssetId, setReadyVideoAssetId] = useState<string | null>(
    null
  );
  const [failedVideoAssetId, setFailedVideoAssetId] = useState<string | null>(
    null
  );
  const [viewerPosterState, setViewerPosterState] =
    useState<ViewerPosterState | null>(null);
  const [viewerStageSize, setViewerStageSize] =
    useState<ViewerStageSize | null>(null);
  const [decodedMediaSize, setDecodedMediaSize] =
    useState<ViewerStageSize | null>(null);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");
  const [scoreFeedback, setScoreFeedback] =
    useState<ViewerScoreFeedback | null>(null);
  const storedMediaSize = useMemo<ViewerStageSize | null>(() => {
    const width = asset.width ?? capabilityState.capabilities?.width;
    const height = asset.height ?? capabilityState.capabilities?.height;
    if (
      !width ||
      !height ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }

    return { width, height };
  }, [
    asset.height,
    asset.width,
    capabilityState.capabilities?.height,
    capabilityState.capabilities?.width
  ]);
  const viewerMediaSize = decodedMediaSize ?? storedMediaSize;
  const viewerMediaFrameStyle = useMemo(
    () =>
      useSavedFraming
        ? mediaViewerFrameStyle(
            framingAspect !== "Original"
              ? { width: galleryAspectRatio(framingAspect), height: 1 }
              : viewerMediaSize,
            viewerStageSize
          )
        : undefined,
    [viewerMediaSize, viewerStageSize, useSavedFraming, framingAspect]
  );
  const playback = useVideoPlayback({
    videoRef: viewerVideoRef,
    sourceKey: `${videoSource}:${retryAttempt}`,
    enabled: asset.mediaType === "video" && failedVideoAssetId !== asset.id
  });
  const presentedPlayback = useVideoPresentation(
    viewerVideoRef,
    playback,
    effectiveAsset,
    variant,
    applyPlaybackPreferences,
    capabilityState.capabilities?.bounceTimeline
  );
  const viewerPosterSource =
    presentationPosterUrl(effectiveAsset, highlightsOnly) ??
    thumbnailUrl(asset);
  const isViewerImageReady =
    viewerImageSource !== null && readyImageSource === viewerImageSource;
  const isViewerImageFailed =
    viewerImageSource !== null && failedImageSource === viewerImageSource;
  const isViewerImagePosterFailed =
    imagePosterState?.source === viewerPosterSource &&
    imagePosterState.status === "error";
  const isViewerImagePosterReady =
    !isViewerImagePosterFailed &&
    ((imagePosterState?.source === viewerPosterSource &&
      imagePosterState.status === "ready") ||
      isMediaImageReady(viewerPosterSource));
  const isViewerAnimationReady = readyAnimationKey === animationDisplayKey;
  const isViewerPosterSettled =
    viewerPosterState?.assetId === asset.id &&
    viewerPosterState.source === viewerPosterSource;
  const isViewerPosterReady =
    isViewerPosterSettled && viewerPosterState.status === "ready";
  const isViewerPosterFailed =
    isViewerPosterSettled && viewerPosterState.status === "error";
  const isViewerVideoReady =
    readyVideoAssetId === asset.id && presentedPlayback.isReady;
  const isViewerVideoFailed = failedVideoAssetId === asset.id;
  const failureNotice = mediaFailureNotice({
    kind:
      asset.mediaType === "image"
        ? isControlledAnimation
          ? "animation"
          : "image"
        : variant === "bounce"
          ? "bounce"
          : "video",
    error:
      capabilityState.error ??
      playbackFailure.failure ??
      (failedAnimationKey === animationKey ? animationFailure : null),
    bounceUnavailable,
    bounceOverBudget,
    limitExceeded: capabilityState.limitExceeded
  });
  const isMediaReady =
    asset.mediaType === "image"
      ? isViewerImagePosterReady || isViewerImageReady || isViewerAnimationReady
      : isViewerPosterReady ||
        isViewerVideoReady ||
        (isViewerPosterSettled && isViewerVideoFailed);
  const isViewerVideoVisible = isViewerVideoReady;
  const isMediaLoading =
    !isControlledAnimation &&
    !capabilityState.error &&
    !bounceUnavailable &&
    !bounceOverBudget &&
    (asset.mediaType === "video"
      ? !isViewerVideoReady && !isViewerVideoFailed
      : !isViewerImageReady && !isViewerImageFailed);
  const {
    togglePlayback: togglePlaybackCommand,
    toggleMuted: toggleMutedCommand
  } = playback;

  activeAssetIdRef.current = asset.id;
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    optionsOpenRef.current = false;
    setOptionsOpen(false);
    viewerVideoRef.current?.pause();
    setIsOpen(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, panelExitDurationMs());
  }, []);

  const hideControlsLater = useCallback(() => {
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
    }

    controlsTimerRef.current = window.setTimeout(() => {
      controlsTimerRef.current = null;
      const focused = document.activeElement;
      if (
        controlsInteractionRef.current ||
        optionsOpenRef.current ||
        playbackBlockedRef.current ||
        infoOpenRef.current ||
        viewerVideoRef.current?.paused ||
        animationPlaybackRef.current?.state.paused ||
        (focused instanceof Element &&
          viewerDialogRef.current?.contains(focused) &&
          focused.closest("button, a, input, textarea, select"))
      ) {
        return;
      }
      setControlsVisible(false);
    }, CONTROL_HIDE_DELAY_MS);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    hideControlsLater();
  }, [hideControlsLater]);

  const toggleControls = useCallback(() => {
    if (suppressMediaClickRef.current) {
      suppressMediaClickRef.current = false;
      return;
    }
    if (
      infoOpenRef.current ||
      playbackBlockedRef.current ||
      optionsOpenRef.current
    )
      return;
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    // Keep keyboard focus visible while allowing a pointer tap to hide chrome.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest(".viewer-chrome"))
      viewerStageRef.current?.focus({ preventScroll: true });
    setControlsVisible((visible) => !visible);
    hideControlsLater();
  }, [hideControlsLater]);

  const changeOptionsOpen = useCallback(
    (open: boolean) => {
      optionsOpenRef.current = open;
      setOptionsOpen(open);
      if (open) revealControls();
      else hideControlsLater();
    },
    [hideControlsLater, revealControls]
  );

  const cancelPendingVideoReveal = useCallback(() => {
    cancelVideoRevealRef.current?.();
    cancelVideoRevealRef.current = null;
  }, []);

  const revealVideoAfterPresentedFrame = useCallback(
    (video: HTMLVideoElement, assetId: string) => {
      cancelPendingVideoReveal();
      const requestSequence = videoFrameRequestSequenceRef.current + 1;
      videoFrameRequestSequenceRef.current = requestSequence;

      cancelVideoRevealRef.current = requestPresentedVideoFrame(video, () => {
        cancelVideoRevealRef.current = null;

        if (
          videoFrameRequestSequenceRef.current === requestSequence &&
          viewerVideoRef.current === video &&
          activeAssetIdRef.current === assetId
        ) {
          setReadyVideoAssetId(assetId);
        }
      });
    },
    [cancelPendingVideoReveal]
  );

  const playViewerVideo = useCallback(() => {
    const video = viewerVideoRef.current;

    if (
      !video ||
      userPausedRef.current ||
      document.hidden ||
      playbackBlockedRef.current ||
      isClosingRef.current
    ) {
      return;
    }

    const stillAllowed = () =>
      viewerVideoRef.current === video &&
      !userPausedRef.current &&
      !document.hidden &&
      !playbackBlockedRef.current &&
      !isClosingRef.current;
    video
      .play()
      .then(() => {
        if (!stillAllowed()) video.pause();
      })
      .catch(() => {
        if (!stillAllowed() || video.muted) {
          return;
        }

        video.muted = true;
        setIsViewerVideoMuted(true);
        video
          .play()
          .then(() => {
            if (!stillAllowed()) video.pause();
          })
          .catch(() => undefined);
      });
  }, []);

  useEffect(() => {
    const video = viewerVideoRef.current;
    if (
      variant === "highlight" &&
      presentedPlayback.isReady &&
      video &&
      video.readyState >= 2 &&
      !video.seeking
    )
      revealVideoAfterPresentedFrame(video, asset.id);
  }, [
    asset.id,
    variant,
    presentedPlayback.isReady,
    revealVideoAfterPresentedFrame
  ]);

  const toggleViewerVideoPlayback = useCallback(() => {
    if (isControlledAnimation) {
      revealControls();
      const paused = animationPlaybackRef.current?.togglePlayback();
      setKeyboardAnnouncement(
        paused ? "Animation paused" : "Playback requested"
      );
      return;
    }
    const video = viewerVideoRef.current;

    if (!video) {
      return;
    }

    revealControls();

    resumeMutedPlaybackRef.current = false;
    const paused = togglePlaybackCommand();
    if (paused !== null) {
      userPausedRef.current = paused;
      setKeyboardAnnouncement(paused ? "Video paused" : "Playback requested");
    }
  }, [togglePlaybackCommand, revealControls, isControlledAnimation]);

  const toggleViewerSound = useCallback(() => {
    const video = viewerVideoRef.current;

    if (!video) {
      return;
    }

    if (variant === "bounce") return;
    toggleMutedCommand();

    revealControls();
    setKeyboardAnnouncement(
      video.muted || video.volume === 0 ? "Sound muted" : "Sound on"
    );
  }, [toggleMutedCommand, revealControls, variant]);

  const handleControlsInteraction = useCallback(
    (active: boolean) => {
      controlsInteractionRef.current = active;
      if (active) {
        setControlsVisible(true);
        if (controlsTimerRef.current !== null)
          window.clearTimeout(controlsTimerRef.current);
      } else {
        hideControlsLater();
      }
    },
    [hideControlsLater]
  );

  const handleFullscreen = useCallback(() => {
    revealControls();
    const video = viewerVideoRef.current;
    const assetId = activeAssetIdRef.current;
    void toggleVideoFullscreen(viewerDialogRef.current, video).then(
      (success) => {
        if (
          isClosingRef.current ||
          activeAssetIdRef.current !== assetId ||
          viewerVideoRef.current !== video
        )
          return;
        if (!success) {
          if (video) setUseNativeControls(true);
          setKeyboardAnnouncement(
            video
              ? "Fullscreen is unavailable. Native video controls are available."
              : "Fullscreen is unavailable."
          );
        }
      }
    );
  }, [revealControls]);

  const bindViewerVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      nativeFullscreenCleanupRef.current?.();
      nativeFullscreenCleanupRef.current = null;
      viewerVideoRef.current = video;
      nativeFullscreenRef.current = false;
      if (!video) return;
      const begin = () => {
        nativeFullscreenRef.current = true;
      };
      const end = () => {
        nativeFullscreenRef.current = false;
        userPausedRef.current = video.paused;
        revealControls();
      };
      video.addEventListener("webkitbeginfullscreen", begin);
      video.addEventListener("webkitendfullscreen", end);
      nativeFullscreenCleanupRef.current = () => {
        video.removeEventListener("webkitbeginfullscreen", begin);
        video.removeEventListener("webkitendfullscreen", end);
      };
    },
    [revealControls]
  );

  const adjustViewerScore = useCallback(
    (direction: -1 | 1) => {
      const currentScore = displayedScoreRef.current;
      const updatedScore = scoreAfterKeyboardAdjustment(
        displayedScoreRef.current,
        direction
      );
      const nextScore = updatedScore;

      if (nextScore === currentScore) {
        setKeyboardAnnouncement("Score is already 0");
        return;
      }

      scoreFeedbackIdRef.current += 1;
      setScoreFeedback({
        assetId: asset.id,
        direction,
        id: scoreFeedbackIdRef.current,
        isExiting: false,
        score: nextScore
      });

      if (scoreFeedbackTimerRef.current !== null) {
        window.clearTimeout(scoreFeedbackTimerRef.current);
      }
      if (scoreFeedbackRemovalTimerRef.current !== null) {
        window.clearTimeout(scoreFeedbackRemovalTimerRef.current);
        scoreFeedbackRemovalTimerRef.current = null;
      }

      scoreFeedbackTimerRef.current = window.setTimeout(() => {
        scoreFeedbackTimerRef.current = null;
        setScoreFeedback((current) =>
          current?.assetId === asset.id
            ? { ...current, isExiting: true }
            : current
        );
        scoreFeedbackRemovalTimerRef.current = window.setTimeout(() => {
          scoreFeedbackRemovalTimerRef.current = null;
          setScoreFeedback(null);
        }, SCORE_FEEDBACK_EXIT_MS);
      }, SCORE_FEEDBACK_IDLE_MS);

      displayedScoreRef.current = updatedScore;
      setKeyboardAnnouncement(
        `Score ${direction > 0 ? "increased" : "decreased"} to ${nextScore}`
      );
      onScoreChange(updatedScore);
    },
    [asset.id, onScoreChange]
  );

  const navigateAndPlayViewerVideo = useCallback(
    (direction: -1 | 1) => {
      changeOptionsOpen(false);
      if (direction > 0) {
        onNext();
      } else {
        onPrevious();
      }

      revealControls();
    },
    [onNext, onPrevious, revealControls, changeOptionsOpen]
  );

  useEffect(() => {
    changeOptionsOpen(false);
    revealControls();

    return () => {
      if (controlsTimerRef.current !== null) {
        window.clearTimeout(controlsTimerRef.current);
      }
    };
  }, [asset.id, revealControls, changeOptionsOpen]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!playbackBlocked && !isInfoOpen) {
      hideControlsLater();
      return;
    }

    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    setControlsVisible(true);
  }, [hideControlsLater, playbackBlocked, isInfoOpen]);

  useEffect(() => {
    const stage = viewerStageElement;

    if (!stage) {
      return;
    }

    let animationFrame: number | null = null;
    const measureStage = () => {
      // Ignore the opening animation's transform when measuring layout space.
      const width = stage.clientWidth;
      const height = stage.clientHeight;

      setViewerStageSize((current) =>
        current?.width === width && current.height === height
          ? current
          : { width, height }
      );
    };
    const scheduleMeasure = () => {
      if (animationFrame !== null) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        measureStage();
      });
    };

    scheduleMeasure();

    if (typeof window.ResizeObserver === "function") {
      const resizeObserver = new window.ResizeObserver(scheduleMeasure);
      resizeObserver.observe(stage);

      return () => {
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
        resizeObserver.disconnect();
      };
    }

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [viewerStageElement]);

  useLayoutEffect(() => {
    setReadyImageSource(null);
    setFailedImageSource(null);
  }, [viewerImageSource, retryAttempt]);

  useLayoutEffect(() => {
    setReadyAnimationKey(null);
  }, [animationDisplayKey]);

  useLayoutEffect(() => {
    const previousAsset = previousViewedAssetRef.current;
    if (previousAsset.posterSource !== viewerPosterSource)
      setViewerPosterState(null);
    previousViewedAssetRef.current = {
      id: asset.id,
      videoSource,
      posterSource: viewerPosterSource,
      retryAttempt
    };
    if (
      previousAsset.id === asset.id &&
      previousAsset.videoSource === videoSource &&
      previousAsset.retryAttempt === retryAttempt
    )
      return;
    setDecodedMediaSize(null);
    if (previousAsset.id !== asset.id) {
      userPausedRef.current = false;
      setOriginalVideoFailed(false);
    }
    nativeFullscreenRef.current = false;
    resumeMutedPlaybackRef.current = false;
    controlsInteractionRef.current = false;
    setUseNativeControls(false);
    setReadyVideoAssetId(null);
    setFailedVideoAssetId(null);
    cancelPendingVideoReveal();
    videoFrameRequestSequenceRef.current += 1;
  }, [
    asset.id,
    asset.mediaType,
    cancelPendingVideoReveal,
    viewerPosterSource,
    videoSource,
    retryAttempt
  ]);

  useEffect(
    () => () => {
      activeAssetIdRef.current = "";
      cancelPendingVideoReveal();
      videoFrameRequestSequenceRef.current += 1;
    },
    [cancelPendingVideoReveal]
  );

  useEffect(() => {
    displayedScoreRef.current = asset.score;
  }, [asset.id, asset.score]);

  useEffect(
    () => () => {
      if (scoreFeedbackTimerRef.current !== null) {
        window.clearTimeout(scoreFeedbackTimerRef.current);
      }
      if (scoreFeedbackRemovalTimerRef.current !== null) {
        window.clearTimeout(scoreFeedbackRemovalTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (asset.mediaType !== "video") {
      return;
    }

    const animationFrame = window.requestAnimationFrame(playViewerVideo);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [asset.id, asset.mediaType, playViewerVideo, videoSource, retryAttempt]);

  useEffect(() => {
    if (asset.mediaType !== "video") return;
    const suspend = () => {
      const video = viewerVideoRef.current;
      resumeMutedPlaybackRef.current ||= Boolean(
        video && !video.paused && video.muted && !userPausedRef.current
      );
      video?.pause();
    };
    const restore = () => {
      if (document.hidden) return;
      const video = viewerVideoRef.current;
      if (video && video.readyState >= 2 && presentedPlayback.isReady)
        revealVideoAfterPresentedFrame(video, asset.id);
      if (playbackBlockedRef.current) return;
      if (resumeMutedPlaybackRef.current && viewerVideoRef.current?.muted) {
        resumeMutedPlaybackRef.current = false;
        playViewerVideo();
      }
    };
    const visibility = () => (document.hidden ? suspend() : restore());
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", restore);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", restore);
    };
  }, [
    asset.id,
    asset.mediaType,
    playViewerVideo,
    videoSource,
    retryAttempt,
    presentedPlayback.isReady,
    revealVideoAfterPresentedFrame
  ]);

  useEffect(() => {
    const video = viewerVideoRef.current;
    if (playbackBlocked) {
      resumeMutedPlaybackRef.current ||= Boolean(
        video && !video.paused && video.muted && !userPausedRef.current
      );
      video?.pause();
    } else if (resumeMutedPlaybackRef.current && !document.hidden) {
      resumeMutedPlaybackRef.current = false;
      playViewerVideo();
    }
  }, [playbackBlocked, playViewerVideo]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewerDialogRef.current);
      revealControls();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [revealControls]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        playbackBlocked ||
        isInfoOpen ||
        optionsOpenRef.current ||
        event.defaultPrevented ||
        event.isComposing ||
        hasShortcutModifier(event) ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const command = viewerKeyboardCommand(event.key);

      if (
        !command ||
        (event.repeat && !["next", "previous"].includes(command))
      ) {
        return;
      }

      switch (command) {
        case "increase-score":
        case "decrease-score":
          if (isDirectionalKeyboardTarget(event.target)) {
            return;
          }
          event.preventDefault();
          adjustViewerScore(command === "increase-score" ? 1 : -1);
          break;
        case "next":
          if (!hasNext || isDirectionalKeyboardTarget(event.target)) {
            return;
          }
          event.preventDefault();
          navigateAndPlayViewerVideo(1);
          break;
        case "previous":
          if (!hasPrevious || isDirectionalKeyboardTarget(event.target)) {
            return;
          }
          event.preventDefault();
          navigateAndPlayViewerVideo(-1);
          break;
        case "toggle-playback":
          if (
            (asset.mediaType !== "video" && !isControlledAnimation) ||
            isKeyboardActivationTarget(event.target)
          ) {
            return;
          }
          event.preventDefault();
          toggleViewerVideoPlayback();
          break;
        case "toggle-sound":
          if (asset.mediaType !== "video") {
            return;
          }
          event.preventDefault();
          toggleViewerSound();
          break;
        case "details":
          event.preventDefault();
          setKeyboardAnnouncement("Details opened");
          onToggleInfo();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    adjustViewerScore,
    asset.mediaType,
    isControlledAnimation,
    hasNext,
    hasPrevious,
    playbackBlocked,
    isInfoOpen,
    navigateAndPlayViewerVideo,
    onToggleInfo,
    toggleViewerSound,
    toggleViewerVideoPlayback
  ]);

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    suppressMediaClickRef.current = event.touches.length !== 1;

    if (optionsOpenRef.current || isInteractiveTarget(event.target)) {
      touchStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    touchStartRef.current =
      touch && event.touches.length === 1
        ? { x: touch.clientX, y: touch.clientY }
        : null;
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;

    if (!start || !touch) {
      return;
    }

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.hypot(deltaX, deltaY) > 12) suppressMediaClickRef.current = true;

    if (
      Math.abs(deltaX) < SWIPE_DISTANCE_PX ||
      Math.abs(deltaX) <= Math.abs(deltaY) * 1.2
    ) {
      return;
    }

    if (deltaX < 0 && hasNext) {
      navigateAndPlayViewerVideo(1);
    } else if (deltaX > 0 && hasPrevious) {
      navigateAndPlayViewerVideo(-1);
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          requestClose();
        }
      }}
    >
      <DialogContent
        ref={viewerDialogRef}
        className={[
          "viewer-dialog inset-0! top-0! left-0! h-dvh! w-screen! max-w-none! translate-x-0! translate-y-0! gap-0 rounded-none border-0 bg-black p-0 shadow-none sm:max-w-none!",
          controlsVisible ? "controls-visible" : "controls-hidden"
        ].join(" ")}
        showCloseButton={false}
        aria-describedby={undefined}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Space M I Escape"
        onEscapeKeyDown={(event) => {
          if (optionsOpenRef.current) {
            event.preventDefault();
            return;
          }
          if (document.fullscreenElement === viewerDialogRef.current) {
            event.preventDefault();
            void document.exitFullscreen().catch(() => undefined);
            return;
          }
          if (playbackBlocked || isInfoOpen) {
            event.preventDefault();
            return;
          }

          event.preventDefault();
          requestClose();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          viewerStageRef.current?.focus({ preventScroll: true });
        }}
        onFocusCapture={() => setControlsVisible(true)}
        onBlurCapture={hideControlsLater}
        onPointerMove={(event) => {
          if (
            event.pointerType !== "touch" &&
            (event.movementX !== 0 || event.movementY !== 0)
          )
            revealControls();
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          touchStartRef.current = null;
          suppressMediaClickRef.current = true;
        }}
      >
        <DialogTitle className="sr-only">{asset.name}</DialogTitle>

        <div
          className="viewer-actions viewer-chrome"
          aria-label="Viewer controls"
        >
          <Button
            className="media-overlay-button"
            size="icon"
            variant="outline"
            asChild
          >
            <a
              href={downloadUrl(asset.id)}
              aria-label={`Download ${asset.name}`}
            >
              <Download />
            </a>
          </Button>
          {onEditAsset ? (
            <Button
              className="media-overlay-button"
              size="icon"
              type="button"
              variant="outline"
              aria-label={`Edit ${asset.name}`}
              onClick={() => {
                revealControls();
                onEditAsset(asset);
              }}
            >
              <Pencil />
            </Button>
          ) : null}
          <ViewerViewOptions
            container={viewerDialogRef.current}
            open={optionsOpen}
            onOpenChange={changeOptionsOpen}
            useSavedFraming={useSavedFraming}
            onFramingChange={onFramingChange}
            highlightsOnly={highlightsOnly}
            hasHighlight={Boolean(asset.presentation?.highlight)}
            onHighlightsOnlyChange={onHighlightsOnlyChange}
          />
          <Button
            className="media-overlay-button"
            size="icon"
            type="button"
            variant="outline"
            aria-label={`Show info for ${asset.name}`}
            aria-pressed={isInfoOpen}
            onClick={onToggleInfo}
          >
            <Info />
          </Button>
          <DialogClose asChild>
            <Button
              className="media-overlay-button"
              size="icon"
              type="button"
              variant="outline"
              aria-label="Close viewer"
            >
              <X />
            </Button>
          </DialogClose>
        </div>

        {hasPrevious ? (
          <Button
            className="media-overlay-button viewer-nav viewer-nav-previous viewer-chrome"
            size="icon"
            type="button"
            variant="outline"
            aria-label="Previous media"
            onClick={() => navigateAndPlayViewerVideo(-1)}
          >
            <ChevronLeft />
          </Button>
        ) : null}

        <figure
          className="viewer-stage"
          role="presentation"
          onClick={(event) => {
            if (!isInteractiveTarget(event.target)) toggleControls();
          }}
        >
          <div
            className="viewer-fit-area"
            ref={attachViewerStage}
            tabIndex={-1}
          >
            <div
              className={[
                "viewer-media-frame",
                isMediaReady ? "is-ready" : "",
                isViewerImageReady ? "is-image-ready" : "",
                isViewerAnimationReady ? "is-animation-ready" : "",
                isViewerVideoVisible ? "is-video-ready" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              style={viewerMediaFrameStyle}
            >
              {isMediaLoading && isOpen ? <MediaLoadingBar /> : null}
              {asset.mediaType === "image" && !isViewerImagePosterFailed ? (
                <img
                  key={viewerPosterSource}
                  className="viewer-image-thumbnail"
                  src={viewerPosterSource}
                  style={mediaStyle}
                  alt=""
                  aria-hidden="true"
                  width={asset.width ?? undefined}
                  height={asset.height ?? undefined}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    const ready = () => {
                      if (
                        activeAssetIdRef.current !== asset.id ||
                        !image.isConnected ||
                        image.getAttribute("src") !== viewerPosterSource ||
                        image.naturalWidth === 0
                      )
                        return;
                      markMediaImageReady(viewerPosterSource);
                      setImagePosterState({
                        assetId: asset.id,
                        source: viewerPosterSource,
                        status: "ready"
                      });
                    };
                    void image.decode().then(ready, ready);
                  }}
                  onError={(event) => {
                    if (
                      activeAssetIdRef.current === asset.id &&
                      event.currentTarget.isConnected &&
                      event.currentTarget.getAttribute("src") ===
                        viewerPosterSource
                    )
                      setImagePosterState({
                        assetId: asset.id,
                        source: viewerPosterSource,
                        status: "error"
                      });
                  }}
                />
              ) : null}
              {isControlledAnimation ? (
                <ControlledAnimation
                  key={animationKey}
                  asset={effectiveAsset}
                  renditionKey={
                    effectiveAsset.presentation?.renditionKeys.full ?? ""
                  }
                  presentation={
                    applyPlaybackPreferences
                      ? presentation
                      : {
                          ...presentation,
                          playbackRate: 1,
                          loopMode: "repeat"
                        }
                  }
                  highlightsOnly={highlightsOnly}
                  paused={playbackBlocked || !isOpen}
                  controls
                  showRetry={false}
                  showError={false}
                  showPoster={false}
                  controlsClassName="viewer-video-controls video-controls--viewer viewer-chrome"
                  controlsContainer={viewerDialogRef.current}
                  onPlaybackReady={(value) => {
                    animationPlaybackRef.current = value;
                    if (value && controlsTimerRef.current === null)
                      hideControlsLater();
                  }}
                  defaultFit={defaultFit}
                  className="viewer-controlled-animation"
                  onExpand={
                    canPresentVideoFullscreen(viewerDialogRef.current, null)
                      ? handleFullscreen
                      : undefined
                  }
                  onInteractionChange={handleControlsInteraction}
                  onError={(error) => {
                    setAnimationFailure(error);
                    setFailedAnimationKey(animationKey);
                  }}
                  onReadyChange={(ready) => {
                    setReadyAnimationKey(ready ? animationDisplayKey : null);
                    if (ready) {
                      setFailedAnimationKey(null);
                      setAnimationFailure(null);
                    }
                  }}
                />
              ) : asset.mediaType === "image" &&
                viewerImageSource !== null &&
                !isViewerImageFailed ? (
                <img
                  key={`${viewerImageSource}:${retryAttempt}`}
                  className="viewer-image-original"
                  src={viewerImageSource}
                  style={mediaStyle}
                  alt={asset.name}
                  width={asset.width ?? undefined}
                  height={asset.height ?? undefined}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    const markReady = () => {
                      if (
                        activeAssetIdRef.current !== asset.id ||
                        !image.isConnected ||
                        image.getAttribute("src") !== viewerImageSource ||
                        image.naturalWidth === 0
                      )
                        return;
                      if (image.naturalWidth > 0 && image.naturalHeight > 0)
                        setDecodedMediaSize({
                          width: image.naturalWidth,
                          height: image.naturalHeight
                        });
                      markMediaImageReady(viewerImageSource);
                      setReadyImageSource(viewerImageSource);
                    };
                    void image.decode().then(markReady, markReady);
                  }}
                  onError={(event) => {
                    if (
                      activeAssetIdRef.current === asset.id &&
                      event.currentTarget.isConnected &&
                      event.currentTarget.getAttribute("src") ===
                        viewerImageSource
                    )
                      setFailedImageSource(viewerImageSource);
                  }}
                />
              ) : asset.mediaType === "video" ? (
                <>
                  {!isViewerPosterFailed && !isViewerVideoReady ? (
                    <img
                      key={viewerPosterSource}
                      className="viewer-video-poster"
                      style={mediaStyle}
                      src={viewerPosterSource}
                      alt=""
                      aria-hidden="true"
                      width={asset.width ?? undefined}
                      height={asset.height ?? undefined}
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        const assetId = asset.id;
                        const posterSource = viewerPosterSource;
                        const markPosterReady = () => {
                          if (
                            activeAssetIdRef.current !== assetId ||
                            !image.isConnected ||
                            image.naturalWidth === 0
                          ) {
                            return;
                          }

                          markMediaImageReady(posterSource);
                          setViewerPosterState({
                            assetId,
                            source: posterSource,
                            status: "ready"
                          });
                        };

                        void image
                          .decode()
                          .then(markPosterReady, markPosterReady);
                      }}
                      onError={(event) => {
                        if (
                          activeAssetIdRef.current === asset.id &&
                          event.currentTarget.isConnected
                        ) {
                          setViewerPosterState({
                            assetId: asset.id,
                            source: viewerPosterSource,
                            status: "error"
                          });
                        }
                      }}
                    />
                  ) : null}
                  <video
                    key={`${videoSource}:${retryAttempt}`}
                    ref={bindViewerVideo}
                    className="viewer-video"
                    src={videoSource || undefined}
                    style={mediaStyle}
                    width={asset.width ?? undefined}
                    height={asset.height ?? undefined}
                    controls={useNativeControls}
                    autoPlay
                    muted={variant === "bounce" || isViewerVideoMuted}
                    data-presentation-timeline={
                      variant === "highlight" && originalVideoFailed
                        ? "local"
                        : "source"
                    }
                    loop={variant !== "highlight"}
                    playsInline
                    preload="auto"
                    onPlay={() => {
                      if (nativeFullscreenRef.current || useNativeControls)
                        userPausedRef.current = false;
                    }}
                    onVolumeChange={(event) => {
                      setIsViewerVideoMuted(event.currentTarget.muted);
                    }}
                    onLoadStart={() => {
                      cancelPendingVideoReveal();
                      videoFrameRequestSequenceRef.current += 1;
                      setReadyVideoAssetId(null);
                    }}
                    onLoadedMetadata={(event) => {
                      if (
                        activeAssetIdRef.current !== asset.id ||
                        viewerVideoRef.current !== event.currentTarget
                      )
                        return;
                      const { videoHeight, videoWidth } = event.currentTarget;

                      if (videoWidth > 0 && videoHeight > 0) {
                        setDecodedMediaSize({
                          width: videoWidth,
                          height: videoHeight
                        });
                      }
                    }}
                    onLoadedData={(event) => {
                      if (presentedPlayback.isReady)
                        revealVideoAfterPresentedFrame(
                          event.currentTarget,
                          asset.id
                        );
                    }}
                    onPlaying={(event) => {
                      const systemControls =
                        nativeFullscreenRef.current || useNativeControls;
                      if (systemControls) userPausedRef.current = false;
                      if (
                        document.hidden ||
                        playbackBlockedRef.current ||
                        isClosingRef.current ||
                        (userPausedRef.current && !systemControls)
                      ) {
                        event.currentTarget.pause();
                        return;
                      }
                      revealVideoAfterPresentedFrame(
                        event.currentTarget,
                        asset.id
                      );
                      if (controlsTimerRef.current === null)
                        hideControlsLater();
                    }}
                    onSeeked={(event) => {
                      revealVideoAfterPresentedFrame(
                        event.currentTarget,
                        asset.id
                      );
                    }}
                    onError={(event) => {
                      cancelPendingVideoReveal();
                      videoFrameRequestSequenceRef.current += 1;
                      setReadyVideoAssetId(null);
                      if (variant === "bounce" && bounceCodec.tryFallback())
                        return;
                      if (variant === "highlight" && !originalVideoFailed) {
                        setOriginalVideoFailed(true);
                      } else {
                        setFailedVideoAssetId(asset.id);
                        if (variant === "bounce")
                          playbackFailure.diagnose(event.currentTarget);
                      }
                    }}
                  />
                </>
              ) : null}
            </div>
          </div>
        </figure>

        {asset.mediaType === "video" &&
        !isViewerVideoFailed &&
        !useNativeControls ? (
          <VideoControls
            className="viewer-video-controls video-controls--viewer viewer-chrome"
            playback={presentedPlayback.playback}
            minimumTime={presentedPlayback.minimumTime}
            sectionLabel={presentedPlayback.sectionLabel}
            hasAudio={
              presentedPlayback.hasAudio &&
              (capabilityState.capabilities?.hasAudio ?? true)
            }
            seekLabel={`Seek ${asset.name}`}
            onTogglePlayback={toggleViewerVideoPlayback}
            onToggleMuted={toggleViewerSound}
            onExpand={
              canPresentVideoFullscreen(
                viewerDialogRef.current,
                viewerVideoRef.current
              )
                ? handleFullscreen
                : undefined
            }
            expandLabel={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            expanded={isFullscreen}
            onInteractionChange={handleControlsInteraction}
          />
        ) : null}

        {bounceUnavailable ||
        bounceOverBudget ||
        isViewerVideoFailed ||
        isViewerImageFailed ||
        failedAnimationKey === animationKey ||
        capabilityState.error ? (
          <MediaErrorNotice
            message={failureNotice.message}
            placement="above-controls"
            onRetry={
              failureNotice.canRetry
                ? () => {
                    playbackFailure.clear();
                    setAnimationFailure(null);
                    capabilityState.retry();
                    setRetryAttempt((current) => current + 1);
                  }
                : undefined
            }
          />
        ) : null}

        {hasNext ? (
          <Button
            className="media-overlay-button viewer-nav viewer-nav-next viewer-chrome"
            size="icon"
            type="button"
            variant="outline"
            aria-label="Next media"
            onClick={() => navigateAndPlayViewerVideo(1)}
          >
            <ChevronRight />
          </Button>
        ) : null}

        {scoreFeedback?.assetId === asset.id ? (
          <div
            className={[
              "viewer-score-feedback",
              scoreFeedback.direction > 0 ? "is-increasing" : "is-decreasing",
              scoreFeedback.isExiting ? "is-exiting" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          >
            <span
              className="viewer-score-arrow"
              key={`direction-${scoreFeedback.direction}`}
            >
              {scoreFeedback.direction > 0 ? <ArrowUp /> : <ArrowDown />}
            </span>
            <span>Score</span>
            <strong key={`score-${scoreFeedback.id}`}>
              {scoreFeedback.score}
            </strong>
          </div>
        ) : null}

        <span className="sr-only" aria-live="polite">
          Viewing {asset.name}
        </span>
        <span className="sr-only" aria-live="polite">
          {keyboardAnnouncement}
        </span>
      </DialogContent>
    </Dialog>
  );
}

function mediaViewerFrameStyle(
  mediaSize: ViewerStageSize | null,
  stageSize: ViewerStageSize | null
): CSSProperties | undefined {
  if (
    !stageSize ||
    stageSize.width <= 0 ||
    stageSize.height <= 0 ||
    !mediaSize ||
    mediaSize.width <= 0 ||
    mediaSize.height <= 0
  ) {
    return undefined;
  }

  const mediaAspectRatio = mediaSize.width / mediaSize.height;
  const stageAspectRatio = stageSize.width / stageSize.height;
  const frameWidth =
    mediaAspectRatio >= stageAspectRatio
      ? stageSize.width
      : stageSize.height * mediaAspectRatio;
  const frameHeight =
    mediaAspectRatio >= stageAspectRatio
      ? stageSize.width / mediaAspectRatio
      : stageSize.height;

  return {
    width: `${Math.max(1, Math.floor(frameWidth))}px`,
    height: `${Math.max(1, Math.floor(frameHeight))}px`
  };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest("button, a, input, textarea, select, video[controls]")
    )
  );
}
