import { useCallback, useEffect, useRef, useState } from "react";
import type { TreeResponse } from "../../api/client";
import { hasOpenKeyboardLayer } from "../../lib/keyboard";

export function useManagedLibraryRefresh(options: {
  isBusy: boolean;
  refreshTree: (signal?: AbortSignal) => Promise<TreeResponse>;
  onRefresh: (tree: TreeResponse) => void;
  onError: () => void;
}) {
  const [request, setRequest] = useState(0);
  const acceptedRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const scheduleRefresh = useCallback(() => {
    setRequest((current) => current + 1);
  }, []);
  const canRefresh = useCallback(
    () =>
      !optionsRef.current.isBusy &&
      document.visibilityState !== "hidden" &&
      !hasOpenKeyboardLayer(document) &&
      !document.querySelector(".score-control [data-pressing]") &&
      !(
        document.activeElement instanceof Element &&
        document.activeElement.closest(".score-control")
      ),
    []
  );

  useEffect(() => {
    if (!request || acceptedRef.current === request) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let running = false;
    let supersededRetries = 0;
    let refreshedTree: TreeResponse | undefined;
    const publish = () => {
      if (!refreshedTree || controller.signal.aborted || !canRefresh()) return;
      acceptedRef.current = request;
      stopWatching();
      optionsRef.current.onRefresh(refreshedTree);
    };
    const schedule = () => {
      if (
        controller.signal.aborted ||
        running ||
        acceptedRef.current === request
      )
        return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "hidden") return;
        if (refreshedTree) {
          publish();
          return;
        }
        running = true;
        let retry = false;
        void optionsRef.current
          .refreshTree(controller.signal)
          .then((tree) => {
            if (controller.signal.aborted) return;
            refreshedTree = tree;
            publish();
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              if (
                error instanceof DOMException &&
                error.name === "AbortError" &&
                supersededRetries < 2
              ) {
                supersededRetries += 1;
                retry = true;
                return;
              }
              acceptedRef.current = request;
              stopWatching();
              optionsRef.current.onError();
            }
          })
          .finally(() => {
            running = false;
            if (retry) schedule();
          });
      }, 200);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"]
    });
    window.addEventListener("pointerup", schedule);
    window.addEventListener("focusout", schedule);
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", schedule);
    function stopWatching() {
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("pointerup", schedule);
      window.removeEventListener("focusout", schedule);
      window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", schedule);
    }
    return () => {
      controller.abort();
      stopWatching();
    };
  }, [request, options.isBusy, canRefresh]);

  return { scheduleRefresh, canRefresh };
}
