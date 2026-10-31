import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import {
  getAnimationManifest,
  type AnimationManifest,
  type AssetRecord,
  type PresentationValues
} from "../../api/client";
import { animationAtlasCache } from "./animation-atlas-cache";
import { validateAnimationManifest } from "./animation-manifest";
import {
  animationSourceFrame,
  animationPresentationKey,
  animationTimelineFrame,
  animationTimelinePosition,
  animationTimelineTime,
  createAnimationTimeline
} from "./animation-timeline";
import { thumbnailUrl } from "./media-urls";
import { presentationMediaStyle } from "./presentation-geometry";
import { presentationPosterUrl } from "./presentation-playback";
import { EMPTY_VIDEO_PLAYBACK_STATE } from "./video-playback";
import { VideoControls } from "./VideoControls";
import type { VideoPlayback } from "./useVideoPlayback";
import { MediaLoadingBar } from "./MediaLoadingBar";
import { MediaErrorNotice } from "./MediaErrorNotice";
import { mediaFailureNotice } from "./media-failure-notice";

export interface ControlledAnimationProps {
  asset: AssetRecord;
  renditionKey: string;
  presentation: PresentationValues;
  highlightsOnly?: boolean;
  active?: boolean;
  paused?: boolean;
  controls?: boolean;
  showRetry?: boolean;
  showError?: boolean;
  showPoster?: boolean;
  defaultFit?: "contain" | "cover";
  className?: string;
  controlsClassName?: string;
  controlsContainer?: HTMLElement | null;
  noticeContainer?: HTMLElement | null;
  style?: CSSProperties;
  maxCanvasDimension?: number;
  playheadMs?: number;
  isPlaying?: boolean;
  onTimeChange?: (timeMs: number) => void;
  onDurationChange?: (durationMs: number) => void;
  onError?: (error?: unknown) => void;
  onRetry?: () => void;
  onReady?: () => void;
  onReadyChange?: (ready: boolean) => void;
  onExpand?: () => void;
  onInteractionChange?: (active: boolean) => void;
  onPlaybackReady?: (playback: VideoPlayback | null) => void;
}

