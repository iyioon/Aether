import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent as ReactTouchEvent
} from "react";
import { flushSync } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  LoaderCircle,
  X
} from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { panelExitDurationMs } from "../../lib/motion";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle
} from "../ui/dialog";
import { downloadUrl, mediaUrl, thumbnailUrl } from "./media-urls";

interface MediaViewerProps {
  asset: AssetRecord;
  hasNext: boolean;
  hasPrevious: boolean;
  isInfoOpen: boolean;
  onClose: () => void;
  onToggleInfo: () => void;
  onNext: () => void;
  onPrevious: () => void;
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

const CONTROL_HIDE_DELAY_MS = 1_800;
const SWIPE_DISTANCE_PX = 56;

export function MediaViewer({
  asset,
  hasNext,
  hasPrevious,
  isInfoOpen,
  onClose,
  onToggleInfo,
  onNext,
  onPrevious
}: MediaViewerProps) {
  const viewerStageRef = useRef<HTMLDivElement | null>(null);
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const touchStartRef = useRef<ViewerTouchStart | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [readyAssetId, setReadyAssetId] = useState<string | null>(null);
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
  const [viewerVideoSize, setViewerVideoSize] =
    useState<ViewerStageSize | null>(null);
  const storedMediaSize = useMemo<ViewerStageSize | null>(() => {
    if (!asset.width || !asset.height || asset.width <= 0 || asset.height <= 0) {
      return null;
    }

    return { width: asset.width, height: asset.height };
  }, [asset.height, asset.width]);
  const viewerMediaSize =
    asset.mediaType === "video"
      ? viewerVideoSize ?? storedMediaSize
      : storedMediaSize;
  const viewerMediaFrameStyle = useMemo(
    () => mediaViewerFrameStyle(viewerMediaSize, viewerStageSize),
    [viewerMediaSize, viewerStageSize]
  );
  const isViewerPosterSettled = viewerPosterState?.assetId === asset.id;
  const isViewerPosterReady =
    isViewerPosterSettled && viewerPosterState.status === "ready";
  const isViewerVideoReady = readyVideoAssetId === asset.id;
  const isViewerVideoFailed = failedVideoAssetId === asset.id;
  const isMediaReady =
    asset.mediaType === "image"
      ? readyAssetId === asset.id
      : isViewerPosterReady ||
        (isViewerPosterSettled &&
          (isViewerVideoReady || isViewerVideoFailed));
  const isViewerVideoVisible =
    isViewerPosterSettled && isViewerVideoReady;

  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
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
      setControlsVisible(false);
    }, CONTROL_HIDE_DELAY_MS);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    hideControlsLater();
  }, [hideControlsLater]);

  const playViewerVideo = useCallback(() => {
    viewerVideoRef.current?.play().catch(() => undefined);
  }, []);

  const navigateAndPlayViewerVideo = useCallback(
    (direction: -1 | 1) => {
      flushSync(() => {
        if (direction > 0) {
          onNext();
        } else {
          onPrevious();
        }
      });

      revealControls();
      playViewerVideo();
      window.requestAnimationFrame(playViewerVideo);
    },
    [onNext, onPrevious, playViewerVideo, revealControls]
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
    if (!isInfoOpen) {
      hideControlsLater();
      return;
    }

    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    setControlsVisible(true);
  }, [hideControlsLater, isInfoOpen]);

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

  useEffect(() => {
    setViewerVideoSize(null);
  }, [asset.id]);

  useEffect(() => {
    if (asset.mediaType !== "video") {
      return;
    }

    const animationFrame = window.requestAnimationFrame(playViewerVideo);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [asset.id, asset.mediaType, playViewerVideo]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isInfoOpen || isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        navigateAndPlayViewerVideo(1);
      } else if (event.key === "ArrowLeft" && hasPrevious) {
        event.preventDefault();
        navigateAndPlayViewerVideo(-1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasNext, hasPrevious, isInfoOpen, navigateAndPlayViewerVideo]);

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    revealControls();

    if (isInteractiveTarget(event.target)) {
      touchStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
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
        className={[
          "viewer-dialog inset-0! top-0! left-0! h-dvh! w-screen! max-w-none! translate-x-0! translate-y-0! gap-0 rounded-none border-0 bg-black p-0 shadow-none sm:max-w-none!",
          controlsVisible ? "controls-visible" : "controls-hidden"
        ].join(" ")}
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (isInfoOpen) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          viewerStageRef.current?.focus({ preventScroll: true });
        }}
        onFocusCapture={() => setControlsVisible(true)}
        onPointerMove={revealControls}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <DialogTitle className="sr-only">{asset.name}</DialogTitle>

        <div
          className="viewer-actions viewer-chrome"
          aria-label="Viewer controls"
        >
          <Button className="media-overlay-button" size="icon" variant="outline" asChild>
            <a
              href={downloadUrl(asset.id)}
              aria-label={`Download ${asset.name}`}
            >
              <Download />
            </a>
          </Button>
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
          <div
            className="viewer-fit-area"
            ref={viewerStageRef}
            tabIndex={-1}
          >
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
              {asset.mediaType === "image" ? (
                <img
                  key={asset.id}
                  src={mediaUrl(asset.id)}
                  alt={asset.name}
                  width={asset.width ?? undefined}
                  height={asset.height ?? undefined}
                  onLoad={() => setReadyAssetId(asset.id)}
                  onError={() => setReadyAssetId(asset.id)}
                />
              ) : (
                <>
                  <img
                    className="viewer-video-poster"
                    src={thumbnailUrl(asset.id)}
                    alt=""
                    aria-hidden="true"
                    width={asset.width ?? undefined}
                    height={asset.height ?? undefined}
                    onLoad={() =>
                      setViewerPosterState({
                        assetId: asset.id,
                        status: "ready"
                      })
                    }
                    onError={() =>
                      setViewerPosterState({
                        assetId: asset.id,
                        status: "error"
                      })
                    }
                  />
                  <video
                    key={asset.id}
                    ref={viewerVideoRef}
                    className="viewer-video"
                    src={mediaUrl(asset.id)}
                    poster={thumbnailUrl(asset.id)}
                    width={asset.width ?? undefined}
                    height={asset.height ?? undefined}
                    controls
                    autoPlay
                    loop
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(event) => {
                      const { videoHeight, videoWidth } = event.currentTarget;

                      if (videoWidth > 0 && videoHeight > 0) {
                        setViewerVideoSize({
                          width: videoWidth,
                          height: videoHeight
                        });
                      }
                    }}
                    onLoadedData={() => {
                      setReadyVideoAssetId(asset.id);
                      playViewerVideo();
                    }}
                    onCanPlay={playViewerVideo}
                    onError={() => setFailedVideoAssetId(asset.id)}
                  />
                </>
              )}
            </div>
          </div>
        </figure>

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

        <span className="sr-only" aria-live="polite">
          Viewing {asset.name}
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

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, input, textarea, select, video"))
  );
}
