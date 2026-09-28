import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type UIEvent as ReactUIEvent
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp, Download, SlidersHorizontal } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { useAutoLoadSentinel } from "../../hooks/useAutoLoadSentinel";
import type { AspectMode, GridSize } from "../library-state";
import { GalleryCardCuration } from "../GalleryCardCuration";
import { MediaPreview } from "../media/MediaPreview";
import { downloadUrl } from "../media/media-urls";
import {
  findScrollAnchorItem,
  readSessionScrollPosition,
  scaleScrollAnchorOffset,
  writeSessionScrollPosition
} from "../scroll-restoration";
import {
  chunkAssetsIntoRows,
  estimateGalleryRowHeight,
  galleryAspectRatio,
  galleryColumnCount,
  galleryMinTileWidth,
  gallerySecondaryMetadata,
  galleryTileChromeHeight,
  GALLERY_GRID_GAP,
  mediaTileStyle
} from "./gallery-layout";
import type { GalleryMetadataField } from "./gallery-metadata";
import { GalleryCardSkeleton } from "./GalleryCardSkeleton";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

interface GalleryGridProps {
  assets: AssetRecord[];
  aspect: AspectMode;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isContentReady: boolean;
  isSelectionMode: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  measuredAspectRatios: Record<string, string>;
  scrollContextKey: string;
  syncedAssetId: string | null;
  savingScoreAssetIds: ReadonlySet<string>;
  selectedAssetIds: ReadonlySet<string>;
  onLoadMore: () => void;
  onActiveAssetChange: (assetId: string) => void;
  onFavoriteAsset: (asset: AssetRecord, favorite: boolean) => void;
  onMediaDimensionsKnown: (assetId: string, width: number, height: number) => void;
  onScoreAsset: (asset: AssetRecord, score: number) => void;
  onSelectAsset: (assetId: string) => void;
  onToggleSelection: (assetId: string) => void;
}

