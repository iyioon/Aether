import {
  ApiTimeoutError,
  inspectVideoPlaybackFailure,
  type VideoPlaybackFailure
} from "../../api/client";

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
    diagnose(video: HTMLVideoElement) {
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
          if (current())
            publish(
              failure.kind === "browser" && mediaErrorCode === 2
                ? { kind: "network", code: "media_network_failed" }
                : failure
            );
        },
        (error: unknown) => {
          if (current())
            publish({
              kind: "network",
              code:
                error instanceof ApiTimeoutError
                  ? "request_timeout"
                  : "media_network_failed"
            });
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
