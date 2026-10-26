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
  LoaderCircle,
  SlidersVertical,
  X
} from "lucide-react";
import type { AssetRecord } from "../../api/client";
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
import { markMediaImageReady } from "./media-image-cache";
import { downloadUrl, mediaUrl, thumbnailUrl } from "./media-urls";
import { requestPresentedVideoFrame } from "./video-frame-presentation";
import { VideoControls } from "./VideoControls";
import { useVideoPlayback, type VideoPlayback } from "./useVideoPlayback";
import { usePresentationPreferences } from "./presentation-context";
import { usePresentationCapabilities } from "./usePresentationCapabilities";
import { getPresentationValues } from "./presentation-model";
import { presentationMediaStyle } from "./presentation-geometry";
import {
  playbackVariant,
  presentationPlaybackUrl,
  presentationPosterUrl
} from "./presentation-playback";
import { useVideoPresentation } from "./useVideoPresentation";
import { ControlledAnimation } from "./ControlledAnimation";
import {
  canPresentVideoFullscreen,
  toggleVideoFullscreen
} from "./video-fullscreen";

interface MediaViewerProps {
  asset: AssetRecord;
  presentationPlayback?: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  isInfoOpen: boolean;
  onClose: () => void;
  onScoreChange: (score: number) => void;
  onToggleInfo: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onEditAsset?: (asset: AssetRecord) => void;
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
  presentationPlayback = true,
  hasNext,
  hasPrevious,
  isInfoOpen,
  onClose,
  onScoreChange,
  onToggleInfo,
  onNext,
  onPrevious,
  onEditAsset
}: MediaViewerProps) {
  const { highlightsOnly: savedHighlightsOnly, isPlaybackPaused } =
    usePresentationPreferences();
  const highlightsOnly = presentationPlayback && savedHighlightsOnly;
  const playbackBlocked = isInfoOpen || isPlaybackPaused;
  const isAnimationCandidate =
    asset.mediaType === "image" &&
    /\.(gif|webp|png|apng|avif)$/i.test(asset.name);
  const capabilityState = usePresentationCapabilities(
    asset,
    (presentationPlayback &&
      asset.mediaType === "video" &&
      playbackVariant(asset, highlightsOnly) !== "full") ||
      isAnimationCandidate
  );
  const presentation = getPresentationValues(asset.presentation);
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
  const variant = presentationPlayback
    ? playbackVariant(effectiveAsset, highlightsOnly)
    : "full";
  const videoSource =
    variant === "full"
      ? mediaUrl(asset.id)
      : presentationPlaybackUrl(effectiveAsset, variant) || mediaUrl(asset.id);
  const isControlledAnimation =
    capabilityState.capabilities?.kind === "animation";
  const mediaStyle = presentationMediaStyle(presentation, "contain");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [failedAnimationKey, setFailedAnimationKey] = useState<string | null>(
    null
  );
  const animationKey = `${asset.id}:${effectiveAsset.presentation?.renditionKeys.full ?? ""}:${retryAttempt}`;
  const viewerStageRef = useRef<HTMLDivElement | null>(null);
  const viewerDialogRef = useRef<HTMLDivElement | null>(null);
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);
  const animationPlaybackRef = useRef<VideoPlayback | null>(null);
  const nativeFullscreenRef = useRef(false);
  const nativeFullscreenCleanupRef = useRef<(() => void) | null>(null);
  const userPausedRef = useRef(false);
  const resumeMutedPlaybackRef = useRef(false);
  const controlsInteractionRef = useRef(false);
  const isInfoOpenRef = useRef(playbackBlocked);
  isInfoOpenRef.current = playbackBlocked;
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
  const videoFrameRequestSequenceRef = useRef(0);
  const lastReadyVideoPosterSourceRef = useRef<string | null>(null);
  const previousViewedAssetRef = useRef({
    id: asset.id,
    mediaType: asset.mediaType
  });
  const [isOpen, setIsOpen] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isViewerVideoMuted, setIsViewerVideoMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useNativeControls, setUseNativeControls] = useState(false);
  const [readyAssetId, setReadyAssetId] = useState<string | null>(null);
  const [readyVideoAssetId, setReadyVideoAssetId] = useState<string | null>(
    null
  );
  const [failedVideoAssetId, setFailedVideoAssetId] = useState<string | null>(
    null
  );
  const [viewerPosterState, setViewerPosterState] =
    useState<ViewerPosterState | null>(null);
  const [fallbackVideoPosterSource, setFallbackVideoPosterSource] = useState<
    string | null
  >(null);
  const [viewerStageSize, setViewerStageSize] =
    useState<ViewerStageSize | null>(null);
  const [viewerVideoSize, setViewerVideoSize] =
    useState<ViewerStageSize | null>(null);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");
  const [scoreFeedback, setScoreFeedback] =
    useState<ViewerScoreFeedback | null>(null);
  const storedMediaSize = useMemo<ViewerStageSize | null>(() => {
    if (
      !asset.width ||
      !asset.height ||
      asset.width <= 0 ||
      asset.height <= 0
    ) {
      return null;
    }

    return { width: asset.width, height: asset.height };
  }, [asset.height, asset.width]);
  const viewerMediaSize =
    asset.mediaType === "video"
      ? (viewerVideoSize ?? storedMediaSize)
      : storedMediaSize;
  const viewerMediaFrameStyle = useMemo(
    () =>
      presentation.fit === "cover"
        ? { width: "100%", height: "100%" }
        : mediaViewerFrameStyle(viewerMediaSize, viewerStageSize),
    [presentation.fit, viewerMediaSize, viewerStageSize]
  );
  const viewerPosterSource =
    asset.mediaType === "video"
      ? (presentationPosterUrl(effectiveAsset, highlightsOnly) ??
        thumbnailUrl(asset.id))
      : "";
  const isViewerPosterSettled = viewerPosterState?.assetId === asset.id;
  const isViewerPosterReady =
    isViewerPosterSettled && viewerPosterState.status === "ready";
  const isViewerPosterFailed =
    isViewerPosterSettled && viewerPosterState.status === "error";
  const isViewerVideoReady = readyVideoAssetId === asset.id;
  const isViewerVideoFailed = failedVideoAssetId === asset.id;
  const hasFallbackVideoPoster =
    asset.mediaType === "video" &&
    fallbackVideoPosterSource !== null &&
    fallbackVideoPosterSource !== viewerPosterSource &&
    !isViewerPosterReady &&
    !isViewerVideoReady &&
    !(isViewerPosterFailed && isViewerVideoFailed);
  const isMediaReady =
    asset.mediaType === "image"
      ? isControlledAnimation || readyAssetId === asset.id
      : hasFallbackVideoPoster ||
        isViewerPosterReady ||
        isViewerVideoReady ||
        (isViewerPosterSettled && isViewerVideoFailed);
  const isViewerVideoVisible = isViewerVideoReady;
  const playback = useVideoPlayback({
    videoRef: viewerVideoRef,
    sourceKey: `${videoSource}:${retryAttempt}`,
    enabled: asset.mediaType === "video" && !isViewerVideoFailed
  });
  const presentedPlayback = useVideoPresentation(
    viewerVideoRef,
    playback,
    effectiveAsset,
    variant,
    presentationPlayback
  );
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
        isInfoOpenRef.current ||
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
      isInfoOpenRef.current ||
      isClosingRef.current
    ) {
      return;
    }

    const stillAllowed = () =>
      viewerVideoRef.current === video &&
      !userPausedRef.current &&
      !document.hidden &&
      !isInfoOpenRef.current &&
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
      if (direction > 0) {
        onNext();
      } else {
        onPrevious();
      }

      revealControls();
    },
    [onNext, onPrevious, revealControls]
  );

  useEffect(() => {
    revealControls();

    return () => {
      if (controlsTimerRef.current !== null) {
        window.clearTimeout(controlsTimerRef.current);
      }
    };
  }, [asset.id, revealControls]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!playbackBlocked) {
      hideControlsLater();
      return;
    }

    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    setControlsVisible(true);
  }, [hideControlsLater, playbackBlocked]);

  useEffect(() => {
    const stage = viewerStageRef.current;

    if (!stage) {
      return;
    }

    let animationFrame: number | null = null;
    const measureStage = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));

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
  }, []);

  useLayoutEffect(() => {
    const previousAsset = previousViewedAssetRef.current;
    const canReusePreviousPoster =
      previousAsset.mediaType === "video" &&
      asset.mediaType === "video" &&
      lastReadyVideoPosterSourceRef.current !== viewerPosterSource;

    setFallbackVideoPosterSource(
      canReusePreviousPoster ? lastReadyVideoPosterSourceRef.current : null
    );
    setViewerVideoSize(null);
    userPausedRef.current = false;
    nativeFullscreenRef.current = false;
    resumeMutedPlaybackRef.current = false;
    controlsInteractionRef.current = false;
    setUseNativeControls(false);
    setReadyVideoAssetId(null);
    setFailedVideoAssetId(null);
    setViewerPosterState(null);
    cancelPendingVideoReveal();
    videoFrameRequestSequenceRef.current += 1;
    previousViewedAssetRef.current = {
      id: asset.id,
      mediaType: asset.mediaType
    };
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
      if (document.hidden || isInfoOpenRef.current) return;
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
  }, [asset.id, asset.mediaType, playViewerVideo, videoSource, retryAttempt]);

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
    navigateAndPlayViewerVideo,
    onToggleInfo,
    toggleViewerSound,
    toggleViewerVideoPlayback
  ]);

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    revealControls();

    if (isInteractiveTarget(event.target)) {
      touchStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    touchStartRef.current = touch
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
          if (document.fullscreenElement === viewerDialogRef.current) {
            event.preventDefault();
            void document.exitFullscreen().catch(() => undefined);
            return;
          }
          if (playbackBlocked) {
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
        onPointerMove={revealControls}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
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
              <SlidersVertical />
            </Button>
          ) : null}
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

        <figure className="viewer-stage">
          <div className="viewer-fit-area" ref={viewerStageRef} tabIndex={-1}>
            {!isMediaReady ? (
              <div
                className="viewer-loading"
                role="status"
                aria-label="Loading media"
              >
                <LoaderCircle />
              </div>
            ) : null}
            <div
              className={[
                "viewer-media-frame",
                isMediaReady ? "is-ready" : "",
                isViewerVideoVisible ? "is-video-ready" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              style={viewerMediaFrameStyle}
            >
              {isControlledAnimation ? (
                <ControlledAnimation
                  key={animationKey}
                  asset={effectiveAsset}
                  renditionKey={
                    effectiveAsset.presentation?.renditionKeys.full ?? ""
                  }
                  presentation={
                    presentationPlayback
                      ? presentation
                      : {
                          ...presentation,
                          highlight: null,
                          playbackRate: 1,
                          loopMode: "repeat"
                        }
                  }
                  highlightsOnly={highlightsOnly}
                  paused={playbackBlocked || !isOpen}
                  controls
                  showRetry={false}
                  controlsClassName="viewer-video-controls video-controls--viewer viewer-chrome"
                  controlsContainer={viewerDialogRef.current}
                  onPlaybackReady={(value) => {
                    animationPlaybackRef.current = value;
                  }}
                  defaultFit="contain"
                  className="viewer-controlled-animation"
                  onExpand={
                    canPresentVideoFullscreen(viewerDialogRef.current, null)
                      ? handleFullscreen
                      : undefined
                  }
                  onInteractionChange={handleControlsInteraction}
                  onError={() => setFailedAnimationKey(animationKey)}
                />
              ) : asset.mediaType === "image" ? (
                <img
                  key={asset.id}
                  src={
                    isAnimationCandidate &&
                    capabilityState.capabilities?.kind !== "still"
                      ? thumbnailUrl(asset.id)
                      : mediaUrl(asset.id)
                  }
                  style={mediaStyle}
                  alt={asset.name}
                  width={asset.width ?? undefined}
                  height={asset.height ?? undefined}
                  onLoad={() => setReadyAssetId(asset.id)}
                  onError={() => setReadyAssetId(asset.id)}
                />
              ) : (
                <>
                  {hasFallbackVideoPoster ? (
                    <img
                      key={fallbackVideoPosterSource}
                      className="viewer-video-poster viewer-video-poster-fallback"
                      style={mediaStyle}
                      src={fallbackVideoPosterSource}
                      alt=""
                      aria-hidden="true"
                      onError={(event) => {
                        if (
                          activeAssetIdRef.current !== asset.id ||
                          !event.currentTarget.isConnected
                        ) {
                          return;
                        }

                        if (
                          lastReadyVideoPosterSourceRef.current ===
                          fallbackVideoPosterSource
                        ) {
                          lastReadyVideoPosterSourceRef.current = null;
                        }
                        setFallbackVideoPosterSource((current) =>
                          current === fallbackVideoPosterSource ? null : current
                        );
                      }}
                    />
                  ) : null}
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
                          lastReadyVideoPosterSourceRef.current = posterSource;
                          setViewerPosterState({
                            assetId,
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
                          if (
                            lastReadyVideoPosterSourceRef.current ===
                            viewerPosterSource
                          ) {
                            lastReadyVideoPosterSourceRef.current = null;
                          }
                          setViewerPosterState({
                            assetId: asset.id,
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
                    src={videoSource}
                    style={mediaStyle}
                    width={asset.width ?? undefined}
                    height={asset.height ?? undefined}
                    controls={useNativeControls}
                    autoPlay
                    muted={variant === "bounce" || isViewerVideoMuted}
                    loop
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
                      const { videoHeight, videoWidth } = event.currentTarget;

                      if (videoWidth > 0 && videoHeight > 0) {
                        setViewerVideoSize({
                          width: videoWidth,
                          height: videoHeight
                        });
                      }
                    }}
                    onPlaying={(event) => {
                      const systemControls =
                        nativeFullscreenRef.current || useNativeControls;
                      if (systemControls) userPausedRef.current = false;
                      if (
                        document.hidden ||
                        isInfoOpenRef.current ||
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
                      revealControls();
                    }}
                    onSeeked={(event) => {
                      revealVideoAfterPresentedFrame(
                        event.currentTarget,
                        asset.id
                      );
                    }}
                    onError={() => {
                      cancelPendingVideoReveal();
                      videoFrameRequestSequenceRef.current += 1;
                      setReadyVideoAssetId(null);
                      setFailedVideoAssetId(asset.id);
                    }}
                  />
                </>
              )}
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

        {isViewerVideoFailed ||
        failedAnimationKey === animationKey ||
        capabilityState.error ? (
          <div className="viewer-playback-error" role="status">
            {isViewerVideoFailed || capabilityState.error ? (
              <span>Playback could not be prepared.</span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                capabilityState.retry();
                setRetryAttempt((current) => current + 1);
              }}
            >
              Retry
            </Button>
          </div>
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
    Boolean(target.closest("button, a, input, textarea, select, video"))
  );
}
