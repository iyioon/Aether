import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  type AssetRecord,
  type PresentationMediaCapabilities,
  type PresentationValues
} from "../../api/client";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { galleryAspectRatio } from "../gallery/gallery-layout";
import { PresentationFrame } from "./PresentationFrame";
import { PresentationFramingFields } from "./PresentationFramingFields";
import { PresentationPlaybackFields } from "./PresentationPlaybackFields";
import {
  defaultPresentationValues,
  getPresentationValues,
  presentationFramingForAspect,
  setPresentationFraming,
  presentationClamp,
  presentationRange,
  presentationValidationMessage,
  presentationValuesEqual,
  updatePresentationRange
} from "./presentation-model";
import { PresentationPreview } from "./PresentationPreview";
import type { AspectMode } from "../library-state";
import { PresentationTransport } from "./PresentationTransport";
import { PresentationEditorFooter } from "./PresentationEditorFooter";

export interface MediaPresentationPreviewProps {
  presentation: PresentationValues;
  playheadMs: number;
  isPlaying: boolean;
  onTimeChange: (ms: number) => void;
  onDurationChange: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackAvailableChange: (available: boolean) => void;
}

export interface MediaPresentationEditorProps {
  initialAspect?: AspectMode;
  originalFit?: "contain" | "cover";
  onPendingChange: (pending: boolean) => void;
  asset: AssetRecord;
  capabilities: PresentationMediaCapabilities;
  onSave: (
    values: PresentationValues,
    expectedRevision: number
  ) => Promise<AssetRecord>;
  onReload?: () => Promise<AssetRecord>;
  onClose: () => void;
}

interface PresentationEditorError {
  message: string;
  conflict: boolean;
  sourceChanged?: boolean;
}

function saveError(error: unknown): PresentationEditorError {
  if (error instanceof ApiError && error.status === 409) {
    return {
      message:
        error.code === "source_changed"
          ? "The source file changed. Close this editor and scan the library before editing again."
          : "These settings changed in another window. Reload them before saving.",
      conflict: true,
      sourceChanged: error.code === "source_changed"
    };
  }
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      bounce_duration_exceeded: "Choose a shorter highlight to use Bounce.",
      bounce_source_not_supported:
        "Bounce is unavailable for this file. Choose Repeat instead.",
      bounce_timing_not_supported:
        "This file’s timing cannot be used for Bounce. Choose Repeat instead.",
      highlight_duration_exceeded: "Choose a shorter highlight before saving.",
      presentation_timing_not_supported:
        "Playback editing is unavailable for this file.",
      presentation_limit_exceeded:
        "This file exceeds the playback editing limit. Framing is still available.",
      presentation_save_failed: "Could not save these edits. Try again."
    };
    const message = messages[error.code];
    if (message) return { message, conflict: false };
  }
  return {
    message: "Could not save these edits. Check your connection and try again.",
    conflict: false
  };
}

