import type { AssetRecord, PresentationAspect } from "../../api/client";
import { galleryAspectRatio } from "../gallery/gallery-layout";
import { presentationAssetForHighlight } from "../media/presentation-model";

const SAVED_ASPECTS = ["Square", "Portrait", "Landscape"] as const;

function aspectRatio(
  width: number | null,
  height: number | null
): number | null {
  if (
    width === null ||
    height === null ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const ratio = width / height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export function resolveFeedFramingAspect(
  asset: AssetRecord,
  viewport: { width: number; height: number },
  highlightId?: string | null
): PresentationAspect {
  const viewportRatio = aspectRatio(viewport.width, viewport.height);
  if (viewportRatio === null) return "Original";

  const presentation = presentationAssetForHighlight(
    asset,
    highlightId
  ).presentation;
  const candidates: Array<{
    aspect: PresentationAspect;
    ratio: number;
  }> = SAVED_ASPECTS.flatMap((aspect) =>
    presentation?.aspectFraming?.[aspect]
      ? [{ aspect, ratio: galleryAspectRatio(aspect) }]
      : []
  );
  if (candidates.length === 0) return "Original";

  const originalRatio = aspectRatio(asset.width, asset.height);
  if (originalRatio !== null) {
    candidates.push({ aspect: "Original", ratio: originalRatio });
  }

  const viewportLogRatio = Math.log(viewportRatio);
  let closest: PresentationAspect = "Original";
  let closestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(Math.log(candidate.ratio) - viewportLogRatio);
    // Preserve saved-preset and stable aspect order for mathematical ties.
    if (distance < closestDistance - 1e-12) {
      closest = candidate.aspect;
      closestDistance = distance;
    }
  }
  return closest;
}
