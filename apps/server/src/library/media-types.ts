export type MediaType = "image" | "video";

interface MediaTypeInfo {
  mediaType: MediaType;
  mimeType: string;
}

const extensionMap = new Map<string, MediaTypeInfo>([
  [".jpg", { mediaType: "image", mimeType: "image/jpeg" }],
  [".jpeg", { mediaType: "image", mimeType: "image/jpeg" }],
  [".png", { mediaType: "image", mimeType: "image/png" }],
  [".apng", { mediaType: "image", mimeType: "image/png" }],
  [".gif", { mediaType: "image", mimeType: "image/gif" }],
  [".webp", { mediaType: "image", mimeType: "image/webp" }],
  [".avif", { mediaType: "image", mimeType: "image/avif" }],
  [".heic", { mediaType: "image", mimeType: "image/heic" }],
  [".heif", { mediaType: "image", mimeType: "image/heif" }],
  [".tif", { mediaType: "image", mimeType: "image/tiff" }],
  [".tiff", { mediaType: "image", mimeType: "image/tiff" }],
  [".bmp", { mediaType: "image", mimeType: "image/bmp" }],
  [".mp4", { mediaType: "video", mimeType: "video/mp4" }],
  [".m4v", { mediaType: "video", mimeType: "video/mp4" }],
  [".mov", { mediaType: "video", mimeType: "video/quicktime" }],
  [".webm", { mediaType: "video", mimeType: "video/webm" }],
  [".mkv", { mediaType: "video", mimeType: "video/x-matroska" }],
  [".avi", { mediaType: "video", mimeType: "video/x-msvideo" }],
  [".mpeg", { mediaType: "video", mimeType: "video/mpeg" }],
  [".mpg", { mediaType: "video", mimeType: "video/mpeg" }],
  [".3gp", { mediaType: "video", mimeType: "video/3gpp" }]
]);

export function detectMediaType(extension: string): MediaTypeInfo | null {
  return extensionMap.get(extension.toLowerCase()) ?? null;
}