export function MediaPresentationEditor({
  asset,
  initialAspect = "Square",
  originalFit = "cover",
  onPendingChange,
  capabilities,
  onSave,
  onReload,
  onClose
}: MediaPresentationEditorProps) {
  const [original, setOriginal] = useState(() =>
    getPresentationValues(asset.presentation)
  );
  const [draft, setDraft] = useState(original);
  const [revision, setRevision] = useState(asset.presentation?.revision ?? 0);
  const [tab, setTab] = useState(
    capabilities.kind === "still" ? "framing" : "playback"
  );
  const [aspect, setAspect] = useState<AspectMode>(initialAspect);
  const framing = presentationFramingForAspect(
    draft,
    aspect,
    aspect === "Original" ? originalFit : "cover"
  );
  const framedDraft = {
    ...draft,
    ...framing,
    ...(framing.fit === "contain" ? { focalX: 0.5, focalY: 0.5, zoom: 1 } : {})
  };
  function changeFraming(values: PresentationValues) {
    setDraft((current) => setPresentationFraming(current, aspect, values));
  }
  const aspectRatio =
    aspect === "Original"
      ? (capabilities.width ?? asset.width ?? 1) /
        (capabilities.height ?? asset.height ?? 1)
      : galleryAspectRatio(aspect);
  const [playheadMs, setPlayheadMs] = useState(draft.highlight?.startMs ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackAvailable, setPlaybackAvailable] = useState(true);
  const [observedDuration, setObservedDuration] = useState(0);
  const [invalidFields, setInvalidFields] = useState({
    start: false,
    end: false
  });
  const [pending, setPending] = useState<"save" | "reload" | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const pendingRef = useRef(false);
  const activeRef = useRef(true);
  const [error, setError] = useState<PresentationEditorError | null>(null);
  const timed = capabilities.kind !== "still";
  const duration =
    capabilities.durationMs ??
    (observedDuration > 0 ? observedDuration : asset.durationMs);
  const durationMs =
    duration !== null && Number.isFinite(duration)
      ? Math.max(0, Math.round(duration))
      : 0;
  const [startMs, endMs] = presentationRange(draft, durationMs);
  const disabled = pending !== null;
  const unsupportedTemporal =
    capabilities.timingUnavailable &&
    (draft.highlight !== null ||
      draft.loopMode !== "repeat" ||
      draft.playbackRate !== 1);
  const validation = unsupportedTemporal
    ? "Reset these edits before saving new framing."
    : timed
      ? presentationValidationMessage(
          draft,
          durationMs,
          capabilities.maxBounceDurationMs,
          capabilities.maxHighlightDurationMs
        )
      : null;
  const dirty = !presentationValuesEqual(draft, original);
  const canReset =
    !presentationValuesEqual(draft, defaultPresentationValues()) ||
    invalidFields.start ||
    invalidFields.end;
  const canSave =
    dirty &&
    !disabled &&
    !validation &&
    !invalidFields.start &&
    !invalidFields.end &&
    !error?.conflict;

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        setIsPlaying(false);
      }
    };
    const pagehide = () => setIsPlaying(false);
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", pagehide);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("pagehide", pagehide);
    };
  }, []);

  function changeRange(start: number, end: number) {
    setDraft((current) =>
      updatePresentationRange(current, start, end, durationMs)
    );
    setPlayheadMs((current) => presentationClamp(current, start, end));
    setError((current) => (current?.conflict ? current : null));
  }

  async function save() {
    if (!canSave || pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    onPendingChange(true);
    setPending("save");
    setIsPlaying(false);
    setError(null);
    try {
      await onSave(draft, revision);
      if (activeRef.current) {
        onClose();
      }
    } catch (failure) {
      if (activeRef.current) {
        setError(saveError(failure));
      }
    } finally {
      pendingRef.current = false;
      onPendingChange(false);
      if (activeRef.current) {
        setPending(null);
      }
    }
  }

  async function reload() {
    if (!onReload || pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    onPendingChange(true);
    setPending("reload");
    setIsPlaying(false);
    try {
      const latest = await onReload();
      if (activeRef.current) {
        const values = getPresentationValues(latest.presentation);
        setResetKey((current) => current + 1);
        setOriginal(values);
        setDraft(values);
        setRevision(latest.presentation?.revision ?? 0);
        setPlayheadMs(values.highlight?.startMs ?? 0);
        setInvalidFields({ start: false, end: false });
        setError(null);
      }
    } catch {
      if (activeRef.current) {
        setError({
          message:
            "Could not reload saved settings. Check your connection and try again.",
          conflict: true
        });
      }
    } finally {
      pendingRef.current = false;
      onPendingChange(false);
      if (activeRef.current) {
        setPending(null);
      }
    }
  }

  const framingFields = (
    <PresentationFramingFields
      draft={framedDraft}
      aspect={aspect}
      disabled={disabled}
      onAspectChange={setAspect}
      onChange={changeFraming}
    />
  );

  return (
    <>
      <div className="media-editor-body">
        <div className="media-editor-preview">
          <PresentationFrame
            values={framedDraft}
            source={{
              width: capabilities.width ?? asset.width ?? 1,
              height: capabilities.height ?? asset.height ?? 1
            }}
            aspect={aspectRatio}
            editing={tab === "framing"}
            disabled={disabled}
            onChange={changeFraming}
          >
            <PresentationPreview
              asset={asset}
              capabilities={capabilities}
              presentation={framedDraft}
              playheadMs={playheadMs}
              isPlaying={isPlaying}
              onTimeChange={setPlayheadMs}
              onDurationChange={setObservedDuration}
              onPlayingChange={setIsPlaying}
              onPlaybackAvailableChange={setPlaybackAvailable}
            />
          </PresentationFrame>
          {timed ? (
            <PresentationTransport
              durationMs={durationMs}
              playheadMs={playheadMs}
              isPlaying={isPlaying}
              disabled={disabled || !playbackAvailable}
              onPlayingChange={(playing) => {
                if (playing && (playheadMs < startMs || playheadMs >= endMs))
                  setPlayheadMs(startMs);
                setIsPlaying(playing);
              }}
              onSeek={setPlayheadMs}
            />
          ) : null}
        </div>
        <div className="media-editor-inspector">
          {timed ? (
            <Tabs
              value={tab}
              className="media-editor-tabs"
              onValueChange={setTab}
            >
              <TabsList aria-label="Media editing sections">
                <TabsTrigger value="playback">Playback</TabsTrigger>
                <TabsTrigger value="framing">Framing</TabsTrigger>
              </TabsList>
              <TabsContent
                value="playback"
                forceMount
                hidden={tab !== "playback"}
              >
                <PresentationPlaybackFields
                  draft={draft}
                  durationMs={durationMs}
                  maxBounceDurationMs={capabilities.maxBounceDurationMs}
                  disabled={disabled}
                  bouncePreviewDeferred={capabilities.kind === "video"}
                  playheadMs={playheadMs}
                  resetKey={resetKey}
                  onRangeChange={changeRange}
                  onChange={setDraft}
                  onInvalidChange={(field, invalid) =>
                    setInvalidFields((current) => ({
                      ...current,
                      [field]: invalid
                    }))
                  }
                />
              </TabsContent>
              <TabsContent
                value="framing"
                forceMount
                hidden={tab !== "framing"}
              >
                {framingFields}
              </TabsContent>
            </Tabs>
          ) : (
            framingFields
          )}
          {capabilities.timingUnavailable ? (
            <p className="media-editor-unavailable" role="status">
              Playback editing is unavailable for this file.
            </p>
          ) : null}
          {invalidFields.start || invalidFields.end ? (
            <p className="media-editor-error" role="alert">
              Enter a valid time within the selected range.
            </p>
          ) : null}
          {validation ? (
            <p className="media-editor-error" role="alert">
              {validation}
            </p>
          ) : null}
          {error ? (
            <div className="media-editor-error" role="alert">
              <p>{error.message}</p>
              {error.conflict && !error.sourceChanged && onReload ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending !== null}
                  onClick={reload}
                >
                  Reload saved settings
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <PresentationEditorFooter
        pending={pending}
        canReset={!disabled && canReset}
        canSave={canSave}
        onClose={onClose}
        onSave={() => void save()}
        onReset={() => {
          setResetKey((current) => current + 1);
          setDraft(defaultPresentationValues());
          setPlayheadMs(0);
          setIsPlaying(false);
          setInvalidFields({ start: false, end: false });
        }}
      />
    </>
  );
}
