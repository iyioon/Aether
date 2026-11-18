import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { ApiError, type AssetRecord } from "../../api/client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import {
  formatPresentationTime,
  getPresentationHighlights
} from "./presentation-model";

interface MediaHighlightsPanelProps {
  asset: AssetRecord;
  disabled?: boolean;
  selectedHighlightId?: string | null;
  onViewHighlight?: (asset: AssetRecord, highlightId: string) => void;
  onEditHighlights?: (asset: AssetRecord) => void;
  onMakeMainHighlight?: (
    asset: AssetRecord,
    highlightId: string,
    signal: AbortSignal
  ) => Promise<AssetRecord>;
  onAssetUpdated: (asset: AssetRecord) => void;
  onSeparateHighlightsChange?: (
    asset: AssetRecord,
    enabled: boolean,
    signal: AbortSignal
  ) => Promise<AssetRecord>;
  onBusyChange: (busy: boolean) => void;
}

export function MediaHighlightsPanel({
  asset,
  disabled = false,
  selectedHighlightId,
  onViewHighlight,
  onEditHighlights,
  onMakeMainHighlight,
  onSeparateHighlightsChange,
  onAssetUpdated,
  onBusyChange
}: MediaHighlightsPanelProps) {
  const highlights = getPresentationHighlights(asset.presentation);
  const mainHighlightId =
    asset.presentation?.mainHighlightId ?? highlights[0]?.id ?? null;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const viewButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const highlightRowsRef = useRef(new Map<string, HTMLLIElement>());
  const pendingFocusRef = useRef<{
    origin: Element | null;
    highlightId: string;
  } | null>(null);
  const activeRef = useRef(true);
  const saveControllerRef = useRef<AbortController | null>(null);
  const assetIdRef = useRef(asset.id);
  assetIdRef.current = asset.id;
  const callbacksRef = useRef({ onAssetUpdated, onBusyChange });
  callbacksRef.current = { onAssetUpdated, onBusyChange };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      saveControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setError(null);
    return () => saveControllerRef.current?.abort();
  }, [asset.id]);

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (pendingId || !pendingFocus) return;
    pendingFocusRef.current = null;
    if (
      document.activeElement !== pendingFocus.origin &&
      document.activeElement !== document.body
    )
      return;
    const target =
      viewButtonsRef.current.get(pendingFocus.highlightId) ??
      highlightRowsRef.current.get(pendingFocus.highlightId);
    if (target?.isConnected && !target.matches(":disabled"))
      target.focus({ preventScroll: true });
  }, [pendingId]);

  async function saveSettings(highlightId: string, separate?: boolean) {
    if (
      disabled ||
      pendingRef.current ||
      (separate === undefined
        ? !onMakeMainHighlight || highlightId === mainHighlightId
        : !onSeparateHighlightsChange)
    )
      return;
    const assetId = asset.id;
    const controller = new AbortController();
    saveControllerRef.current = controller;
    if (separate === undefined)
      pendingFocusRef.current = {
        origin: document.activeElement,
        highlightId
      };
    pendingRef.current = true;
    setPendingId(highlightId);
    setError(null);
    callbacksRef.current.onBusyChange(true);
    try {
      const saved =
        separate === undefined
          ? await onMakeMainHighlight!(asset, highlightId, controller.signal)
          : await onSeparateHighlightsChange!(
              asset,
              separate,
              controller.signal
            );
      if (
        activeRef.current &&
        !controller.signal.aborted &&
        assetIdRef.current === assetId
      )
        callbacksRef.current.onAssetUpdated(saved);
    } catch (failure) {
      if (
        activeRef.current &&
        !controller.signal.aborted &&
        assetIdRef.current === assetId &&
        !(failure instanceof ApiError && failure.status === 401)
      )
        setError(
          failure instanceof ApiError && failure.status === 409
            ? "These highlights changed in another window. Reopen Info before changing them."
            : "The change could not be confirmed. Reopen Info to check before trying again."
        );
    } finally {
      if (saveControllerRef.current === controller)
        saveControllerRef.current = null;
      pendingRef.current = false;
      if (activeRef.current) {
        setPendingId(null);
        callbacksRef.current.onBusyChange(false);
      }
    }
  }

  const unavailable = disabled || pendingId !== null || asset.unavailable;

  return (
    <section className="media-highlights-panel" aria-label="Media highlights">
      {highlights.length > 0 && onSeparateHighlightsChange ? (
        <div className="grid gap-2">
          <Label className="media-highlight-display-option flex items-center gap-3 leading-5">
            <Checkbox
              checked={asset.presentation?.separateHighlights === true}
              disabled={unavailable}
              onCheckedChange={(checked) =>
                void saveSettings("$display", checked === true)
              }
            />
            Show highlights separately in Gallery and Feed
          </Label>
          <p className="text-sm text-muted-foreground">
            Scores, tags, and file actions apply to the source media.
          </p>
        </div>
      ) : null}
      {highlights.length > 0 ? (
        <ul className="media-highlights-list">
          {highlights.map((highlight) => {
            const isMain = highlight.id === mainHighlightId;
            const isViewed = highlight.id === selectedHighlightId;
            return (
              <li
                className="media-highlight-item"
                key={highlight.id}
                tabIndex={-1}
                ref={(node) => {
                  if (node) highlightRowsRef.current.set(highlight.id, node);
                  else highlightRowsRef.current.delete(highlight.id);
                }}
              >
                <div className="media-highlight-heading">
                  <span className="media-highlight-name">{highlight.name}</span>
                  {isMain ? <Badge variant="secondary">Main</Badge> : null}
                </div>
                <p className="media-highlight-summary">
                  {formatPresentationTime(highlight.highlight.startMs)}–
                  {formatPresentationTime(highlight.highlight.endMs)} ·{" "}
                  {highlight.playbackRate}× ·{" "}
                  {highlight.loopMode === "bounce" ? "Bounce" : "Repeat"}
                </p>
                <div className="media-highlight-actions">
                  {onViewHighlight ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={unavailable}
                      aria-label={`View ${highlight.name}`}
                      aria-pressed={isViewed}
                      ref={(node) => {
                        if (node)
                          viewButtonsRef.current.set(highlight.id, node);
                        else viewButtonsRef.current.delete(highlight.id);
                      }}
                      onClick={() => onViewHighlight(asset, highlight.id)}
                    >
                      {isViewed ? "Viewing" : "View"}
                    </Button>
                  ) : null}
                  {!isMain && onMakeMainHighlight ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={unavailable}
                      aria-label={`Make ${highlight.name} the main highlight`}
                      onClick={() => void saveSettings(highlight.id)}
                    >
                      {pendingId === highlight.id ? "Saving…" : "Make main"}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No highlights</p>
      )}
      {error || pendingId ? (
        <p
          className="media-highlight-feedback"
          role={error ? "alert" : "status"}
        >
          {error ??
            (pendingId === "$display"
              ? "Saving display setting…"
              : "Saving main highlight…")}
        </p>
      ) : null}
      {onEditHighlights ? (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={unavailable}
          onClick={() => onEditHighlights(asset)}
        >
          <Pencil aria-hidden="true" />
          Edit media
        </Button>
      ) : null}
    </section>
  );
}
