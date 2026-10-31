import { LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType
} from "react";
import {
  ApiError,
  getAsset,
  getPresentationMediaCapabilities,
  updateAssetPresentation,
  type AssetRecord,
  type PresentationMediaCapabilities,
  type PresentationValues
} from "../../api/client";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  getPresentationValues,
  presentationRenditionKeysEqual,
  presentationSaveOutcome,
  shouldEnableHighlightPlayback
} from "./presentation-model";
import type { AspectMode } from "../library-state";
import { PresentationEditorFooter } from "./PresentationEditorFooter";
import type { MediaPresentationEditorProps } from "./MediaPresentationEditor";

interface PresentationEditorDialogProps {
  asset: AssetRecord;
  initialAspect?: AspectMode;
  originalFit?: "contain" | "cover";
  onClose: () => void;
  onSaved: (asset: AssetRecord, useSavedPlayback: boolean) => void;
}

function unavailableCapabilities(
  asset: AssetRecord
): PresentationMediaCapabilities {
  return {
    kind: "still",
    timingUnavailable: true,
    durationMs: null,
    width: asset.width,
    height: asset.height,
    hasAudio: false,
    maxBounceDurationMs: 0,
    renditionKeys: asset.presentation?.renditionKeys ?? {
      full: "",
      highlight: "",
      bounce: ""
    }
  };
}

async function loadEditorCapabilities(assetId: string, signal: AbortSignal) {
  try {
    return await getPresentationMediaCapabilities(assetId, signal);
  } catch (failure) {
    if (failure instanceof ApiError && [415, 422].includes(failure.status))
      return null;
    throw failure;
  }
}

async function loadEditorSettings(assetId: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted();
    const [asset, capabilities] = await Promise.all([
      getAsset(assetId, signal),
      loadEditorCapabilities(assetId, signal)
    ]);
    if (
      !capabilities ||
      presentationRenditionKeysEqual(
        asset.presentation?.renditionKeys,
        capabilities.renditionKeys
      )
    )
      return {
        asset,
        capabilities: capabilities ?? unavailableCapabilities(asset)
      };
  }
  throw new ApiError(409, "presentation_conflict");
}

export function PresentationEditorDialog({
  asset,
  initialAspect,
  originalFit,
  onClose,
  onSaved
}: PresentationEditorDialogProps) {
  const descriptionId = useId();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const onPendingChange = useCallback((busy: boolean) => {
    pendingRef.current = busy;
    setPending(busy);
  }, []);
  const [loaded, setLoaded] = useState<{
    asset: AssetRecord;
    capabilities: PresentationMediaCapabilities;
    Editor: ComponentType<MediaPresentationEditorProps>;
  } | null>(null);
  const [error, setError] = useState<"settings" | "tools" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const uncertain = useRef(false);
  const active = useRef(true);
  const reloadController = useRef<AbortController | null>(null);
  const saveReadController = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setError(null);
    void Promise.all([
      loadEditorSettings(asset.id, controller.signal),
      import("./MediaPresentationEditor").catch((failure: unknown) => {
        if (!controller.signal.aborted) setError("tools");
        throw failure;
      })
    ])
      .then(([settings, { MediaPresentationEditor }]) => {
        if (!controller.signal.aborted)
          setLoaded({
            ...settings,
            Editor: MediaPresentationEditor
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError((current) => current ?? "settings");
          controller.abort();
        }
      });
    return () => {
      active.current = false;
      controller.abort();
      reloadController.current?.abort();
      saveReadController.current?.abort();
    };
  }, [asset.id, attempt]);

  function verifySource(current: AssetRecord) {
    if (current.id !== asset.id)
      throw new ApiError(409, "presentation_conflict");
    if (
      current.presentation?.renditionKeys.full !==
      loaded?.asset.presentation?.renditionKeys.full
    )
      throw new ApiError(409, "source_changed");
  }

  async function reconcile(
    values: PresentationValues,
    revision: number,
    signal: AbortSignal
  ) {
    const current = await getAsset(asset.id, signal);
    verifySource(current);
    const outcome = presentationSaveOutcome(
      current.presentation,
      values,
      revision
    );
    // An unchanged read can precede completion of the original server request.
    if (outcome !== "unchanged") uncertain.current = false;
    if (outcome === "saved") return current;
    if (outcome === "conflict")
      throw new ApiError(409, "presentation_conflict");
    return null;
  }

  async function save(values: PresentationValues, revision: number) {
    const controller = new AbortController();
    saveReadController.current = controller;
    const requireActive = () => {
      if (!active.current) controller.abort();
      controller.signal.throwIfAborted();
    };
    try {
      requireActive();
      let saved: AssetRecord | null = null;
      if (uncertain.current)
        saved = await reconcile(values, revision, controller.signal);
      requireActive();
      if (!saved) {
        try {
          saved = await updateAssetPresentation(asset.id, values, revision);
        } catch (failure) {
          requireActive();
          if (
            failure instanceof ApiError &&
            failure.status >= 400 &&
            failure.status < 500 &&
            !(
              uncertain.current &&
              failure.status === 409 &&
              failure.code !== "source_changed"
            )
          )
            throw failure;
          uncertain.current = true;
          try {
            saved = await reconcile(values, revision, controller.signal);
          } catch (readFailure) {
            requireActive();
            if (readFailure instanceof ApiError && readFailure.status === 409)
              throw readFailure;
          }
          if (!saved) throw failure;
        }
      }
      requireActive();
      verifySource(saved);
      if (
        presentationSaveOutcome(saved.presentation, values, revision) !==
        "saved"
      )
        throw new ApiError(409, "presentation_conflict");
      uncertain.current = false;
      onSaved(
        saved,
        shouldEnableHighlightPlayback(
          getPresentationValues(loaded?.asset.presentation),
          getPresentationValues(saved.presentation)
        )
      );
      onClose();
      return saved;
    } finally {
      controller.abort();
      if (saveReadController.current === controller)
        saveReadController.current = null;
    }
  }

  async function reload() {
    reloadController.current?.abort();
    const controller = new AbortController();
    reloadController.current = controller;
    try {
      const settings = await loadEditorSettings(asset.id, controller.signal);
      controller.signal.throwIfAborted();
      uncertain.current = false;
      if (active.current)
        setLoaded((previous) =>
          previous ? { ...previous, ...settings } : previous
        );
      return settings.asset;
    } finally {
      controller.abort();
      if (reloadController.current === controller)
        reloadController.current = null;
    }
  }

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
        aria-busy={(!loaded && !error) || pending}
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
        {loaded ? (
          <loaded.Editor
            asset={loaded.asset}
            initialAspect={initialAspect}
            originalFit={originalFit}
            capabilities={loaded.capabilities}
            onClose={onClose}
            onSave={save}
            onReload={reload}
            onPendingChange={onPendingChange}
          />
        ) : (
          <>
            <div className="media-editor-status" role="status">
              {!error ? (
                <LoaderCircle
                  className="media-editor-spinner"
                  aria-hidden="true"
                />
              ) : null}
              <p>
                {error === "tools"
                  ? "Could not open the editor. Reload and try again."
                  : error
                    ? "Could not open this file’s settings."
                    : "Opening media…"}
              </p>
              {error ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    // Older browsers retain failed module loads until reload.
                    if (error === "tools") window.location.reload();
                    else setAttempt((current) => current + 1);
                  }}
                >
                  {error === "tools" ? "Reload" : "Retry"}
                </Button>
              ) : null}
            </div>
            <PresentationEditorFooter onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
