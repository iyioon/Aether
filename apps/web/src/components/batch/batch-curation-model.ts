export interface BatchCurationInput {
  score?: number;
  favorite?: boolean;
}

interface BatchCurationDraft {
  score: number | undefined;
  favorite: boolean;
  isFavoriteDirty: boolean;
}

export function buildBatchCurationInput({
  score,
  favorite,
  isFavoriteDirty
}: BatchCurationDraft): BatchCurationInput | null {
  if (score === undefined && !isFavoriteDirty) {
    return null;
  }

  return {
    ...(score === undefined ? {} : { score }),
    ...(isFavoriteDirty ? { favorite } : {})
  };
}

export function uniformValue<T>(values: T[]): T | undefined {
  const first = values[0];
  return values.length > 0 && values.every((value) => value === first)
    ? first
    : undefined;
}

export function parseScoreDraft(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const score = Number(value);
  return Number.isSafeInteger(score) && score >= 0 ? score : undefined;
}
import { uniqueTagNames } from "../tags/tag-utils";

export const MAX_BATCH_TAGS = 50;
export type BatchTagMode = "add" | "replace" | "clear";

export function changedScoreDraft(
  draft: string,
  baseline: number | undefined,
  edited: boolean
): number | undefined {
  if (!edited) return undefined;
  const score = parseScoreDraft(draft);
  return score !== baseline ? score : undefined;
}

export function batchTagNames(staged: string[], draft: string): string[] {
  return uniqueTagNames([...staged, draft]);
}

export function selectableAssetIds(
  assets: Array<{ id: string; unavailable?: boolean }>
): Set<string> {
  return new Set(
    assets.filter((asset) => !asset.unavailable).map((asset) => asset.id)
  );
}
