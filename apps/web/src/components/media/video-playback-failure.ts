import {
  ApiTimeoutError,
  inspectVideoPlaybackFailure,
  type VideoPlaybackFailure
} from "../../api/client";

/** Compatibility fallback must not turn transient failures into larger fetches. */
export function canFallbackFromVideoFailure(failure: VideoPlaybackFailure) {
  return (
    failure.kind === "browser" ||
    (failure.kind === "preparation" &&
      failure.code === "media_preparation_failed" &&
      failure.status === 415)
  );
}

/** One diagnostic per failed source; cancellation also rejects late results. */
export function observeVideoPlaybackFailure(
  source: string,
  publish: (failure: VideoPlaybackFailure | null) => void,
  ownerDocument: Document,
  inspect = inspectVideoPlaybackFailure
) {
  let controller: AbortController | null = null;
  let attempted = false;
  let disposed = false;
  const cancel = () => {
    controller?.abort();
    controller = null;
  };
  const hidden = () => {
    if (ownerDocument.hidden) cancel();
  };
  ownerDocument.addEventListener("visibilitychange", hidden);
  ownerDocument.defaultView?.addEventListener("pagehide", cancel);
  return {
    diagnose(
      video: HTMLVideoElement,
      onDiagnosed?: (failure: VideoPlaybackFailure) => void
    ) {
      if (
        disposed ||
        attempted ||
        ownerDocument.hidden ||
        video.getAttribute("src") !== source
      )
        return;
      attempted = true;
      const mediaErrorCode = video.error?.code;
      const request = new AbortController();
      controller = request;
      const current = () =>
        !disposed &&
        controller === request &&
        !request.signal.aborted &&
        !ownerDocument.hidden &&
        video.getAttribute("src") === source;
      void inspect(source, request.signal).then(
        (failure) => {
          if (!current()) return;
          const result: VideoPlaybackFailure =
            failure.kind === "browser" && mediaErrorCode === 2
              ? { kind: "network", code: "media_network_failed" }
              : failure;
          publish(result);
          onDiagnosed?.(result);
        },
        (error: unknown) => {
          if (current()) {
            const failure: VideoPlaybackFailure = {
              kind: "network",
              code:
                error instanceof ApiTimeoutError
                  ? "request_timeout"
                  : "media_network_failed"
            };
            publish(failure);
            onDiagnosed?.(failure);
          }
        }
      );
    },
    clear() {
      if (disposed) return;
      cancel();
      attempted = false;
      publish(null);
    },
    dispose() {
      disposed = true;
      cancel();
      ownerDocument.removeEventListener("visibilitychange", hidden);
      ownerDocument.defaultView?.removeEventListener("pagehide", cancel);
    }
  };
}
