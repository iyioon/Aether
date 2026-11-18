import type { AssetRecord } from "../../api/client";
import { getPresentationHighlights } from "./presentation-model";
import type { SessionScrollPosition } from "../scroll-restoration";

const MAX_RESTORED_SOURCES = 10_000;

/** Display identity is separate from the source used by every media action. */
export interface LibraryMediaEntry extends AssetRecord {
  entryKey: string;
  highlightId: string | null;
  highlightName: string | null;
  source: AssetRecord;
}

export function libraryMediaEntryKey(
  assetId: string,
  highlightId?: string | null
): string {
  return highlightId ? `${assetId}~${highlightId}` : assetId;
}

export function libraryMediaSourceId(entryKey: string): string {
  return entryKey.split("~", 1)[0]!;
}

export function buildLibraryMediaEntries(
  assets: readonly AssetRecord[]
): LibraryMediaEntry[] {
  return assets.flatMap<LibraryMediaEntry>((source) => {
    const highlights = source.presentation?.separateHighlights
      ? (source.presentation.highlights ??
        getPresentationHighlights(source.presentation))
      : [];
    return highlights.length
      ? highlights.map((highlight) => ({
          ...source,
          entryKey: libraryMediaEntryKey(source.id, highlight.id),
          highlightId: highlight.id,
          highlightName: highlight.name,
          source
        }))
      : [
          {
            ...source,
            entryKey: source.id,
            highlightId: null,
            highlightName: null,
            source
          }
        ];
  });
}

/** A removed section or changed display option returns to the source's main. */
export function findLibraryMediaEntry(
  entries: readonly LibraryMediaEntry[],
  entryKey: string | null | undefined
): LibraryMediaEntry | undefined {
  if (!entryKey) return undefined;
  const exact = entries.find((entry) => entry.entryKey === entryKey);
  if (exact) return exact;
  const assetId = libraryMediaSourceId(entryKey);
  const sourceEntries = entries.filter((entry) => entry.id === assetId);
  return (
    sourceEntries.find(
      (entry) =>
        entry.highlightId === entry.source.presentation?.mainHighlightId
    ) ?? sourceEntries[0]
  );
}

export function findLibraryMediaEntryIndex(
  entries: readonly LibraryMediaEntry[],
  entryKey: string | null | undefined
): number {
  const entry = findLibraryMediaEntry(entries, entryKey);
  return entry ? entries.indexOf(entry) : -1;
}

export function libraryMediaEntryLabel(entry: LibraryMediaEntry): string {
  return entry.highlightName
    ? `${entry.highlightName} · ${entry.name}`
    : entry.name;
}

export function libraryMediaSourceCount(
  entries: readonly LibraryMediaEntry[]
): number {
  return new Set(entries.map((entry) => entry.id)).size;
}

/** Display indices cannot establish how many source pages contain an old anchor. */
export function libraryMediaRestoreIndex(
  entries: readonly LibraryMediaEntry[],
  position: Pick<
    SessionScrollPosition,
    "anchorId" | "index" | "loadedCount" | "loadedSourceCount"
  >
): number {
  const anchoredIndex = findLibraryMediaEntryIndex(entries, position.anchorId);
  if (anchoredIndex >= 0) return anchoredIndex;
  const savedIndex = Number.isSafeInteger(position.index)
    ? Math.max(0, position.index!)
    : 0;
  if (
    position.anchorId &&
    Number.isSafeInteger(position.loadedCount) &&
    position.loadedCount! >= 0 &&
    Number.isSafeInteger(position.loadedSourceCount) &&
    position.loadedSourceCount! >= 0 &&
    position.loadedSourceCount! <= position.loadedCount! &&
    Number.isSafeInteger(position.index) &&
    position.index! >= 0 &&
    position.index! < position.loadedCount!
  ) {
    const sourceDepth = Math.min(
      MAX_RESTORED_SOURCES,
      position.loadedSourceCount!,
      savedIndex + 1
    );
    // Returning the loaded bound requests another source page in either view.
    if (libraryMediaSourceCount(entries) < sourceDepth) return entries.length;
    return Math.min(savedIndex, Math.max(0, entries.length - 1));
  }
  // Missing or inconsistent source depth retains the bounded display fallback.
  return Math.min(savedIndex, MAX_RESTORED_SOURCES - 1);
}
