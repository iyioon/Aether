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
