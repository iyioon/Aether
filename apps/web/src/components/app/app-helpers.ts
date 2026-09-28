import { ApiError, type AssetRecord } from "../../api/client";
import { selectedMediaLabel } from "../media/media-format";

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

export function optimisticScoreAsset(
  asset: AssetRecord,
  input: { score?: number; favorite?: boolean }
): AssetRecord {
  return {
    ...asset,
    favorite: input.favorite ?? asset.favorite,
    score: input.score === undefined ? asset.score : input.score
  };
}

export function scoreActionErrorMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return "Unable to update media.";
  }

  switch (caught.code) {
    case "asset_not_indexed":
      return "This media is no longer indexed.";
    case "invalid_request":
      return "Score request was invalid.";
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

export function batchScoreStatus(updatedCount: number): string {
  return `${updatedCount} ${selectedMediaLabel(updatedCount)} updated.`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
