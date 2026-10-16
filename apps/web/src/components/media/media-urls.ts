import type { AssetRecord } from "../../api/client";

const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".avif", ".apng"]);

export function mediaUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/media`;
}

export function thumbnailUrl(assetId: string, size = 640): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`;
}

export function videoPreviewUrl(assetId: string, size: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/preview?size=${size}&duration=4`;
}

export function downloadUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/download`;
}

export function isAnimatedImagePreview(
  asset: Pick<AssetRecord, "mediaType" | "extension">
): boolean {
  return (
    asset.mediaType === "image" &&
    ANIMATED_IMAGE_EXTENSIONS.has(asset.extension.toLocaleLowerCase("en-US"))
  );
}
