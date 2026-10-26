import { useEffect, useId, useRef, useState } from "react";
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
import { MediaPresentationEditor } from "./MediaPresentationEditor";
import { PresentationPreview } from "./PresentationPreview";
import { presentationSaveOutcome } from "./presentation-model";

interface PresentationEditorDialogProps {
  asset: AssetRecord;
  onClose: () => void;
  onSaved: (asset: AssetRecord) => void;
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

export function PresentationEditorDialog({
  asset,
  onClose,
  onSaved
}: PresentationEditorDialogProps) {
  const descriptionId = useId();
  const [loaded, setLoaded] = useState<{
    asset: AssetRecord;
    capabilities: PresentationMediaCapabilities;
  } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const uncertain = useRef(false);
  const active = useRef(true);
  const reloadController = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setError(false);
    const capabilitiesRequest = getPresentationMediaCapabilities(
      asset.id,
      controller.signal
    ).catch((failure: unknown) => {
      if (
        !(failure instanceof ApiError) ||
        ![415, 422].includes(failure.status)
      )
        throw failure;
      return null;
    });
    void Promise.all([
      getAsset(asset.id, controller.signal),
      capabilitiesRequest
    ])
      .then(([current, capabilities]) => {
        if (!controller.signal.aborted)
          setLoaded({
            asset: current,
            capabilities: capabilities ?? unavailableCapabilities(current)
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          controller.abort();
        }
      });
    return () => {
      active.current = false;
      controller.abort();
      reloadController.current?.abort();
    };
  }, [asset.id, attempt]);

  async function reconcile(values: PresentationValues, revision: number) {
    const current = await getAsset(asset.id);
    uncertain.current = false;
    const outcome = presentationSaveOutcome(
      current.presentation,
      values,
      revision
    );
    if (outcome === "saved") return current;
    if (outcome === "conflict")
      throw new ApiError(409, "presentation_conflict");
    return null;
  }

  async function save(values: PresentationValues, revision: number) {
    let saved: AssetRecord | null = null;
    if (uncertain.current) saved = await reconcile(values, revision);
    if (!saved) {
      try {
        saved = await updateAssetPresentation(asset.id, values, revision);
      } catch (failure) {
        if (
          failure instanceof ApiError &&
          failure.status >= 400 &&
          failure.status < 500
        )
          throw failure;
        uncertain.current = true;
        try {
          saved = await reconcile(values, revision);
        } catch (readFailure) {
          if (readFailure instanceof ApiError && readFailure.status === 409)
            throw readFailure;
        }
        if (!saved) throw failure;
      }
    }
    if (active.current) onSaved(saved);
    return saved;
  }

  async function reload() {
    reloadController.current?.abort();
    const controller = new AbortController();
    reloadController.current = controller;
    const [current, capabilities] = await Promise.all([
      getAsset(asset.id, controller.signal),
      getPresentationMediaCapabilities(asset.id, controller.signal)
    ]);
    uncertain.current = false;
    if (active.current && !controller.signal.aborted)
      setLoaded({ asset: current, capabilities });
    return current;
  }

  if (loaded)
    return (
      <MediaPresentationEditor
        asset={loaded.asset}
        capabilities={loaded.capabilities}
        onClose={onClose}
        onSave={save}
        onReload={reload}
        renderPreview={(props) => (
          <PresentationPreview
            asset={loaded.asset}
            capabilities={loaded.capabilities}
            {...props}
          />
        )}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="media-editor media-editor-loading"
        aria-describedby={descriptionId}
        aria-busy={!error}
      >
        <DialogTitle>Edit media</DialogTitle>
        <p id={descriptionId} role="status">
          {error ? "Could not open this file’s settings." : "Opening media…"}
        </p>
        {error ? (
          <Button
            type="button"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Retry
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
