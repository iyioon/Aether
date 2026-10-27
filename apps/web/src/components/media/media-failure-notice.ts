export interface MediaFailureNotice {
  message: string;
  canRetry: boolean;
}

interface MediaFailureContext {
  kind: "image" | "animation" | "video" | "bounce";
  error?: unknown;
  bounceUnavailable?: boolean;
  bounceOverBudget?: boolean;
  limitExceeded?: boolean;
}

/** Only known public reasons become copy; native/tool diagnostics stay private. */
export function mediaFailureNotice({
  kind,
  error,
  bounceUnavailable,
  bounceOverBudget,
  limitExceeded
}: MediaFailureContext): MediaFailureNotice {
  const reason =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; kind?: unknown })
      : null;
  const code = reason?.code;
  if (bounceUnavailable || code === "bounce_source_not_supported")
    return {
      message: "Bounce is unavailable for this format.",
      canRetry: false
    };
  if (bounceOverBudget || code === "bounce_duration_exceeded")
    return { message: "Bounce section is too long.", canRetry: false };
  if (code === "bounce_timing_not_supported")
    return { message: "Bounce timing is unsupported.", canRetry: false };
  if (
    limitExceeded ||
    reason?.kind === "limit" ||
    code === "presentation_limit_exceeded"
  )
    return { message: "Playback exceeds a processing limit.", canRetry: false };
  if (reason?.kind === "session")
    return { message: "Sign in again to play this media.", canRetry: false };
  if (reason?.kind === "busy" || code === "processing_busy")
    return { message: "Media preparation is busy.", canRetry: true };
  if (code === "media_tool_unavailable")
    return { message: "Server media tools are unavailable.", canRetry: true };
  if (
    code === "bounce_hevc_encoder_unavailable" ||
    code === "bounce_h264_encoder_unavailable"
  )
    return { message: "Bounce encoder is unavailable.", canRetry: true };
  if (code === "processing_timeout")
    return { message: "Media preparation timed out.", canRetry: true };
  if (reason?.kind === "network")
    return { message: "Media could not be reached.", canRetry: true };
  if (
    reason?.kind === "source" ||
    code === "source_changed" ||
    code === "stale_rendition"
  )
    return { message: "Media changed. Try again.", canRetry: true };
  if (reason?.kind === "browser" || code === "browser_playback_unsupported")
    return {
      message:
        kind === "bounce"
          ? "This browser cannot play Bounce."
          : "This browser cannot play this media.",
      canRetry: true
    };
  if (
    reason?.kind === "preparation" ||
    code === "presentation_processing_failed" ||
    code === "incomplete_rendition"
  )
    return {
      message:
        kind === "bounce"
          ? "Bounce could not be prepared."
          : "Media could not be prepared.",
      canRetry: true
    };
  return {
    message:
      kind === "image"
        ? "Image unavailable."
        : kind === "animation"
          ? "Animation unavailable."
          : kind === "bounce"
            ? "Bounce unavailable."
            : "Playback unavailable.",
    canRetry: true
  };
}
