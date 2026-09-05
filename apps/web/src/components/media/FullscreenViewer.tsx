import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Info, X } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { IconButton } from "../ui/IconButton";
import { downloadUrl, mediaUrl, thumbnailUrl } from "./media-urls";

interface FullscreenViewerProps {
  asset: AssetRecord;
  hasNext: boolean;
  hasPrevious: boolean;
  isInfoOpen: boolean;
  onClose: () => void;
  onOpenInfo: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

type ViewerStageSize = {
  width: number;
  height: number;
};

export function FullscreenViewer({
  asset,
  hasNext,
  hasPrevious,
  isInfoOpen,
  onClose,
  onOpenInfo,
  onNext,
  onPrevious
}: FullscreenViewerProps) {
  const viewerStageRef = useRef<HTMLDivElement | null>(null);
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);
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
  const playViewerVideo = useCallback(() => {
    const video = viewerVideoRef.current;

    if (!video) {
      return;
    }

    video.play().catch(() => undefined);
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

      playViewerVideo();
      window.requestAnimationFrame(playViewerVideo);
    },
    [onNext, onPrevious, playViewerVideo]
  );

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

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [asset.id, asset.mediaType, playViewerVideo]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isInfoOpen) {
        return;
      }

      if (event.target instanceof HTMLInputElement) {
        if (event.key === "Escape") {
          onClose();
        }
        return;
      }

      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowRight" && hasNext) {
        navigateAndPlayViewerVideo(1);
      } else if (event.key === "ArrowLeft" && hasPrevious) {
        navigateAndPlayViewerVideo(-1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    hasNext,
    hasPrevious,
    isInfoOpen,
    navigateAndPlayViewerVideo,
    onClose
  ]);

  const viewerClassName =
    asset.mediaType === "video"
      ? "viewer-backdrop viewer-video"
      : "viewer-backdrop";

  return (
    <div
      className={viewerClassName}
      role="dialog"
      aria-label={`${asset.name} viewer`}
      aria-modal="true"
    >
      <div className="viewer-topbar" aria-label="Viewer controls">
        <div className="viewer-actions">
          <a
            className="icon-link"
            href={downloadUrl(asset.id)}
            aria-label={`Download ${asset.name}`}
            title="Download"
          >
            <Download size={18} />
          </a>
          <IconButton
            aria-haspopup="dialog"
            icon={Info}
            iconSize={18}
            label={`Show info for ${asset.name}`}
            title="Info"
            onClick={onOpenInfo}
          />
          <button
            className="icon-button"
            type="button"
            aria-label="Close viewer"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
      </div>

      <button
        className="viewer-nav previous"
        type="button"
        aria-label="Previous media"
        disabled={!hasPrevious}
        onClick={() => navigateAndPlayViewerVideo(-1)}
      >
        <ChevronLeft size={24} />
      </button>

      <figure className="viewer-stage">
        <div className="viewer-fit-area" ref={viewerStageRef}>
          <div className="viewer-media-frame" style={viewerMediaFrameStyle}>
            {asset.mediaType === "image" ? (
              <img
                src={mediaUrl(asset.id)}
                alt={asset.name}
                width={asset.width ?? undefined}
                height={asset.height ?? undefined}
              />
            ) : (
              <video
                key={asset.id}
                ref={viewerVideoRef}
                src={mediaUrl(asset.id)}
                poster={thumbnailUrl(asset.id)}
                width={asset.width ?? undefined}
                height={asset.height ?? undefined}
                controls
                autoPlay
                loop
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const { videoHeight, videoWidth } = event.currentTarget;

                  if (videoWidth <= 0 || videoHeight <= 0) {
                    return;
                  }

                  setViewerVideoSize((current) =>
                    current?.width === videoWidth &&
                    current.height === videoHeight
                      ? current
                      : { width: videoWidth, height: videoHeight }
                  );
                }}
                onLoadedData={playViewerVideo}
                onCanPlay={playViewerVideo}
              />
            )}
          </div>
        </div>
      </figure>

      <button
        className="viewer-nav next"
        type="button"
        aria-label="Next media"
        disabled={!hasNext}
        onClick={() => navigateAndPlayViewerVideo(1)}
      >
        <ChevronRight size={24} />
      </button>
    </div>
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
