import type { AssetRecord } from "../../api/client";

/** Keep a delayed curation response from replacing a newer presentation. */
export function preservePresentation(
  current: AssetRecord,
  incoming: AssetRecord
): AssetRecord {
  if (
    current.id !== incoming.id ||
    !current.presentation ||
    (incoming.presentation?.revision ?? -1) >= current.presentation.revision
  )
    return incoming;
  return { ...incoming, presentation: current.presentation };
}
