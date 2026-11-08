import { describe, expect, it } from "vitest";
import { uploadErrorMessage, uploadResponseCode } from "./upload-errors";

describe("upload failures", () => {
  it("reads tus codes and structured authorization errors", () => {
    expect(uploadResponseCode("unsupported_media\n")).toBe("unsupported_media");
    expect(uploadResponseCode('{"error":"csrf_required"}')).toBe(
      "csrf_required"
    );
    expect(
      uploadErrorMessage(uploadResponseCode('{"error":"csrf_required"}'), 403)
    ).toMatch(/Reload/);
  });

  it("does not expose response bodies, private paths or unknown codes", () => {
    const fallback = "The upload could not finish.";
    for (const body of [
      "<html>Proxy error: /private/server/file</html>",
      '{"error":"/private/server/file"}',
      '{"error": {"path":"/private/server/file"}}',
      '{"error":',
      "x".repeat(1025),
      "private_decoder_detail",
      "constructor",
      "toString"
    ]) {
      expect(
        uploadErrorMessage(uploadResponseCode(body), undefined, fallback)
      ).toBe(fallback);
    }
  });

  it("gives size and format guidance for proxy responses without a code", () => {
    expect(uploadErrorMessage(undefined, 413)).toMatch(/upload limit/);
    expect(uploadErrorMessage(undefined, 415)).toMatch(
      /supported photo or video/
    );
    expect(uploadErrorMessage(undefined, 507)).toMatch(/free space/);
  });

  it("distinguishes missing HEIC tools from unsupported photo characteristics", () => {
    expect(uploadErrorMessage("heic_decoder_unavailable")).toMatch(
      /server operator.*HEIC tools/
    );
    expect(uploadErrorMessage("heic_hdr_not_supported")).toMatch(/SDR JPEG/);
    expect(uploadErrorMessage("heic_color_not_supported")).toMatch(
      /color information/
    );
    expect(uploadErrorMessage("heic_limit_exceeded")).toMatch(/smaller/);
    expect(uploadErrorMessage("heic_decode_failed")).toMatch(
      /decode.*HEIC tools/
    );
  });
});