export function GalleryGrid({
  assets,
  aspect,
  metadataFields,
  gridSize,
  hasMore,
  isLoading,
  isLoadingMore,
  isContentReady,
  isSelectionMode,
  loadMoreRef,
  measuredAspectRatios,
  scrollContextKey,
  syncedAssetId,
  savingScoreAssetIds,
  selectedAssetIds,
  onLoadMore,
  onActiveAssetChange,
  onFavoriteAsset,
  onMediaDimensionsKnown,
  onScoreAsset,
  onSelectAsset,
  onToggleSelection
}: GalleryGridProps) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const loadingLayerRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
  const restoredContextRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  const contextKeyRef = useRef(scrollContextKey);
  const assetsRef = useRef(assets);
  const columnCountRef = useRef(1);
  const lastReportedAnchorIdRef = useRef<string | null>(null);
  const layoutSignatureRef = useRef<string | null>(null);
  const scrollTopVisibleRef = useRef(false);
  const onActiveAssetChangeRef = useRef(onActiveAssetChange);
  contextKeyRef.current = scrollContextKey;
  assetsRef.current = assets;
  onActiveAssetChangeRef.current = onActiveAssetChange;
  const [containerWidth, setContainerWidth] = useState(0);
  const [isScrollPositionReady, setIsScrollPositionReady] = useState(false);
  const [isScrollTopVisible, setIsScrollTopVisible] = useState(false);
  const minTileWidth = galleryMinTileWidth(gridSize);
  const columnCount = galleryColumnCount(containerWidth, minTileWidth);
  const layoutSignature = [
    gridSize,
    aspect,
    columnCount,
    ...Array.from(metadataFields).sort()
  ].join(":");
  const rows = useMemo(
    () => chunkAssetsIntoRows(assets, columnCount),
    [assets, columnCount]
  );
  const estimateRowSize = useCallback(
    (index: number) =>
      estimateGalleryRowHeight({
        aspect,
        columnCount,
        containerWidth,
        measuredAspectRatios,
        metadataFields,
        minTileWidth,
        rowAssets: rows[index]
      }),
    [
      aspect,
      columnCount,
      containerWidth,
      measuredAspectRatios,
      metadataFields,
      minTileWidth,
      rows
    ]
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: estimateRowSize,
    getItemKey: (index) => rows[index]?.[0]?.id ?? index,
    gap: GALLERY_GRID_GAP,
    overscan: 7
  });
  const rowVirtualizerRef = useRef(rowVirtualizer);
  rowVirtualizerRef.current = rowVirtualizer;
  columnCountRef.current = columnCount;

  useLayoutEffect(() => {
    const observedElement = scrollParentRef.current;

    if (!observedElement) {
      return;
    }

    const element: HTMLDivElement = observedElement;

    function updateWidth() {
      const styles = window.getComputedStyle(element);
      const horizontalPadding =
        (Number.parseFloat(styles.paddingLeft) || 0) +
        (Number.parseFloat(styles.paddingRight) || 0);
      setContainerWidth(Math.max(0, element.clientWidth - horizontalPadding));
    }

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);

      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    lastReportedAnchorIdRef.current = null;
    scrollTopVisibleRef.current = false;
    setIsScrollTopVisible(false);
    setIsScrollPositionReady(false);
  }, [scrollContextKey]);

  const saveScrollPosition = useCallback(() => {
    if (
      isRestoringRef.current ||
      restoredContextRef.current !== contextKeyRef.current
    ) {
      return;
    }

    const scrollElement = scrollParentRef.current;
    const scrollTop = scrollElement?.scrollTop ?? latestScrollTopRef.current;
    const virtualRows = rowVirtualizerRef.current.getVirtualItems();
    const anchorRow = findScrollAnchorItem(virtualRows, scrollTop);
    const anchorIndex = anchorRow
      ? anchorRow.index * columnCountRef.current
      : 0;
    const currentAssets = assetsRef.current;
    const anchorId = currentAssets[anchorIndex]?.id;

    if (anchorId && lastReportedAnchorIdRef.current !== anchorId) {
      lastReportedAnchorIdRef.current = anchorId;
      onActiveAssetChangeRef.current(anchorId);
    }

    writeSessionScrollPosition("library-content", {
      anchorId,
      anchorOffset: anchorRow ? scrollTop - anchorRow.start : 0,
      anchorSize: anchorRow?.size,
      contextKey: contextKeyRef.current,
      index: anchorIndex,
      scrollTop
    });
  }, []);

  const handleScroll = useCallback((event: ReactUIEvent<HTMLElement>) => {
    const scrollElement = event.currentTarget;
    const scrollTop = scrollElement.scrollTop;
    const shouldShowScrollTop =
      scrollTop > Math.max(320, scrollElement.clientHeight * 0.65);
    latestScrollTopRef.current = scrollTop;

    if (scrollTopVisibleRef.current !== shouldShowScrollTop) {
      scrollTopVisibleRef.current = shouldShowScrollTop;
      setIsScrollTopVisible(shouldShowScrollTop);
    }

    if (isRestoringRef.current || scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      saveScrollPosition();
    });
  }, [saveScrollPosition]);

  const scrollToTop = useCallback(() => {
    const scrollElement = scrollParentRef.current;

    if (!scrollElement) {
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    scrollElement.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth"
    });
    scrollElement.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const scrollElement = scrollParentRef.current;

    if (
      !scrollElement ||
      !isContentReady ||
      assets.length === 0 ||
      containerWidth === 0 ||
      restoredContextRef.current === scrollContextKey
    ) {
      return;
    }

    const storedPosition = readSessionScrollPosition("library-content");
    const shouldRestore = storedPosition?.contextKey === scrollContextKey;
    const syncedIndex = syncedAssetId
      ? assets.findIndex((asset) => asset.id === syncedAssetId)
      : -1;
    const anchoredIndex =
      shouldRestore && storedPosition.anchorId
        ? assets.findIndex((asset) => asset.id === storedPosition.anchorId)
        : -1;
    const intendedIndex =
      syncedIndex >= 0
        ? syncedIndex
        : shouldRestore
          ? anchoredIndex >= 0
            ? anchoredIndex
            : storedPosition.index ?? 0
          : 0;

    if (intendedIndex >= assets.length && hasMore) {
      if (!isLoadingMore) {
        onLoadMore();
      }
      return;
    }

    restoredContextRef.current = scrollContextKey;
    isRestoringRef.current = true;
    let didCompleteRestoration = false;
    const assetIndex = Math.max(0, Math.min(intendedIndex, assets.length - 1));
    const rowIndex = Math.floor(assetIndex / Math.max(1, columnCount));
    const isSyncedTarget = syncedIndex >= 0;
    const shouldRestoreAnchor = shouldRestore && !isSyncedTarget;
    const anchorOffset = shouldRestoreAnchor
      ? storedPosition.anchorOffset ?? 0
      : 0;
    const fallbackTop = shouldRestoreAnchor
      ? storedPosition.scrollTop
      : 0;
    const rowOffset = rowVirtualizer.getOffsetForIndex(rowIndex, "start")?.[0];
    const requestedScrollTop =
      rowOffset === undefined ? fallbackTop : rowOffset + anchorOffset;
    const previousScrollTop = scrollElement.scrollTop;
    scrollElement.scrollTop = Math.max(0, requestedScrollTop);
    const restoredScrollTop = scrollElement.scrollTop;
    loadingLayerRef.current?.style.setProperty(
      "--gallery-loading-compensation",
      `${restoredScrollTop - previousScrollTop}px`
    );
    latestScrollTopRef.current = restoredScrollTop;
    let lastObservedScrollTop = restoredScrollTop;
    let stableFrameCount = 0;
    let observedFrameCount = 0;

    const finishWhenMeasurementsSettle = () => {
      const currentScrollTop = scrollElement.scrollTop;
      loadingLayerRef.current?.style.setProperty(
        "--gallery-loading-compensation",
        `${currentScrollTop - previousScrollTop}px`
      );

      if (Math.abs(currentScrollTop - lastObservedScrollTop) <= 0.5) {
        stableFrameCount += 1;
      } else {
        stableFrameCount = 0;
      }

      lastObservedScrollTop = currentScrollTop;
      latestScrollTopRef.current = currentScrollTop;
      observedFrameCount += 1;

      if (stableFrameCount < 2 && observedFrameCount < 8) {
        restoreFrameRef.current = window.requestAnimationFrame(
          finishWhenMeasurementsSettle
        );
        return;
      }

      restoreFrameRef.current = null;
      isRestoringRef.current = false;
      if (isSyncedTarget && syncedAssetId) {
        writeSessionScrollPosition("library-content", {
          anchorId: syncedAssetId,
          anchorOffset: 0,
          anchorSize: rowVirtualizer
            .getVirtualItems()
            .find((row) => row.index === rowIndex)?.size,
          contextKey: scrollContextKey,
          index: assetIndex,
          scrollTop: currentScrollTop
        });
      } else {
        saveScrollPosition();
      }
      didCompleteRestoration = true;
      setIsScrollPositionReady(true);
    };

    restoreFrameRef.current = window.requestAnimationFrame(
      finishWhenMeasurementsSettle
    );

    return () => {
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = null;
      }
      isRestoringRef.current = false;

      if (
        !didCompleteRestoration &&
        restoredContextRef.current === scrollContextKey
      ) {
        restoredContextRef.current = null;
      }
    };
  }, [
    assets,
    columnCount,
    containerWidth,
    hasMore,
    isContentReady,
    isLoadingMore,
    onLoadMore,
    rowVirtualizer,
    saveScrollPosition,
    scrollContextKey,
    syncedAssetId
  ]);

  useLayoutEffect(() => {
    const previousLayoutSignature = layoutSignatureRef.current;
    layoutSignatureRef.current = layoutSignature;

    if (
      previousLayoutSignature === null ||
      previousLayoutSignature === layoutSignature ||
      !isContentReady ||
      !isScrollPositionReady ||
      restoredContextRef.current !== scrollContextKey
    ) {
      return;
    }

    const scrollElement = scrollParentRef.current;
    const storedPosition = readSessionScrollPosition("library-content");

    if (
      !scrollElement ||
      storedPosition?.contextKey !== scrollContextKey
    ) {
      return;
    }

    const anchorIndex = storedPosition.anchorId
      ? assets.findIndex((asset) => asset.id === storedPosition.anchorId)
      : storedPosition.index ?? -1;

    if (anchorIndex < 0 || anchorIndex >= assets.length) {
      return;
    }

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    if (syncFrameRef.current !== null) {
      window.cancelAnimationFrame(syncFrameRef.current);
      syncFrameRef.current = null;
    }
    if (layoutFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = null;
    }

    const anchorAsset = assets[anchorIndex];
    const rowIndex = Math.floor(anchorIndex / Math.max(1, columnCount));
    const expectedLayoutSignature = layoutSignature;
    isRestoringRef.current = true;

    const positionAnchor = (preferMeasuredSize: boolean) => {
      const rowOffset = rowVirtualizer.getOffsetForIndex(
        rowIndex,
        "start"
      )?.[0];

      if (rowOffset === undefined) {
        return false;
      }

      const measuredRowSize = preferMeasuredSize
        ? rowVirtualizer
            .getVirtualItems()
            .find((row) => row.index === rowIndex)?.size
        : undefined;
      const nextAnchorSize =
        measuredRowSize ?? Math.max(1, estimateRowSize(rowIndex));
      const nextAnchorOffset = scaleScrollAnchorOffset(
        storedPosition.anchorOffset,
        storedPosition.anchorSize,
        nextAnchorSize
      );
      const nextScrollTop = Math.max(0, rowOffset + nextAnchorOffset);

      scrollElement.scrollTop = nextScrollTop;
      latestScrollTopRef.current = scrollElement.scrollTop;
      lastReportedAnchorIdRef.current = anchorAsset?.id ?? null;
      writeSessionScrollPosition("library-content", {
        anchorId: anchorAsset?.id,
        anchorOffset: nextAnchorOffset,
        anchorSize: nextAnchorSize,
        contextKey: scrollContextKey,
        index: anchorIndex,
        scrollTop: scrollElement.scrollTop
      });
      return true;
    };

    if (!positionAnchor(false)) {
      isRestoringRef.current = false;
      return;
    }

    layoutFrameRef.current = window.requestAnimationFrame(() => {
      layoutFrameRef.current = null;

      if (
        layoutSignatureRef.current !== expectedLayoutSignature ||
        contextKeyRef.current !== scrollContextKey
      ) {
        return;
      }

      positionAnchor(true);
      isRestoringRef.current = false;
    });
  }, [
    assets,
    columnCount,
    estimateRowSize,
    isContentReady,
    isScrollPositionReady,
    layoutSignature,
    rowVirtualizer,
    scrollContextKey
  ]);

  useLayoutEffect(() => {
    if (
      !syncedAssetId ||
      syncedAssetId === lastReportedAnchorIdRef.current ||
      !isContentReady ||
      isRestoringRef.current ||
      restoredContextRef.current !== scrollContextKey
    ) {
      return;
    }

    const assetIndex = assets.findIndex((asset) => asset.id === syncedAssetId);

    if (assetIndex < 0) {
      return;
    }

    const scrollElement = scrollParentRef.current;

    if (!scrollElement) {
      return;
    }

    const rowIndex = Math.floor(assetIndex / Math.max(1, columnCount));
    const rowOffset = rowVirtualizer.getOffsetForIndex(rowIndex, "start")?.[0];

    if (rowOffset === undefined) {
      return;
    }

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    isRestoringRef.current = true;
    lastReportedAnchorIdRef.current = syncedAssetId;
    writeSessionScrollPosition("library-content", {
      anchorId: syncedAssetId,
      anchorOffset: 0,
      anchorSize: rowVirtualizer
        .getVirtualItems()
        .find((row) => row.index === rowIndex)?.size,
      contextKey: scrollContextKey,
      index: assetIndex,
      scrollTop: rowOffset
    });
    scrollElement.scrollTo({
      top: rowOffset,
      behavior: reduceMotion ? "auto" : "smooth"
    });

    let stableFrameCount = 0;
    let frameCount = 0;

    const finishSmoothSync = () => {
      const currentScrollTop = scrollElement.scrollTop;
      latestScrollTopRef.current = currentScrollTop;

      if (Math.abs(currentScrollTop - rowOffset) <= 1) {
        stableFrameCount += 1;
      } else {
        stableFrameCount = 0;
      }

      frameCount += 1;

      if (stableFrameCount < 2 && frameCount < 60) {
        syncFrameRef.current = window.requestAnimationFrame(finishSmoothSync);
        return;
      }

      syncFrameRef.current = null;
      isRestoringRef.current = false;
      writeSessionScrollPosition("library-content", {
        anchorId: syncedAssetId,
        anchorOffset: 0,
        anchorSize: rowVirtualizer
          .getVirtualItems()
          .find((row) => row.index === rowIndex)?.size,
        contextKey: scrollContextKey,
        index: assetIndex,
        scrollTop: currentScrollTop
      });
    };

    syncFrameRef.current = window.requestAnimationFrame(finishSmoothSync);

    return () => {
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
        syncFrameRef.current = null;
      }

      isRestoringRef.current = false;
    };
  }, [
    assets,
    columnCount,
    isContentReady,
    rowVirtualizer,
    scrollContextKey,
    syncedAssetId
  ]);

  useLayoutEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
      }
      if (layoutFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
      }
      saveScrollPosition();
    },
    [saveScrollPosition]
  );

  useEffect(() => {
    window.addEventListener("pagehide", saveScrollPosition);
    return () => window.removeEventListener("pagehide", saveScrollPosition);
  }, [saveScrollPosition]);

  useAutoLoadSentinel({
    enabled: hasMore && !isLoading && !isLoadingMore,
    onLoadMore,
    rootMargin: "380px 0px",
    rootRef: scrollParentRef,
    targetRef: loadMoreRef
  });

  const isInitialLoading = isLoading && assets.length === 0;
  const isRefreshing = isLoading && assets.length > 0;
  const showInitialSkeletonLayer =
    isInitialLoading || (assets.length > 0 && !isScrollPositionReady);
  const skeletonHasTitle = metadataFields.has("title");
  const skeletonHasSecondaryMetadata =
    metadataFields.has("mediaType") || metadataFields.has("size");
  const skeletonHasCuration =
    metadataFields.has("score") ||
    metadataFields.has("favorite") ||
    metadataFields.has("tags");
  const storedSkeletonPosition = showInitialSkeletonLayer
    ? readSessionScrollPosition("library-content")
    : null;
  const shouldPositionSkeleton =
    storedSkeletonPosition?.contextKey === scrollContextKey;
  const skeletonScrollTop = shouldPositionSkeleton
    ? storedSkeletonPosition.scrollTop
    : 0;
  const skeletonAnchorOffset = shouldPositionSkeleton
    ? storedSkeletonPosition.anchorOffset ?? 0
    : 0;
  const skeletonSavedRowHeight = shouldPositionSkeleton
    ? storedSkeletonPosition.anchorSize
    : undefined;
  const skeletonRowStart = Math.max(
    0,
    skeletonScrollTop - skeletonAnchorOffset
  );
  const skeletonContainerWidth =
    containerWidth > 0
      ? containerWidth
      : typeof window === "undefined"
        ? minTileWidth
        : window.innerWidth;
  const skeletonColumnCount = galleryColumnCount(
    skeletonContainerWidth,
    minTileWidth
  );
  const skeletonTileWidth =
    (skeletonContainerWidth -
      GALLERY_GRID_GAP * Math.max(0, skeletonColumnCount - 1)) /
    skeletonColumnCount;
  const skeletonRowHeight =
    (skeletonSavedRowHeight ??
      skeletonTileWidth / galleryAspectRatio(aspect) +
        galleryTileChromeHeight(metadataFields)) +
    GALLERY_GRID_GAP;
  const skeletonViewportHeight =
    typeof window === "undefined" ? 900 : window.innerHeight;
  const skeletonRowCount = Math.max(
    3,
    Math.ceil(
      (skeletonViewportHeight + skeletonAnchorOffset) /
        Math.max(1, skeletonRowHeight)
    ) + 2
  );
  const skeletonItemCount = Math.max(
    18,
    skeletonColumnCount * skeletonRowCount
  );

  useLayoutEffect(() => {
    if (!isInitialLoading || skeletonScrollTop <= 0) {
      return;
    }

    const scrollElement = scrollParentRef.current;

    if (!scrollElement) {
      return;
    }

    latestScrollTopRef.current = skeletonScrollTop;
    scrollElement.scrollTo({ top: skeletonScrollTop, behavior: "auto" });
  }, [isInitialLoading, skeletonScrollTop]);

  const initialSkeletonLayer = showInitialSkeletonLayer ? (
    <div
      className={[
        "gallery-loading-layer",
        !isInitialLoading ? "is-overlay" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
      ref={loadingLayerRef}
    >
      {skeletonRowStart > 0 ? (
        <div
          className="gallery-skeleton-offset"
          style={{ height: skeletonRowStart }}
        />
      ) : null}
      <div
        className={[
          "gallery-grid gallery-skeleton-grid",
          skeletonSavedRowHeight ? "has-saved-row-height" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        data-size={gridSize}
        data-aspect={aspect}
        style={
          skeletonSavedRowHeight
            ? ({
                "--gallery-skeleton-row-height": `${skeletonSavedRowHeight}px`
              } as CSSProperties)
            : undefined
        }
      >
        {Array.from({ length: skeletonItemCount }).map((_, index) => (
          <GalleryCardSkeleton
            hasCuration={skeletonHasCuration}
            hasSecondaryMetadata={skeletonHasSecondaryMetadata}
            hasTitle={skeletonHasTitle}
            key={index}
          />
        ))}
      </div>
    </div>
  ) : null;

  if (isInitialLoading) {
    return (
      <div className="gallery-shell">
        <section
          className="gallery-viewport"
          ref={scrollParentRef}
          aria-label="Gallery view"
          aria-busy="true"
          onScroll={handleScroll}
          tabIndex={-1}
        >
          {initialSkeletonLayer}
          <span className="sr-only" role="status">
            Loading gallery
          </span>
        </section>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="gallery-shell">
        <section
          className="gallery-viewport"
          ref={scrollParentRef}
          aria-label="Gallery view"
          onScroll={handleScroll}
          tabIndex={-1}
        >
          <div className="empty-library gallery-empty-enter">
            <SlidersHorizontal size={22} />
            <strong>No indexed media in this folder</strong>
            <span>
              Run a scan after adding images or videos to the local media root.
            </span>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="gallery-shell">
      <section
        className="gallery-viewport"
        ref={scrollParentRef}
        aria-label="Gallery view"
        aria-busy={isRefreshing || !isScrollPositionReady}
        onScroll={handleScroll}
        tabIndex={-1}
      >
        {isRefreshing ? (
          <div
            className="gallery-refresh-indicator"
            role="progressbar"
            aria-label="Updating gallery"
          />
        ) : null}
        {initialSkeletonLayer}
        <div
          className={[
            "virtual-gallery gallery-content",
            !isScrollPositionReady ? "is-scroll-pending" : "",
            isRefreshing ? "is-refreshing" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          data-aspect={aspect}
          inert={isRefreshing || !isScrollPositionReady}
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowAssets = rows[virtualRow.index] ?? [];

            return (
              <div
                className="virtual-gallery-row"
                data-index={virtualRow.index}
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {rowAssets.map((asset) => {
                  const isSelected = selectedAssetIds.has(asset.id);
                  const secondaryMetadata = gallerySecondaryMetadata(
                    asset,
                    metadataFields
                  );
                  const tagBadges = metadataFields.has("tags")
                    ? asset.tags.slice(0, 2)
                    : [];
                  const hiddenTagCount = metadataFields.has("tags")
                    ? Math.max(0, asset.tags.length - tagBadges.length)
                    : 0;
                  const hasTitle = metadataFields.has("title");
                  const hasSecondaryMetadata = secondaryMetadata.length > 0;
                  const showScoreControl = metadataFields.has("score");
                  const showFavoriteControl = metadataFields.has("favorite");
                  const hasCuration =
                    showScoreControl ||
                    showFavoriteControl ||
                    tagBadges.length > 0 ||
                    hiddenTagCount > 0;
                  const hasCardInfo =
                    hasTitle || hasSecondaryMetadata || hasCuration;
                  const isSavingScore = savingScoreAssetIds.has(asset.id);
                  const tileStyle = mediaTileStyle(
                    asset,
                    aspect,
                    measuredAspectRatios
                  );

                  return (
                    <Card
                      className={[
                        "media-tile gap-0 py-0",
                        isSelectionMode ? "selection-mode" : "",
                        isSelected ? "selected" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={asset.id}
                      style={tileStyle}
                    >
                      {isSelectionMode ? (
                        <button
                          className="tile-selection-surface"
                          type="button"
                          aria-label={`${isSelected ? "Deselect" : "Select"} ${asset.name}`}
                          aria-pressed={isSelected}
                          onClick={() => onToggleSelection(asset.id)}
                        />
                      ) : null}
                      <button
                        className="media-preview-button"
                        type="button"
                        disabled={isSelectionMode}
                        onClick={() => onSelectAsset(asset.id)}
                      >
                        <MediaPreview
                          asset={asset}
                          onDimensionsKnown={onMediaDimensionsKnown}
                        />
                      </button>
                      <a
                        className="icon-link tile-download"
                        href={downloadUrl(asset.id)}
                        aria-label="Download media"
                        aria-disabled={isSelectionMode || undefined}
                        tabIndex={isSelectionMode ? -1 : undefined}
                        title="Download"
                      >
                        <Download size={15} />
                      </a>
                      {hasCardInfo ? (
                        <div className="tile-info">
                          {hasTitle ? (
                            <div className="tile-meta">
                              <span title={asset.name}>{asset.name}</span>
                            </div>
                          ) : null}
                          {hasSecondaryMetadata ? (
                            <div className="tile-submeta">
                              {secondaryMetadata.map((entry) => (
                                <span key={entry}>{entry}</span>
                              ))}
                            </div>
                          ) : null}
                          {hasCuration ? (
                            <GalleryCardCuration
                              asset={asset}
                              disabled={isSelectionMode || isSavingScore}
                              hiddenTagCount={hiddenTagCount}
                              isBusy={isSavingScore}
                              showFavorite={showFavoriteControl}
                              showScore={showScoreControl}
                              tags={tagBadges}
                              onFavoriteChange={onFavoriteAsset}
                              onScoreChange={onScoreAsset}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </div>
        {hasMore ? (
          <div className="load-more-row" ref={loadMoreRef}>
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingMore}
              onClick={onLoadMore}
            >
              {isLoadingMore ? "Loading" : "Load more"}
            </Button>
          </div>
        ) : null}
      </section>
      <Button
        className="gallery-scroll-top"
        data-visible={isScrollTopVisible}
        type="button"
        variant="secondary"
        size="icon"
        aria-hidden={!isScrollTopVisible}
        aria-label="Scroll gallery to top"
        tabIndex={isScrollTopVisible ? 0 : -1}
        onClick={scrollToTop}
      >
        <ArrowUp />
      </Button>
    </div>
  );
}
