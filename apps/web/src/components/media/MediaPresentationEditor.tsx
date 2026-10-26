import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import {
  ApiError,
  type AssetRecord,
  type PresentationMediaCapabilities,
  type PresentationValues
} from "../../api/client";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { PresentationFrame } from "./PresentationFrame";
import { PresentationFramingFields } from "./PresentationFramingFields";
import { PresentationPlaybackFields } from "./PresentationPlaybackFields";
import { presentationMediaStyle } from "./presentation-geometry";
import {
  defaultPresentationValues,
  getPresentationValues,
  presentationClamp,
  presentationRange,
  presentationValidationMessage,
  presentationValuesEqual,
  updatePresentationRange
} from "./presentation-model";
import { mediaUrl } from "./media-urls";

export interface MediaPresentationPreviewProps {
  presentation: PresentationValues;
  playheadMs: number;
  isPlaying: boolean;
  onTimeChange: (ms: number) => void;
  onDurationChange: (ms: number) => void;
}

export interface MediaPresentationEditorProps {
  asset: AssetRecord;
  capabilities: PresentationMediaCapabilities;
  isLoading?: boolean;
  onSave: (
    values: PresentationValues,
    expectedRevision: number
  ) => Promise<AssetRecord>;
  onReload?: () => Promise<AssetRecord>;
  onClose: () => void;
  renderPreview?: (props: MediaPresentationPreviewProps) => ReactNode;
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
  capabilities,
  isLoading = false,
  onSave,
  onReload,
  onClose,
  renderPreview
}: MediaPresentationEditorProps) {
  const descriptionId = useId();
  const [original, setOriginal] = useState(() =>
    getPresentationValues(asset.presentation)
  );
  const [draft, setDraft] = useState(original);
  const [revision, setRevision] = useState(asset.presentation?.revision ?? 0);
  const [tab, setTab] = useState(
    capabilities.kind === "still" ? "framing" : "playback"
  );
  const [aspect, setAspect] = useState("1");
  const [playheadMs, setPlayheadMs] = useState(draft.highlight?.startMs ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const disabled = pending !== null || isLoading;
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
      if (activeRef.current) {
        setPending(null);
      }
    }
  }

  const framingFields = (
    <PresentationFramingFields
      draft={draft}
      aspect={aspect}
      disabled={disabled}
      onAspectChange={setAspect}
      onChange={setDraft}
    />
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pendingRef.current) onClose();
      }}
    >
      <DialogContent
        className="media-editor"
        showCloseButton={false}
        aria-describedby={descriptionId}
        aria-busy={isLoading || pending !== null}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (pendingRef.current) event.preventDefault();
        }}
      >
        <header className="media-editor-header">
          <DialogTitle>Edit media</DialogTitle>
          <p id={descriptionId} title={asset.name}>
            {asset.name}
          </p>
        </header>
        <div className="media-editor-body">
          <PresentationFrame
            values={draft}
            source={{
              width: capabilities.width ?? asset.width ?? 1,
              height: capabilities.height ?? asset.height ?? 1
            }}
            aspect={Number(aspect)}
            editing={tab === "framing"}
            disabled={disabled}
            onChange={setDraft}
          >
            {renderPreview ? (
              renderPreview({
                presentation: draft,
                playheadMs,
                isPlaying,
                onTimeChange: setPlayheadMs,
                onDurationChange: setObservedDuration
              })
            ) : (
              <img
                src={mediaUrl(asset.id)}
                alt={asset.name}
                draggable={false}
                style={presentationMediaStyle(draft, "cover")}
              />
            )}
          </PresentationFrame>
          {timed ? (
            <Tabs
              value={tab}
              className="media-editor-tabs"
              onValueChange={(next) => {
                setTab(next);
                setInvalidFields({ start: false, end: false });
                setIsPlaying(false);
              }}
            >
              {timed ? (
                <TabsList aria-label="Media editing sections">
                  <TabsTrigger value="playback">Playback</TabsTrigger>
                  <TabsTrigger value="framing">Framing</TabsTrigger>
                </TabsList>
              ) : null}
              {timed ? (
                <TabsContent value="playback">
                  <PresentationPlaybackFields
                    draft={draft}
                    durationMs={durationMs}
                    maxBounceDurationMs={capabilities.maxBounceDurationMs}
                    disabled={disabled}
                    isLoading={isLoading}
                    bouncePreviewDeferred={capabilities.kind === "video"}
                    playheadMs={playheadMs}
                    isPlaying={isPlaying}
                    resetKey={resetKey}
                    onPlayingChange={(playing) => {
                      if (
                        playing &&
                        (playheadMs < startMs || playheadMs >= endMs)
                      )
                        setPlayheadMs(startMs);
                      setIsPlaying(playing);
                    }}
                    onSeek={setPlayheadMs}
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
              ) : null}
              <TabsContent value="framing">{framingFields}</TabsContent>
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
        <footer className="media-editor-footer">
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || !canReset}
            onClick={() => {
              setResetKey((current) => current + 1);
              setDraft(defaultPresentationValues());
              setPlayheadMs(0);
              setIsPlaying(false);
              setInvalidFields({ start: false, end: false });
            }}
          >
            <RotateCcw aria-hidden="true" />
            Reset
          </Button>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={pending !== null}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="button" disabled={!canSave} onClick={save}>
              {pending === "save" ? (
                <LoaderCircle
                  className="media-editor-spinner"
                  aria-hidden="true"
                />
              ) : null}
              {pending === "save" ? "Saving…" : "Save"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
