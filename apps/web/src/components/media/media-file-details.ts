import type { AssetRecord, TreeResponse } from "../../api/client";
import { formatBytes, formatDuration } from "./media-format";

export interface MediaFileDetail {
  label: string;
  value: string;
  dateTime?: string;
}

interface MediaFileDetailsOptions {
  locationLabel?: string;
  locale?: string;
  timeZone?: string;
}

type FileMetadata = Pick<
  AssetRecord,
  | "mtimeMs"
  | "extension"
  | "mimeType"
  | "width"
  | "height"
  | "sizeBytes"
  | "durationMs"
  | "codec"
>;

export function mediaFolderLabel(
  tree: TreeResponse | null,
  folderId: string | null
): string | undefined {
  const folder = tree?.folders.find(({ id }) => id === folderId);
  const root = tree?.roots.find(
    ({ id, folderId: rootFolderId }) =>
      id === folder?.rootId || rootFolderId === folderId
  );
  return root
    ? [root.label, ...(folder?.relativePath.split("/") ?? [])]
        .filter(Boolean)
        .join(" / ")
    : folder?.label;
}

export function mediaFileDetails(
  asset: FileMetadata,
  { locationLabel, locale, timeZone }: MediaFileDetailsOptions = {}
): MediaFileDetail[] {
  const details: MediaFileDetail[] = [];
  const modified = new Date(asset.mtimeMs);
  if (Number.isFinite(asset.mtimeMs) && Number.isFinite(modified.getTime())) {
    details.push({
      label: "Modified",
      value: new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "shortOffset",
        ...(timeZone ? { timeZone } : {})
      }).format(modified),
      dateTime: modified.toISOString()
    });
  }

  if (locationLabel?.trim()) {
    details.push({ label: "Location", value: locationLabel.trim() });
  }

  const extension = asset.extension.replace(/^\./, "").toLowerCase();
  const formatNames: Record<string, string> = {
    jpg: "JPEG",
    jpeg: "JPEG",
    tif: "TIFF",
    tiff: "TIFF"
  };
  const format = /^[a-z0-9]{1,12}$/.test(extension)
    ? (formatNames[extension] ?? extension.toUpperCase())
    : asset.mimeType?.trim();
  if (format) details.push({ label: "Format", value: format });

  if (Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes >= 0) {
    details.push({ label: "File size", value: formatBytes(asset.sizeBytes) });
  }

  if (positiveInteger(asset.width) && positiveInteger(asset.height)) {
    details.push({
      label: "Dimensions",
      value: `${asset.width} × ${asset.height} px`
    });
  }

  if (
    asset.durationMs !== null &&
    Number.isFinite(asset.durationMs) &&
    asset.durationMs > 0
  ) {
    details.push({
      label: "Duration",
      value: asset.durationMs < 1000 ? "<1 s" : formatDuration(asset.durationMs)
    });
  }

  if (asset.codec?.trim()) {
    details.push({ label: "Codec", value: asset.codec.trim() });
  }

  return details;
}

function positiveInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}
