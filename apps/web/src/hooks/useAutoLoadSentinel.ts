import { useEffect, useRef, type MutableRefObject } from "react";

interface UseAutoLoadSentinelOptions {
  enabled: boolean;
  onLoadMore: () => void;
  rootMargin: string;
  rootRef: MutableRefObject<HTMLElement | null>;
  targetRef: MutableRefObject<HTMLElement | null>;
  targetKey?: string;
}

export function useAutoLoadSentinel({
  enabled,
  onLoadMore,
  rootMargin,
  rootRef,
  targetRef,
  targetKey
}: UseAutoLoadSentinelOptions) {
  const onLoadMoreRef = useRef(onLoadMore);
  const requestedWhileVisibleRef = useRef(false);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    requestedWhileVisibleRef.current = false;
  }, [enabled, targetKey]);

  useEffect(() => {
    const root = rootRef.current;
    const target = targetRef.current;

    if (
      !enabled ||
      !root ||
      !target ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting);

        if (!isIntersecting) {
          requestedWhileVisibleRef.current = false;
          return;
        }

        if (requestedWhileVisibleRef.current) {
          return;
        }

        requestedWhileVisibleRef.current = true;
        onLoadMoreRef.current();
      },
      {
        root,
        rootMargin
      }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [enabled, rootMargin, rootRef, targetRef, targetKey]);
}
