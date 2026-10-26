import type { AssetRecord } from "../../api/client";

const ANIMATED_IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".avif", ".apng"]);
type MediaSource = string | Pick<AssetRecord, "id" | "mtimeMs" | "sizeBytes">;

function sourceId(source: MediaSource): string {
  return encodeURIComponent(typeof source === "string" ? source : source.id);
}

function versionQuery(source: MediaSource, separator: "?" | "&"): string {
  return typeof source === "string"
    ? ""
    : `${separator}v=${source.mtimeMs}-${source.sizeBytes}`;
}

export function mediaUrl(source: MediaSource): string {
  return `/api/assets/${sourceId(source)}/media${versionQuery(source, "?")}`;
}

export function imageDisplayUrl(
  asset: Pick<
    AssetRecord,
    "id" | "mtimeMs" | "sizeBytes" | "mimeType" | "extension"
  >
): string {
  const needsDisplayCopy =
    /^image\/hei[cf](?:-sequence)?$/i.test(asset.mimeType ?? "") ||
    /^\.hei[cf]$/i.test(asset.extension);
  return needsDisplayCopy
    ? `/api/assets/${sourceId(asset)}/display${versionQuery(asset, "?")}`
    : mediaUrl(asset);
}

export function thumbnailUrl(source: MediaSource, size = 640): string {
  return `/api/assets/${sourceId(source)}/thumbnail?size=${size}${versionQuery(source, "&")}`;
}

export function videoPreviewUrl(source: MediaSource, size: number): string {
  return `/api/assets/${sourceId(source)}/preview?size=${size}&duration=4${versionQuery(source, "&")}`;
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
