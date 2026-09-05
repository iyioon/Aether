import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { GalleryHorizontalEnd } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { useAutoLoadSentinel } from "../../hooks/useAutoLoadSentinel";
import { FeedItem, type FeedSoundState } from "./FeedItem";
import { FeedNavRail } from "./FeedNavRail";
import {
  FEED_PRELOAD_DISTANCE,
  FEED_TOUCH_DISTANCE,
  FEED_TOUCH_VELOCITY,
  FEED_WHEEL_LOCK_MS,
  FEED_WHEEL_THRESHOLD,
  feedItemTop,
  isInteractiveTarget,
  nearestFeedIndexFromScroll
} from "./feed-navigation";

interface FeedTouchStart {
  x: number;
  y: number;
  index: number;
  time: number;
}

interface FeedPreviewProps {
  assets: AssetRecord[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  isFeedChromeHidden: boolean;
  isPlaybackPaused: boolean;
  syncedAssetId: string | null;
  onLoadMore: () => void;
  onFeedChromeHiddenChange: (isHidden: boolean) => void;
  onOpenAnnotations: (assetId: string) => void;
  onOpenAsset: (assetId: string) => void;
}

export function FeedPreview({
  assets,
  isLoading,
  isLoadingMore,
  hasMore,
  loadMoreRef,
  isFeedChromeHidden,
  isPlaybackPaused,
  syncedAssetId,
  onLoadMore,
  onFeedChromeHiddenChange,
  onOpenAnnotations,
  onOpenAsset
}: FeedPreviewProps) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const feedScrollFrameRef = useRef<number | null>(null);
  const wheelLockUntilRef = useRef(0);
  const touchStartRef = useRef<FeedTouchStart | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFeedMuted, setIsFeedMuted] = useState(false);
  const [isFeedAudioBlocked, setIsFeedAudioBlocked] = useState(false);
  const [audiblePlaybackRequest, setAudiblePlaybackRequest] = useState(0);
  const firstAssetId = assets[0]?.id ?? "";
  const feedSoundState: FeedSoundState = isFeedAudioBlocked
    ? "blocked"
    : isFeedMuted
      ? "muted"
      : "on";

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, assets.length);
  }, [assets.length]);

  useEffect(() => {
    setActiveIndex(0);
    feedRef.current?.scrollTo({ top: 0 });
  }, [firstAssetId]);

  useEffect(() => {
    if (!syncedAssetId) {
      return;
    }

    const syncedIndex = assets.findIndex((asset) => asset.id === syncedAssetId);

    if (syncedIndex < 0) {
      return;
    }

    const feedElement = feedRef.current;
    const syncedItem = itemRefs.current[syncedIndex];
    setActiveIndex(syncedIndex);

    if (!feedElement || !syncedItem) {
      return;
    }

    const targetTop = feedItemTop(feedElement, syncedItem);

    if (Math.abs(feedElement.scrollTop - targetTop) <= 1) {
      return;
    }

    feedElement.scrollTo({ top: targetTop, behavior: "auto" });
  }, [assets, syncedAssetId]);

  useEffect(
    () => () => {
      if (feedScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(feedScrollFrameRef.current);
      }
    },
    []
  );

  const syncActiveFeedIndex = useCallback(() => {
    setActiveIndex(nearestFeedIndexFromScroll(feedRef.current, itemRefs.current));
  }, []);

  const handleFeedScroll = useCallback(() => {
    if (feedScrollFrameRef.current !== null) {
      return;
    }

    feedScrollFrameRef.current = window.requestAnimationFrame(() => {
      feedScrollFrameRef.current = null;
      syncActiveFeedIndex();
    });
  }, [syncActiveFeedIndex]);

  const scrollToFeedItem = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, assets.length - 1));
      const nextItem = itemRefs.current[nextIndex];
      const feedElement = feedRef.current;

      if (!nextItem || !feedElement) {
        return;
      }

      feedElement.scrollTo({
        top: feedItemTop(feedElement, nextItem),
        behavior: "smooth"
      });
      setActiveIndex(nextIndex);

      if (hasMore && nextIndex >= assets.length - 2) {
        onLoadMore();
      }
    },
    [assets.length, hasMore, onLoadMore]
  );

  const toggleFeedChrome = useCallback(() => {
    onFeedChromeHiddenChange(!isFeedChromeHidden);
  }, [isFeedChromeHidden, onFeedChromeHiddenChange]);

  const handleAudibleAutoplayBlocked = useCallback(() => {
    setIsFeedAudioBlocked(true);
    setIsFeedMuted(true);
  }, []);

  const handleAudiblePlaybackStarted = useCallback(() => {
    setIsFeedAudioBlocked(false);
  }, []);

  const playActiveFeedVideoAudibly = useCallback(() => {
    const activeItem = itemRefs.current[activeIndex];
    const activeVideo = activeItem?.querySelector<HTMLVideoElement>("video");

    if (!activeVideo) {
      return;
    }

    activeVideo.muted = false;

    if (activeVideo.volume === 0) {
      activeVideo.volume = 1;
    }

    activeVideo
      .play()
      .then(() => {
        setIsFeedAudioBlocked(false);
      })
      .catch(() => {
        activeVideo.muted = true;
        setIsFeedAudioBlocked(true);
        setIsFeedMuted(true);
      });
  }, [activeIndex]);

  const handleFeedSoundToggle = useCallback(() => {
    if (isFeedMuted) {
      setIsFeedAudioBlocked(false);
      setIsFeedMuted(false);
      setAudiblePlaybackRequest((current) => current + 1);
      playActiveFeedVideoAudibly();
      return;
    }

    setIsFeedAudioBlocked(false);
    setIsFeedMuted(true);
  }, [isFeedMuted, playActiveFeedVideoAudibly]);

  const pageFeedBy = useCallback(
    (delta: number) => {
      const currentIndex = nearestFeedIndexFromScroll(
        feedRef.current,
        itemRefs.current
      );
      scrollToFeedItem(currentIndex + delta);
    },
    [scrollToFeedItem]
  );

  const handleFeedKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }

      const currentIndex = nearestFeedIndexFromScroll(
        feedRef.current,
        itemRefs.current
      );

      switch (event.key) {
        case "ArrowDown":
        case "PageDown":
        case " ":
          event.preventDefault();
          scrollToFeedItem(currentIndex + 1);
          break;
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          scrollToFeedItem(currentIndex - 1);
          break;
        case "Home":
          event.preventDefault();
          scrollToFeedItem(0);
          break;
        case "End":
          event.preventDefault();
          scrollToFeedItem(assets.length - 1);
          break;
        default:
          break;
      }
    },
    [assets.length, scrollToFeedItem]
  );

  const handleFeedWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (
        isInteractiveTarget(event.target) ||
        assets.length === 0 ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
        Math.abs(event.deltaY) < FEED_WHEEL_THRESHOLD
      ) {
        return;
      }

      event.preventDefault();
      const now = window.performance.now();

      if (now < wheelLockUntilRef.current) {
        return;
      }

      wheelLockUntilRef.current = now + FEED_WHEEL_LOCK_MS;
      pageFeedBy(event.deltaY > 0 ? 1 : -1);
    },
    [assets.length, pageFeedBy]
  );

  const handleFeedTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const touch = event.changedTouches[0];

      if (!touch || isInteractiveTarget(event.target)) {
        touchStartRef.current = null;
        return;
      }

      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        index: nearestFeedIndexFromScroll(feedRef.current, itemRefs.current),
        time: window.performance.now()
      };
    },
    []
  );

  const handleFeedTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      touchStartRef.current = null;

      if (!start || !touch || assets.length === 0) {
        return;
      }

      const deltaX = touch.clientX - start.x;
      const deltaY = start.y - touch.clientY;
      const elapsedMs = Math.max(1, window.performance.now() - start.time);
      const velocity = Math.abs(deltaY) / elapsedMs;
      const isVerticalGesture = Math.abs(deltaY) > Math.abs(deltaX) * 1.2;
      const hasIntent =
        Math.abs(deltaY) >= FEED_TOUCH_DISTANCE ||
        (Math.abs(deltaY) >= 32 && velocity >= FEED_TOUCH_VELOCITY);

      if (!isVerticalGesture || !hasIntent) {
        return;
      }

      scrollToFeedItem(start.index + (deltaY > 0 ? 1 : -1));
    },
    [assets.length, scrollToFeedItem]
  );

  useAutoLoadSentinel({
    enabled: hasMore && !isLoading && !isLoadingMore,
    onLoadMore,
    rootMargin: "620px 0px",
    rootRef: feedRef,
    targetRef: loadMoreRef
  });

  if (isLoading) {
    return (
      <section className="feed-shell" aria-label="Feed view">
        <div className="feed-view">
          <article className="feed-item">
            <div className="feed-frame">
              <div className="media-skeleton" />
            </div>
          </article>
        </div>
      </section>
    );
  }

  if (assets.length === 0) {
    return (
      <section className="empty-library">
        <GalleryHorizontalEnd size={22} />
        <strong>No media in this feed</strong>
        <span>Adjust filters or run a scan after adding local media.</span>
      </section>
    );
  }

  return (
    <section
      className="feed-shell"
      aria-label="Feed view"
      tabIndex={0}
      onKeyDown={handleFeedKeyDown}
      onTouchEnd={handleFeedTouchEnd}
      onTouchStart={handleFeedTouchStart}
      onWheel={handleFeedWheel}
    >
      <div className="feed-view" ref={feedRef} onScroll={handleFeedScroll}>
        {assets.map((asset, index) => (
          <FeedItem
            activeIndex={activeIndex}
            asset={asset}
            audiblePlaybackRequest={audiblePlaybackRequest}
            feedSoundState={feedSoundState}
            index={index}
            isFeedChromeHidden={isFeedChromeHidden}
            isFeedMuted={isFeedMuted}
            isPlaybackPaused={isPlaybackPaused}
            key={asset.id}
            loadMoreRef={loadMoreRef}
            preloadPreview={
              asset.mediaType === "video" &&
              Math.abs(index - activeIndex) <= FEED_PRELOAD_DISTANCE
            }
            showLoadSentinel={hasMore && index === assets.length - 1}
            onAudibleAutoplayBlocked={handleAudibleAutoplayBlocked}
            onAudiblePlaybackStarted={handleAudiblePlaybackStarted}
            onFeedSoundToggle={handleFeedSoundToggle}
            onOpenAnnotations={onOpenAnnotations}
            onOpenAsset={onOpenAsset}
            onRegisterItem={(itemIndex, node) => {
              itemRefs.current[itemIndex] = node;
            }}
            onToggleFeedChrome={toggleFeedChrome}
          />
        ))}
      </div>
      <FeedNavRail
        activeIndex={activeIndex}
        assetCount={assets.length}
        hasMore={hasMore}
        onNext={() =>
          scrollToFeedItem(
            nearestFeedIndexFromScroll(feedRef.current, itemRefs.current) + 1
          )
        }
        onPrevious={() =>
          scrollToFeedItem(
            nearestFeedIndexFromScroll(feedRef.current, itemRefs.current) - 1
          )
        }
      />
    </section>
  );
}
