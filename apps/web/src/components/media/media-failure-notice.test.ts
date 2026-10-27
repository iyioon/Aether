import { describe, expect, it } from "vitest";
import { mediaFailureNotice } from "./media-failure-notice";

describe("media failure notices", () => {
  it("never exposes raw native or server diagnostics", () => {
    const failure = Object.assign(
      new Error("decoder failed at /private/source.mov"),
      {
        code: "unknown_internal_error"
      }
    );
    expect(mediaFailureNotice({ kind: "bounce", error: failure })).toEqual({
      message: "Bounce unavailable.",
      canRetry: true
    });
    expect(mediaFailureNotice({ kind: "image", error: failure }).message).toBe(
      "Image unavailable."
    );
    expect(
      mediaFailureNotice({ kind: "animation", error: failure }).message
    ).toBe("Animation unavailable.");
  });

  it.each([
    ["media_tool_unavailable", "Server media tools are unavailable."],
    ["bounce_hevc_encoder_unavailable", "Bounce encoder is unavailable."],
    ["bounce_h264_encoder_unavailable", "Bounce encoder is unavailable."],
    ["processing_busy", "Media preparation is busy."],
    ["processing_timeout", "Media preparation timed out."],
    ["source_changed", "Media changed. Try again."],
    ["stale_rendition", "Media changed. Try again."],
    ["presentation_processing_failed", "Bounce could not be prepared."],
    ["incomplete_rendition", "Bounce could not be prepared."],
    ["browser_playback_unsupported", "This browser cannot play Bounce."]
  ])("gives %s a specific recoverable notice", (code, message) => {
    expect(mediaFailureNotice({ kind: "bounce", error: { code } })).toEqual({
      message,
      canRetry: true
    });
  });

  it("separates deterministic format, timing and resource limits from transient failures", () => {
    for (const error of [
      { code: "bounce_source_not_supported" },
      { code: "bounce_timing_not_supported" },
      { code: "bounce_duration_exceeded" },
      { code: "presentation_limit_exceeded" },
      { kind: "session" }
    ]) {
      expect(mediaFailureNotice({ kind: "bounce", error }).canRetry).toBe(
        false
      );
    }
    expect(
      mediaFailureNotice({ kind: "bounce", error: { kind: "browser" } }).message
    ).not.toMatch(/section|highlight|long/);
    expect(
      mediaFailureNotice({ kind: "bounce", error: { kind: "network" } })
    ).toEqual({
      message: "Media could not be reached.",
      canRetry: true
    });
    expect(
      mediaFailureNotice({ kind: "video", error: { kind: "preparation" } })
        .message
    ).toBe("Media could not be prepared.");
  });

  it("keeps known capability limits authoritative over an older playback failure", () => {
    expect(
      mediaFailureNotice({
        kind: "bounce",
        error: { kind: "network" },
        bounceOverBudget: true
      })
    ).toEqual({ message: "Bounce section is too long.", canRetry: false });
    expect(
      mediaFailureNotice({ kind: "animation", limitExceeded: true }).canRetry
    ).toBe(false);
  });
});
