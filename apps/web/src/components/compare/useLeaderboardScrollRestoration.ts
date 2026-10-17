import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AssetRecord } from "../../api/client";
import {
  checkpointScrollPositionOnPageLifecycle,
  flushSessionScrollPositions,
  readSessionScrollPosition,
  writeSessionScrollPosition
} from "../scroll-restoration";
import { leaderboardAnchorOffset } from "./leaderboard-restoration";

export function useLeaderboardScrollRestoration({
  assets,
  isContentReady,
  scrollContextKey
}: {
  assets: AssetRecord[];
  isContentReady: boolean;
  scrollContextKey: string;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const restoredContextRef = useRef<string | null>(null);
  const savedViewportHeightRef = useRef<number | null>(null);
  const latestRef = useRef({ assets, isContentReady, scrollContextKey });
  latestRef.current = { assets, isContentReady, scrollContextKey };

  const saveScrollPosition = useCallback((pendingScrollTop?: number) => {
    const scrollElement = scrollRef.current;
    const current = latestRef.current;
    if (
      !scrollElement ||
      !current.isContentReady ||
      restoredContextRef.current !== current.scrollContextKey
    ) {
      return;
    }

    if (pendingScrollTop !== undefined) {
      writeSessionScrollPosition("leaderboard", {
        contextKey: current.scrollContextKey,
        loadedCount: current.assets.length,
        scrollTop: pendingScrollTop
      });
      return;
    }

    const scrollTop = scrollElement.scrollTop;
    savedViewportHeightRef.current = scrollElement.clientHeight;
    const containerTop = scrollElement.getBoundingClientRect().top;
    const nodes = scrollElement.querySelectorAll<HTMLElement>(
      "[data-leaderboard-asset-id]"
    );
    let anchor: HTMLElement | undefined;
    for (const node of nodes) {
      anchor = node;
      if (node.getBoundingClientRect().bottom > containerTop) {
        break;
      }
    }
    const anchorId = anchor?.dataset.leaderboardAssetId;
    const anchorBounds = anchor?.getBoundingClientRect();
    const index = current.assets.findIndex((asset) => asset.id === anchorId);

    writeSessionScrollPosition("leaderboard", {
      anchorId,
      anchorOffset: anchorBounds ? containerTop - anchorBounds.top : undefined,
      anchorSize: anchorBounds?.height,
      contextKey: current.scrollContextKey,
      index: index >= 0 ? index : undefined,
      loadedCount: current.assets.length,
      scrollTop
    });
  }, []);

  const onScroll = useCallback(() => {
    pendingScrollTopRef.current = scrollRef.current?.scrollTop ?? null;
    if (scrollFrameRef.current !== null) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      pendingScrollTopRef.current = null;
      saveScrollPosition();
    });
  }, [saveScrollPosition]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!isContentReady) {
      restoredContextRef.current = null;
      return;
    }
    if (!scrollElement || restoredContextRef.current === scrollContextKey) {
      return;
    }

    const position = readSessionScrollPosition("leaderboard");
    if (position?.contextKey === scrollContextKey) {
      const anchorId = position.anchorId ?? assets[position.index ?? -1]?.id;
      const anchor = Array.from(
        scrollElement.querySelectorAll<HTMLElement>(
          "[data-leaderboard-asset-id]"
        )
      ).find((node) => node.dataset.leaderboardAssetId === anchorId);
      const anchorBounds = anchor?.getBoundingClientRect();
      scrollElement.scrollTop = anchorBounds
        ? scrollElement.scrollTop +
          anchorBounds.top -
          scrollElement.getBoundingClientRect().top +
          leaderboardAnchorOffset(position, anchorBounds.height)
        : position.scrollTop;
    } else {
      scrollElement.scrollTop = 0;
    }

    restoredContextRef.current = scrollContextKey;
    saveScrollPosition();
  }, [assets, isContentReady, saveScrollPosition, scrollContextKey]);

  useLayoutEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      // A sibling header can resize the viewport during the unmount commit.
      // Keep the last checkpoint if that resize has clamped the scroll position.
      if (scrollRef.current?.clientHeight === savedViewportHeightRef.current) {
        saveScrollPosition();
      } else if (pendingScrollTopRef.current !== null) {
        saveScrollPosition(pendingScrollTopRef.current);
      }
      flushSessionScrollPositions("leaderboard");
    },
    [saveScrollPosition]
  );

  useEffect(
    () =>
      checkpointScrollPositionOnPageLifecycle(
        "leaderboard",
        saveScrollPosition
      ),
    [saveScrollPosition]
  );

  return { onScroll, scrollRef };
}
