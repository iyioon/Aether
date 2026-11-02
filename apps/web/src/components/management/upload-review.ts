import type { UploadLimits } from "../../api/client";

const supportedExtension =
  /\.(?:jpe?g|png|apng|gif|webp|avif|hei[cf]|tiff?|bmp|mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|3gp)$/i;
export interface ReviewFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
}
export function uploadFileError(
  file: ReviewFile,
  limits: UploadLimits | null
): string | null {
  if (file.webkitRelativePath)
    return "Choose individual files. Folder uploads are not supported.";
  if (!file.size)
    return "This file is empty. Remove it or choose another file.";
  if (!supportedExtension.test(file.name))
    return "This file type is not supported. Remove it or choose a photo or video.";
  if (limits && file.size > limits.maxUploadBytes)
    return "This file exceeds the per-file limit. Remove it or choose a smaller file.";
  return null;
}
export function uploadBatchError(
  files: ReviewFile[],
  limits: UploadLimits | null
): string | null {
  if (!limits)
    return "Upload limits could not be loaded. Retry before adding files.";
  if (files.length > limits.maxBatchItems)
    return `Choose up to ${limits.maxBatchItems} files per batch.`;
  if (files.reduce((sum, file) => sum + file.size, 0) > limits.maxStagingBytes)
    return "This batch exceeds the unfinished upload limit. Remove files and add them in separate batches.";
  return null;
}
