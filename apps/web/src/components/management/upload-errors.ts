const messages: Readonly<Record<string, string>> = {
  invalid_upload_body:
    "The upload could not be prepared. Reload Aether and choose the file again.",
  upload_read_failed:
    "The selected file could not be read. Check that it is downloaded to this device, then try Resume.",
  unsupported_media:
    "This file could not be read as a supported photo or video. Choose another file.",
  heic_decoder_unavailable:
    "The server cannot read HEIC photos. Ask the server operator to install or update the HEIC tools, then add the photo again.",
  heic_hdr_not_supported:
    "This HDR HEIC photo is not supported. Export an SDR JPEG or PNG copy and add it again.",
  heic_color_not_supported:
    "This HEIC photo uses unsupported color information. Export a JPEG or PNG copy and add it again.",
  heic_source_not_supported:
    "This HEIC file is not supported. Export a JPEG or PNG copy and add it again.",
  heic_limit_exceeded:
    "This HEIC photo exceeds the processing limits. Export a smaller JPEG or PNG copy and add it again.",
  heic_decode_failed:
    "The server could not decode this HEIC photo. Check the photo and the server's HEIC tools, then add it again.",
  invalid_upload:
    "The server could not accept this upload. Choose the file again.",
  invalid_name:
    "This filename is not supported. Rename the file and add it again.",
  read_only:
    "Uploads are disabled for this folder. Choose another destination or ask the server operator to enable it.",
  unsupported_filesystem:
    "Uploads are unavailable on this drive. Ask the server operator to check its file-management support.",
  csrf_required:
    "The upload could not be authorized. Reload Aether and try again.",
  upload_too_large:
    "This file exceeds the upload limit. Choose a smaller file or ask the server operator to increase the limit.",
  chunk_too_large:
    "The server rejected an upload chunk. Reload Aether before trying again.",
  destination_changed:
    "The destination changed. Refresh the library and add the file again.",
  insufficient_space:
    "There is not enough free space for this upload. Free space on the server and destination drive, then try again.",
  upload_write_failed:
    "The server could not save this upload. Check free space and the drive connection, then try Resume.",
  upload_busy: "The server is busy with other uploads. Wait, then try Resume.",
  upload_expired:
    "This upload expired. Add the file again to start a new upload.",
  upload_changed:
    "The server could not verify the received file. Add the file again to start a new upload.",
  upload_interrupted:
    "This upload was interrupted before it could be saved. Add the file again.",
  upload_cleanup_required:
    "The server needs to check unfinished upload storage. Ask the server operator to review it before adding files.",
  upload_recovery_required:
    "Uploads are unavailable while the server checks unfinished storage. Ask the server operator to review it."
};

const statusCodes: Readonly<Record<number, string>> = {
  413: "upload_too_large",
  415: "unsupported_media",
  429: "upload_busy",
  507: "insufficient_space"
};

/** tus uses plain codes; authentication and API errors use JSON. */
export function uploadResponseCode(
  body: string | undefined
): string | undefined {
  if (!body || body.length > 1024) return undefined;
  let code: unknown = body.trim();
  if (body.trim().startsWith("{")) {
    try {
      const value: unknown = JSON.parse(body);
      code =
        value && typeof value === "object" && "error" in value
          ? value.error
          : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code)
    ? code
    : undefined;
}

export function uploadErrorMessage(
  code?: string,
  status?: number,
  fallback = "This upload failed. Check the file type, size and destination, then add it again."
): string {
  const known =
    code && Object.hasOwn(messages, code) ? code : statusCodes[status ?? 0];
  return known ? messages[known]! : fallback;
}
