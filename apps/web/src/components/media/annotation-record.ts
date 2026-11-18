import type { AssetRecord } from "../../api/client";
import { hasAssetSourceChanged } from "../assets/asset-window";

export function sameAnnotationSource(
  left: AssetRecord,
  right: AssetRecord
): boolean {
  return (
    left.id === right.id &&
    !hasAssetSourceChanged(left, right) &&
    left.presentation?.renditionKeys.full ===
      right.presentation?.renditionKeys.full
  );
}

/** Metadata hydration must not replace curation acknowledged while Info is open. */
export function mergeAnnotationRecord(
  current: AssetRecord,
  detail: AssetRecord | null
): AssetRecord {
  if (!detail || !sameAnnotationSource(current, detail)) return current;
  return {
    ...current,
    width: detail.width ?? current.width,
    height: detail.height ?? current.height,
    durationMs: detail.durationMs ?? current.durationMs,
    codec: detail.codec ?? current.codec,
    mimeType: detail.mimeType ?? current.mimeType
  };
}
