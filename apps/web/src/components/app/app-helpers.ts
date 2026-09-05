import { ApiError, type AssetRecord } from "../../api/client";
import { selectedMediaLabel } from "../media/media-format";

export function shouldCollapseFeedControlsByDefault(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(
    "(max-width: 760px), (max-width: 920px) and (hover: none) and (pointer: coarse)"
  ).matches;
}

export function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

export function optimisticRatingAsset(
  asset: AssetRecord,
  input: { rating?: number | null; favorite?: boolean }
): AssetRecord {
  return {
    ...asset,
    favorite: input.favorite ?? asset.favorite,
    rating: input.rating === undefined ? asset.rating : input.rating
  };
}

export function ratingActionErrorMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return "Unable to update media.";
  }

  switch (caught.code) {
    case "asset_not_indexed":
      return "This media is no longer indexed.";
    case "invalid_request":
      return "Rating request was invalid.";
    default:
      return "Unable to update media.";
  }
}

export function batchActionErrorMessage(
  caught: unknown,
  fallback: string
): string {
  if (!(caught instanceof ApiError)) {
    return fallback;
  }

  switch (caught.code) {
    case "asset_not_indexed":
      return "Some selected media is no longer indexed.";
    case "invalid_tag":
      return "Use shorter, non-empty tags.";
    case "invalid_request":
      return "Selection request was invalid.";
    default:
      return fallback;
  }
}

export function batchTagStatus(
  tags: string[],
  mode: "add" | "replace",
  updatedCount: number
): string {
  const mediaLabel = selectedMediaLabel(updatedCount);

  if (mode === "replace") {
    return tags.length
      ? `Tags replaced on ${updatedCount} ${mediaLabel}.`
      : `Tags cleared on ${updatedCount} ${mediaLabel}.`;
  }

  const tagLabel = tags.length === 1 ? tags[0] : `${tags.length} tags`;

  return `${tagLabel} added to ${updatedCount} ${mediaLabel}.`;
}

export function batchRatingStatus(updatedCount: number): string {
  return `${updatedCount} ${selectedMediaLabel(updatedCount)} updated.`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