export function ControlledAnimation({
  asset,
  renditionKey,
  presentation,
  highlightsOnly = false,
  active = true,
  paused = false,
  controls = false,
  showRetry = controls,
  showError = true,
  showPoster = true,
  defaultFit = "cover",
  className = "",
  controlsClassName,
  controlsContainer,
  noticeContainer,
  style,
  maxCanvasDimension,
  playheadMs,
  isPlaying,
  onTimeChange,
  onDurationChange,
  onError,
  onRetry,
  onReady,
  onReadyChange,
  onExpand,
  onInteractionChange,
  onPlaybackReady
}: ControlledAnimationProps) {
  const sourceKey = `${asset.id}:${renditionKey}`;
  const displayKey = animationPresentationKey(
    sourceKey,
    presentation.highlight,
    highlightsOnly
  );
  const displayKeyRef = useRef(displayKey);
  displayKeyRef.current = displayKey;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef<{ key: string; manifest: AnimationManifest } | null>(
    null
  );
  const [loaded, setLoaded] = useState<{
    key: string;
    manifest: AnimationManifest;
  } | null>(null);
  const manifest = loaded?.key === sourceKey ? loaded.manifest : null;
  const [errorKey, setErrorKey] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [paintedKey, setPaintedKey] = useState("");
  const [failedPosterSource, setFailedPosterSource] = useState<string | null>(
    null
  );
  const [userPaused, setUserPaused] = useState(false);
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.hidden
  );
  const workControllersRef = useRef(new Set<AbortController>());
  const [state, setState] = useState(EMPTY_VIDEO_PLAYBACK_STATE);
  const callbacksRef = useRef({
    onTimeChange,
    onDurationChange,
    onError,
    onReady,
    onReadyChange,
    onPlaybackReady
  });
  callbacksRef.current = {
    onTimeChange,
    onDurationChange,
    onError,
    onReady,
    onReadyChange,
    onPlaybackReady
  };
  const paintedSourceRef = useRef("");
  const controlledTimeRef = useRef(playheadMs);
  controlledTimeRef.current = playheadMs;
  const sourceTimeRef = useRef(0);
  const clockRef = useRef({ key: "", elapsed: 0 });
  const publishedTimeRef = useRef<number | null>(null);
  const seekRef = useRef<(timeMs: number) => void>(() => undefined);
  const highlightStart = presentation.highlight?.startMs ?? null;
  const highlightEnd = presentation.highlight?.endMs ?? null;
  const loopMode = presentation.loopMode;
  const playbackRate = presentation.playbackRate;
  const running = active && !hidden && !paused && (isPlaying ?? !userPaused);
  const runningRef = useRef(running);
  runningRef.current = running;
  const failed = errorKey === sourceKey;
  const painted = paintedKey === displayKey;
  const poster =
    presentationPosterUrl(asset, highlightsOnly) ?? thumbnailUrl(asset);
  const mediaStyle = {
    ...presentationMediaStyle(presentation, defaultFit),
    ...style
  };

  useLayoutEffect(() => {
    callbacksRef.current.onReadyChange?.(painted && active && !hidden);
    return () => callbacksRef.current.onReadyChange?.(false);
  }, [painted, active, hidden]);

  useEffect(() => {
    if (active && !hidden) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    paintedSourceRef.current = "";
    setPaintedKey("");
  }, [active, hidden]);

  useEffect(() => {
    const suspend = (value: boolean) => {
      if (value) {
        runningRef.current = false;
        for (const controller of workControllersRef.current) controller.abort();
      }
      setHidden(value);
    };
    const visibility = () => suspend(document.hidden);
    const pagehide = () => suspend(true);
    const pageshow = () => suspend(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    };
  }, []);

  useEffect(() => {
    if (!active || hidden) return;
    setFailure(null);
    const existing = loadedRef.current;
    if (existing?.key === sourceKey) {
      setLoaded(existing);
      setErrorKey("");
      return;
    }
    const controller = new AbortController();
    const workControllers = workControllersRef.current;
    workControllers.add(controller);
    sourceTimeRef.current = 0;
    publishedTimeRef.current = null;
    setUserPaused(false);
    setFailedPosterSource(null);
    setState(EMPTY_VIDEO_PLAYBACK_STATE);
    void getAnimationManifest(asset.id, renditionKey, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        const validated = validateAnimationManifest(
          value,
          asset.id,
          renditionKey,
          window.location.origin
        );
        const next = { key: sourceKey, manifest: validated };
        loadedRef.current = next;
        setLoaded(next);
        setErrorKey("");
        callbacksRef.current.onDurationChange?.(validated.durationMs);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFailure(error);
          setErrorKey(sourceKey);
          callbacksRef.current.onError?.(error);
        }
      });
    return () => {
      controller.abort();
      workControllers.delete(controller);
    };
  }, [active, hidden, asset.id, renditionKey, sourceKey, attempt]);

  useEffect(() => {
    if (!manifest || !active || hidden || failed) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) {
      setFailure(null);
      setErrorKey(sourceKey);
      callbacksRef.current.onError?.();
      return;
    }
    const scale =
      maxCanvasDimension && Number.isFinite(maxCanvasDimension)
        ? Math.min(
            1,
            Math.max(1, maxCanvasDimension) /
              Math.max(manifest.width, manifest.height)
          )
        : 1;
    const width = Math.max(1, Math.round(manifest.width * scale));
    const height = Math.max(1, Math.round(manifest.height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const controller = new AbortController();
    const workControllers = workControllersRef.current;
    workControllers.add(controller);
    const timeline = createAnimationTimeline(
      manifest,
      {
        highlight:
          highlightStart !== null && highlightEnd !== null
            ? { startMs: highlightStart, endMs: highlightEnd }
            : null,
        loopMode
      },
      highlightsOnly
    );
    const clockKey = `${sourceKey}:${timeline.startMs}:${timeline.endMs}:${loopMode}:${highlightsOnly}`;
    let elapsed =
      clockRef.current.key === clockKey
        ? clockRef.current.elapsed
        : animationTimelinePosition(
            timeline,
            animationSourceFrame(manifest, sourceTimeRef.current)
          );
    let previousTimestamp = performance.now();
    let frameRequest = 0;
    let latestFrame = -1;
    let lastDrawn = -1;
    let drawing = false;
    let waiting = true;
    let lastPublished = -Infinity;
    let firstPaint = false;
    let broken = false;
    const preloads = new Set<number>();
    const rate = playbackRate;

    function publish(timeMs: number, force = false) {
      if (displayKeyRef.current !== displayKey) return;
      sourceTimeRef.current = timeMs;
      const now = performance.now();
      if (!force && now - lastPublished < 125) return;
      lastPublished = now;
      if (controls)
        setState({
          available: paintedSourceRef.current === displayKey,
          paused: !runningRef.current,
          muted: true,
          currentTime: timeMs / 1000,
          duration: timeline.endMs / 1000,
          bufferedEnd: timeMs / 1000,
          seekable: true,
          error: false
        });
      if (callbacksRef.current.onTimeChange) {
        publishedTimeRef.current = timeMs;
        callbacksRef.current.onTimeChange(timeMs);
      }
    }

    function drawCurrent() {
      if (
        controller.signal.aborted ||
        displayKeyRef.current !== displayKey ||
        broken ||
        drawing ||
        latestFrame === lastDrawn
      )
        return;
      const frame = manifest!.frames[latestFrame];
      if (!frame) return;
      const descriptor = manifest!.atlases[frame.atlas]!;
      drawing = true;
      waiting = true;
      void animationAtlasCache
        .use(descriptor, controller.signal, (atlas) => {
          const current = manifest!.frames[latestFrame];
          if (
            controller.signal.aborted ||
            displayKeyRef.current !== displayKey ||
            !current ||
            current.atlas !== frame.atlas
          )
            return;
          context!.clearRect(0, 0, width, height);
          context!.drawImage(
            atlas.image,
            current.x,
            current.y,
            current.width,
            current.height,
            0,
            0,
            width,
            height
          );
          lastDrawn = latestFrame;
          waiting = false;
          if (!firstPaint) {
            firstPaint = true;
            paintedSourceRef.current = displayKey;
            setPaintedKey(displayKey);
            callbacksRef.current.onReady?.();
            publish(sourceTimeRef.current, true);
          }
        })
        .catch((error: unknown) => {
          if (
            !controller.signal.aborted &&
            displayKeyRef.current === displayKey
          ) {
            broken = true;
            setFailure(error);
            setErrorKey(sourceKey);
            callbacksRef.current.onError?.(error);
          }
        })
        .finally(() => {
          drawing = false;
          if (
            !controller.signal.aborted &&
            displayKeyRef.current === displayKey &&
            !broken &&
            latestFrame !== lastDrawn
          )
            drawCurrent();
        });
    }

    function display(index: number) {
      latestFrame = index;
      drawCurrent();
    }

    function seek(timeMs: number) {
      const time = Number.isFinite(timeMs)
        ? Math.max(0, Math.min(manifest!.durationMs - 1, timeMs))
        : 0;
      const index = animationSourceFrame(manifest!, time);
      const timelinePosition = animationTimelinePosition(timeline, index);
      const selectedFrame = timeline.frames.find(
        (frame) => frame.frameIndex === index
      );
      elapsed =
        timelinePosition +
        (selectedFrame
          ? Math.max(
              0,
              Math.min(
                selectedFrame.durationMs - 1,
                time - selectedFrame.startMs
              )
            )
          : 0);
      previousTimestamp = performance.now();
      sourceTimeRef.current = time;
      display(index);
      publish(time, true);
    }
    seekRef.current = seek;
    const externalSeek =
      controlledTimeRef.current !== undefined &&
      controlledTimeRef.current !== publishedTimeRef.current;
    const initial = externalSeek
      ? controlledTimeRef.current!
      : Math.max(
          timeline.startMs,
          Math.min(timeline.endMs - 1, sourceTimeRef.current)
        );
    if (clockRef.current.key === clockKey && !externalSeek) {
      display(animationSourceFrame(manifest, sourceTimeRef.current));
    } else seek(initial);

    function tick(timestamp: number) {
      if (controller.signal.aborted || displayKeyRef.current !== displayKey)
        return;
      if (!waiting && runningRef.current)
        elapsed += Math.max(0, timestamp - previousTimestamp) * rate;
      previousTimestamp = timestamp;
      const frame = animationTimelineFrame(timeline, elapsed);
      display(frame.frameIndex);
      const sourceFrame = manifest!.frames[frame.frameIndex]!;
      publish(animationTimelineTime(timeline, elapsed));
      // Prepare only the next two distinct atlases near a boundary.
      const position = timeline.frames.indexOf(frame);
      for (let ahead = 1; ahead <= 2; ahead += 1) {
        const next =
          timeline.frames[(position + ahead) % timeline.frames.length];
        if (!next) continue;
        const atlas = manifest!.frames[next.frameIndex]!.atlas;
        if (atlas === sourceFrame.atlas || preloads.has(atlas)) continue;
        preloads.add(atlas);
        void animationAtlasCache
          .use(manifest!.atlases[atlas]!, controller.signal, () => undefined)
          .catch(() => undefined)
          .finally(() => preloads.delete(atlas));
      }
      if (runningRef.current) frameRequest = requestAnimationFrame(tick);
    }
    if (running) frameRequest = requestAnimationFrame(tick);
    publish(initial, true);
    return () => {
      clockRef.current = { key: clockKey, elapsed };
      controller.abort();
      workControllers.delete(controller);
      cancelAnimationFrame(frameRequest);
      seekRef.current = () => undefined;
    };
  }, [
    manifest,
    active,
    hidden,
    failed,
    highlightsOnly,
    highlightStart,
    highlightEnd,
    loopMode,
    playbackRate,
    running,
    sourceKey,
    displayKey,
    maxCanvasDimension,
    controls
  ]);

  useEffect(() => {
    if (playheadMs !== undefined && playheadMs !== publishedTimeRef.current)
      seekRef.current(playheadMs);
  }, [playheadMs]);

  const playback: VideoPlayback = {
    state: {
      ...state,
      available: state.available && painted && !failed,
      paused: !running,
      error: failed
    },
    togglePlayback: () => {
      const next = runningRef.current;
      setUserPaused(next);
      return next;
    },
    toggleMuted: () => undefined,
    seek: (time) => seekRef.current(time * 1000)
  };
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  useEffect(() => {
    if (!manifest) return;
    const proxy: VideoPlayback = {
      get state() {
        return playbackRef.current.state;
      },
      togglePlayback: () => playbackRef.current.togglePlayback(),
      toggleMuted: () => undefined,
      seek: (time) => playbackRef.current.seek(time)
    };
    callbacksRef.current.onPlaybackReady?.(proxy);
    return () => callbacksRef.current.onPlaybackReady?.(null);
  }, [manifest]);

  const selected = highlightsOnly && presentation.highlight;
  const sectionLabel = selected
    ? presentation.loopMode === "bounce"
      ? "Highlight · Bounce"
      : "Highlight"
    : presentation.loopMode === "bounce" && !presentation.highlight
      ? "Bounce"
      : undefined;
  const transport = (
    <VideoControls
      playback={playback}
      className={controlsClassName}
      hasAudio={false}
      seekLabel="Seek animation"
      minimumTime={selected ? selected.startMs / 1000 : 0}
      sectionLabel={sectionLabel}
      onExpand={onExpand}
      onInteractionChange={onInteractionChange}
    />
  );
  const notice = mediaFailureNotice({ kind: "animation", error: failure });
  const errorNotice =
    failed && showError ? (
      <MediaErrorNotice
        message={notice.message}
        compact={!controls}
        onRetry={
          showRetry && notice.canRetry
            ? () => {
                setFailure(null);
                setErrorKey("");
                setAttempt((current) => current + 1);
                onRetry?.();
              }
            : undefined
        }
      />
    ) : null;
  return (
    <span
      className={`controlled-animation ${className}`.trim()}
      data-has-controls={controls || undefined}
    >
      {active && !hidden && !painted && !failed ? <MediaLoadingBar /> : null}
      {showPoster && !painted && failedPosterSource !== poster ? (
        <img
          className="controlled-animation__poster"
          src={poster}
          alt=""
          aria-hidden="true"
          style={mediaStyle}
          onError={() => setFailedPosterSource(poster)}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={asset.name}
        className="controlled-animation__canvas"
        style={{ ...mediaStyle, opacity: painted ? 1 : 0 }}
      />
      {noticeContainer && errorNotice
        ? createPortal(errorNotice, noticeContainer)
        : errorNotice}
      {controls
        ? controlsContainer
          ? createPortal(transport, controlsContainer)
          : transport
        : null}
    </span>
  );
}
