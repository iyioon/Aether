import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ApiError,
  type AssetRecord,
  type PresentationMediaCapabilities,
  type PresentationValues
} from "../../api/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { createUuid } from "../../lib/uuid";
import { galleryAspectRatio } from "../gallery/gallery-layout";
import { PresentationFrame } from "./PresentationFrame";
import { PresentationFramingFields } from "./PresentationFramingFields";
import { PresentationPlaybackFields } from "./PresentationPlaybackFields";
import {
  defaultPresentationValues,
  getPresentationValues,
  getPresentationHighlights,
  selectPresentationHighlight,
  setMainPresentationHighlight,
  updatePresentationHighlight,
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
import { PresentationHighlightPicker } from "./PresentationHighlightPicker";
import {
  addPresentationHighlight,
  MAX_MEDIA_HIGHLIGHTS,
  removePresentationHighlight,
  renamePresentationHighlight
} from "./presentation-highlight-editor";

export interface MediaPresentationPreviewProps {
  presentation: PresentationValues;
  playheadMs: number;
  isPlaying: boolean;
  muted: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onTimeChange: (ms: number) => void;
  onDurationChange: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onMutedChange: (muted: boolean) => void;
  onPlaybackAvailableChange: (available: boolean) => void;
}

export interface MediaPresentationEditorProps {
  initialHighlightId?: string | null;
  initialAspect?: AspectMode;
  originalFit?: "contain" | "cover";
  onPendingChange: (pending: boolean) => void;
  asset: AssetRecord;
  unavailable?: boolean;
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
  if (
    error instanceof ApiError &&
    error.status === 404 &&
    ["asset_not_found", "asset_not_indexed"].includes(error.code)
  ) {
    return {
      message:
        "This media is no longer available. Close the editor and check the library.",
      conflict: true,
      sourceChanged: true
    };
  }
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
      processing_busy: "The server is busy. Try again in a moment.",
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
  unavailable = false,
  initialAspect = "Square",
  initialHighlightId,
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
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(
    () => {
      const items = getPresentationHighlights(original);
      return items.some((item) => item.id === initialHighlightId)
        ? initialHighlightId!
        : (original.mainHighlightId ?? items[0]?.id ?? null);
    }
  );
  const highlights = getPresentationHighlights(draft);
  const selectedHighlight = highlights.find(
    (highlight) => highlight.id === selectedHighlightId
  );
  const activeDraft = selectedHighlight
    ? selectPresentationHighlight(draft, selectedHighlight.id)
    : draft;
  const [revision, setRevision] = useState(asset.presentation?.revision ?? 0);
  const [tab, setTab] = useState(
    capabilities.kind === "still" ? "framing" : "playback"
  );
  const [aspect, setAspect] = useState<AspectMode>(initialAspect);
  const framing = presentationFramingForAspect(
    activeDraft,
    aspect,
    aspect === "Original" ? originalFit : "cover"
  );
  const framedDraft = {
    ...activeDraft,
    ...framing,
    ...(framing.fit === "contain" ? { focalX: 0.5, focalY: 0.5, zoom: 1 } : {})
  };
  function changeFraming(values: PresentationValues) {
    changeDraft(setPresentationFraming(activeDraft, aspect, values));
  }
  const aspectRatio =
    aspect === "Original"
      ? (capabilities.width ?? asset.width ?? 1) /
        (capabilities.height ?? asset.height ?? 1)
      : galleryAspectRatio(aspect);
  const [playheadMs, setPlayheadMs] = useState(
    activeDraft.highlight?.startMs ?? 0
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const hasAudio = capabilities.kind === "video" && capabilities.hasAudio;
  const silentPreview = activeDraft.loopMode === "bounce" || !hasAudio;
  const effectiveMuted = silentPreview || previewMuted;
  const [playbackAvailable, setPlaybackAvailable] = useState(true);
  const [observedDuration, setObservedDuration] = useState(0);
  const [invalidFields, setInvalidFields] = useState({
    start: false,
    end: false
  });
  const [pending, setPending] = useState<"save" | "reload" | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [previewAttempt, setPreviewAttempt] = useState(0);
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
  const [startMs, endMs] = presentationRange(activeDraft, durationMs);
  const disabled = pending !== null || unavailable;
  const unsupportedTemporal =
    capabilities.timingUnavailable &&
    (draft.highlight !== null ||
      draft.loopMode !== "repeat" ||
      draft.playbackRate !== 1);
  const validation = unsupportedTemporal
    ? "Reset these edits before saving new framing."
    : timed
      ? highlights.length
        ? highlights.reduce<string | null>((message, highlight) => {
            if (message) return message;
            if (!highlight.name.trim())
              return "Enter a name for each highlight.";
            const issue = presentationValidationMessage(
              highlight,
              durationMs,
              capabilities.maxBounceDurationMs,
              capabilities.maxHighlightDurationMs
            );
            return issue ? `${highlight.name.trim()}: ${issue}` : null;
          }, null)
        : presentationValidationMessage(
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
    changeDraft(updatePresentationRange(activeDraft, start, end, durationMs));
    setPlayheadMs((current) => presentationClamp(current, start, end));
    setError((current) => (current?.conflict ? current : null));
  }

  function changeDraft(next: PresentationValues) {
    if (selectedHighlight) {
      setDraft((current) =>
        updatePresentationHighlight(current, selectedHighlight.id, {
          ...next,
          highlight: next.highlight ?? { startMs: 0, endMs: durationMs }
        })
      );
    } else if (next.highlight) {
      const id = createUuid();
      const withHighlight = addPresentationHighlight(
        { ...next, highlights: [], mainHighlightId: null },
        durationMs,
        next.highlight.startMs,
        id
      );
      setDraft(updatePresentationHighlight(withHighlight, id, next));
      setSelectedHighlightId(id);
    } else setDraft(next);
  }

  function selectHighlight(id: string, values = draft) {
    const item = getPresentationHighlights(values).find(
      (highlight) => highlight.id === id
    );
    setSelectedHighlightId(item?.id ?? null);
    setPlayheadMs(item?.highlight.startMs ?? 0);
    setIsPlaying(false);
    setResetKey((current) => current + 1);
    setInvalidFields({ start: false, end: false });
  }

  function addHighlight() {
    const id = createUuid();
    const next = addPresentationHighlight(
      activeDraft,
      durationMs,
      playheadMs,
      id,
      Math.min(
        capabilities.maxHighlightDurationMs ?? Infinity,
        activeDraft.loopMode === "bounce"
          ? capabilities.maxBounceDurationMs
          : Infinity
      )
    );
    setDraft(next);
    selectHighlight(id, next);
  }

  function changePlaying(playing: boolean) {
    if (pendingRef.current) return;
    const video = previewVideoRef.current;
    if (playing) {
      if (playheadMs < startMs || playheadMs >= endMs) {
        setPlayheadMs(startMs);
        if (video) video.currentTime = startMs / 1000;
      }
      if (video) {
        video.muted = effectiveMuted;
        // Start in the button's user gesture; the preview reports any failure.
        void video.play().catch(() => undefined);
      }
    } else video?.pause();
    setIsPlaying(playing);
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
      const values = {
        ...draft,
        ...(draft.highlights
          ? {
              highlights: highlights.map((highlight) => ({
                ...highlight,
                name: highlight.name.trim()
              }))
            }
          : {})
      };
      setDraft(values);
      await onSave(values, revision);
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
        selectHighlight(values.mainHighlightId ?? "", values);
        setRevision(latest.presentation?.revision ?? 0);
        setPreviewAttempt((current) => current + 1);
        setObservedDuration(0);
        setPlaybackAvailable(true);
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
              key={`${asset.id}:${asset.mtimeMs}:${asset.sizeBytes}:${previewAttempt}`}
              asset={asset}
              capabilities={capabilities}
              presentation={framedDraft}
              playheadMs={playheadMs}
              isPlaying={isPlaying && !unavailable}
              muted={effectiveMuted}
              videoRef={previewVideoRef}
              onTimeChange={setPlayheadMs}
              onDurationChange={setObservedDuration}
              onPlayingChange={setIsPlaying}
              onMutedChange={(muted) => {
                if (!silentPreview) setPreviewMuted(muted);
              }}
              onPlaybackAvailableChange={setPlaybackAvailable}
            />
          </PresentationFrame>
          {timed ? (
            <PresentationTransport
              durationMs={durationMs}
              highlight={activeDraft.highlight}
              playheadMs={playheadMs}
              isPlaying={isPlaying}
              disabled={disabled || !playbackAvailable}
              hasAudio={hasAudio}
              muted={effectiveMuted}
              soundLocked={silentPreview}
              onToggleMuted={() => {
                if (silentPreview || pendingRef.current) return;
                const muted = !previewMuted;
                const video = previewVideoRef.current;
                if (video) {
                  if (!muted && video.volume === 0) video.volume = 1;
                  video.muted = muted;
                }
                setPreviewMuted(muted);
              }}
              onPlayingChange={changePlaying}
              onSeek={setPlayheadMs}
            />
          ) : null}
        </div>
        <div className="media-editor-inspector">
          {timed && !capabilities.timingUnavailable ? (
            <PresentationHighlightPicker
              highlights={highlights}
              selectedId={selectedHighlightId}
              mainId={draft.mainHighlightId ?? highlights[0]?.id ?? null}
              disabled={disabled}
              switchingDisabled={invalidFields.start || invalidFields.end}
              canAdd={
                durationMs > 0 && highlights.length < MAX_MEDIA_HIGHLIGHTS
              }
              onSelect={selectHighlight}
              onAdd={addHighlight}
              onNameChange={(name) => {
                if (selectedHighlightId)
                  setDraft((current) =>
                    renamePresentationHighlight(
                      current,
                      selectedHighlightId,
                      name
                    )
                  );
              }}
              onMakeMain={() => {
                if (selectedHighlightId)
                  setDraft((current) =>
                    setMainPresentationHighlight(current, selectedHighlightId)
                  );
              }}
              onRemove={() => {
                if (!selectedHighlightId) return;
                const index = highlights.findIndex(
                  (highlight) => highlight.id === selectedHighlightId
                );
                const next = removePresentationHighlight(
                  draft,
                  selectedHighlightId
                );
                const nextId =
                  highlights[index + 1]?.id ?? highlights[index - 1]?.id ?? "";
                setDraft(next);
                selectHighlight(nextId, next);
              }}
            />
          ) : null}
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
                  draft={activeDraft}
                  durationMs={durationMs}
                  maxBounceDurationMs={capabilities.maxBounceDurationMs}
                  disabled={disabled}
                  bouncePreviewDeferred={capabilities.kind === "video"}
                  playheadMs={playheadMs}
                  resetKey={resetKey}
                  onRangeChange={changeRange}
                  onPreviewSeek={(time) => {
                    setIsPlaying(false);
                    setPlayheadMs(time);
                  }}
                  onChange={changeDraft}
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
        </div>
      </div>
      <PresentationEditorFooter
        pending={pending}
        canReset={!disabled && canReset}
        canSave={canSave}
        message={
          unavailable
            ? "This media is no longer available. Close the editor to return to the library."
            : error?.conflict
              ? error.message
              : invalidFields.start || invalidFields.end
                ? "Enter a valid time within the selected range."
                : (validation ?? error?.message)
        }
        onReload={
          error?.conflict && !error.sourceChanged && onReload
            ? () => void reload()
            : undefined
        }
        onClose={onClose}
        onSave={() => void save()}
        onReset={() => {
          setResetKey((current) => current + 1);
          setDraft({
            ...defaultPresentationValues(),
            highlights: [],
            mainHighlightId: null
          });
          setSelectedHighlightId(null);
          setPlayheadMs(0);
          setIsPlaying(false);
          setInvalidFields({ start: false, end: false });
        }}
      />
    </>
  );
}
