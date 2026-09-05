import type { CSSProperties } from "react";
import type { AssetRecord } from "../../api/client";
import type { AspectMode, GridSize } from "../library-state";
import { formatBytes, formatDuration } from "../media/media-format";
import type { GalleryMetadataField } from "./gallery-metadata";

export const GALLERY_GRID_GAP = 12;

export function galleryMinTileWidth(gridSize: GridSize): number {
  switch (gridSize) {
    case "Tiny":
      return 96;
    case "Compact":
      return 132;
    case "Huge":
      return 340;
    case "Large":
      return 260;
    case "Medium":
    default:
      return 180;
  }
}

export function galleryColumnCount(
  containerWidth: number,
  minTileWidth: number
): number {
  const usableWidth = Math.max(containerWidth, minTileWidth);

  return Math.max(
    1,
    Math.floor(
      (usableWidth + GALLERY_GRID_GAP) / (minTileWidth + GALLERY_GRID_GAP)
    )
  );
}

export function chunkAssetsIntoRows(
  assets: AssetRecord[],
  columnCount: number
): AssetRecord[][] {
  const rows: AssetRecord[][] = [];

  for (let index = 0; index < assets.length; index += columnCount) {
    rows.push(assets.slice(index, index + columnCount));
  }

  return rows;
}

export function estimateGalleryRowHeight({
  aspect,
  columnCount,
  containerWidth,
  metadataFields,
  minTileWidth
}: {
  aspect: AspectMode;
  columnCount: number;
  containerWidth: number;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  minTileWidth: number;
}): number {
  const width = Math.max(containerWidth, minTileWidth);
  const tileWidth =
    (width - GALLERY_GRID_GAP * Math.max(0, columnCount - 1)) / columnCount;
  const mediaHeight = tileWidth / galleryAspectRatio(aspect);

  return mediaHeight + galleryTileChromeHeight(metadataFields);
}

export function galleryTileChromeHeight(
  fields: ReadonlySet<GalleryMetadataField>
): number {
  const hasTitle = fields.has("title");
  const hasSecondaryMetadata = fields.has("mediaType") || fields.has("size");
  const hasCuration =
    fields.has("rating") || fields.has("favorite") || fields.has("tags");
  const visibleSectionCount = [hasTitle, hasSecondaryMetadata, hasCuration]
    .filter(Boolean).length;

  if (visibleSectionCount === 0) {
    return 0;
  }

  return (
    19 +
    (hasTitle ? 16 : 0) +
    (hasSecondaryMetadata ? 15 : 0) +
    (hasCuration ? 30 : 0) +
    Math.max(0, visibleSectionCount - 1) * 6
  );
}

export function gallerySecondaryMetadata(
  asset: AssetRecord,
  fields: ReadonlySet<GalleryMetadataField>
): string[] {
  const entries: string[] = [];

  if (fields.has("mediaType")) {
    entries.push(asset.mediaType);
  }

  if (fields.has("size")) {
    entries.push(
      asset.durationMs
        ? formatDuration(asset.durationMs)
        : formatBytes(asset.sizeBytes)
    );
  }

  return entries;
}

export function galleryAspectRatio(aspect: AspectMode): number {
  switch (aspect) {
    case "Portrait":
      return 9 / 16;
    case "Landscape":
      return 16 / 10;
    case "Original":
      return 3 / 2;
    case "Square":
    default:
      return 1;
  }
}

export function mediaTileStyle(
  asset: AssetRecord,
  aspect: AspectMode,
  measuredAspectRatios: Record<string, string>
): CSSProperties | undefined {
  if (aspect !== "Original") {
    return undefined;
  }

  const ratio =
    measuredAspectRatios[asset.id] ?? knownMediaAspectRatio(asset) ?? "3 / 2";

  return {
    "--media-aspect-ratio": ratio
  } as CSSProperties;
}

function knownMediaAspectRatio(asset: AssetRecord): string | null {
  if (!asset.width || !asset.height || asset.width <= 0 || asset.height <= 0) {
    return null;
  }

  return `${asset.width} / ${asset.height}`;
}
