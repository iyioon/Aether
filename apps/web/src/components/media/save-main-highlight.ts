import {
  ApiError,
  getAsset,
  updateAssetPresentation,
  type AssetRecord
} from "../../api/client";
import {
  getPresentationHighlights,
  getPresentationValues,
  presentationSaveOutcome,
  setMainPresentationHighlight
} from "./presentation-model";

export async function saveMainHighlight(
  asset: AssetRecord,
  highlightId: string,
  signal: AbortSignal
): Promise<AssetRecord> {
  signal.throwIfAborted();
  if (asset.unavailable) throw new ApiError(404, "asset_not_found");
  const original = getPresentationValues(asset.presentation);
  if (!getPresentationHighlights(original).some(({ id }) => id === highlightId))
    throw new ApiError(409, "presentation_conflict");
  const desired = setMainPresentationHighlight(original, highlightId);
  const revision = asset.presentation?.revision ?? 0;

  function verify(current: AssetRecord) {
    signal.throwIfAborted();
    if (
      current.id !== asset.id ||
      current.presentation?.renditionKeys.full !==
        asset.presentation?.renditionKeys.full
    )
      throw new ApiError(409, "source_changed");
    const outcome = presentationSaveOutcome(
      current.presentation,
      desired,
      revision
    );
    if (outcome === "conflict")
      throw new ApiError(409, "presentation_conflict");
    return outcome;
  }

  let saved: AssetRecord;
  try {
    saved = await updateAssetPresentation(asset.id, desired, revision);
  } catch (failure) {
    signal.throwIfAborted();
    if (
      failure instanceof ApiError &&
      failure.status >= 400 &&
      failure.status < 500
    )
      throw failure;
    // A lost response may hide a committed write. Confirm it without repeating it.
    try {
      const current = await getAsset(asset.id, signal);
      if (verify(current) === "saved") return current;
    } catch (readFailure) {
      signal.throwIfAborted();
      if (readFailure instanceof ApiError && readFailure.status === 409)
        throw readFailure;
    }
    throw failure;
  }
  if (verify(saved) !== "saved")
    throw new ApiError(409, "presentation_conflict");
  return saved;
}
