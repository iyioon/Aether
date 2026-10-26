import { describe, expect, it } from "vitest";
import {
  downloadUrl,
  imageDisplayUrl,
  mediaUrl,
  thumbnailUrl,
  videoPreviewUrl
} from "./media-urls";

const source = {
  id: "photo/id",
  mtimeMs: 1234,
  sizeBytes: 5678,
  extension: ".HEIC",
  mimeType: "image/heic"
};

describe("media URLs", () => {
  it("uses a browser display copy for HEIC and preserves original downloads", () => {
    expect(imageDisplayUrl(source)).toBe(
      "/api/assets/photo%2Fid/display?v=1234-5678"
    );
    expect(
      imageDisplayUrl({ ...source, mimeType: null, extension: ".heif" })
    ).toContain("/display?");
    expect(
      imageDisplayUrl({ ...source, mimeType: "image/jpeg", extension: ".jpg" })
    ).toBe(mediaUrl(source));
    expect(downloadUrl(source.id)).toBe("/api/assets/photo%2Fid/download");
  });

  it("changes image, thumbnail and video URLs after a source replacement", () => {
    const changed = { ...source, sizeBytes: source.sizeBytes + 1 };
    expect(mediaUrl(changed)).not.toBe(mediaUrl(source));
    expect(imageDisplayUrl(changed)).not.toBe(imageDisplayUrl(source));
    expect(thumbnailUrl(changed)).not.toBe(thumbnailUrl(source));
    expect(videoPreviewUrl(changed, 480)).not.toBe(
      videoPreviewUrl(source, 480)
    );
    expect(
      new URL(thumbnailUrl(source, 128), "http://localhost").searchParams.get(
        "size"
      )
    ).toBe("128");
  });
});
