export function mediaUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/media`;
}

export function thumbnailUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=640`;
}

export function videoPreviewUrl(assetId: string, size: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/preview?size=${size}&duration=4`;
}

export function downloadUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/download`;
}
