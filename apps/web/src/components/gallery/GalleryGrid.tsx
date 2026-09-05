import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Download, SlidersHorizontal } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { useAutoLoadSentinel } from "../../hooks/useAutoLoadSentinel";
import type { AspectMode, GridSize } from "../library-state";
import { GalleryCardCuration } from "../GalleryCardCuration";
import { MediaPreview } from "../media/MediaPreview";
import { downloadUrl } from "../media/media-urls";
import {
  chunkAssetsIntoRows,
  estimateGalleryRowHeight,
  galleryColumnCount,
  galleryMinTileWidth,
  gallerySecondaryMetadata,
  GALLERY_GRID_GAP,
  mediaTileStyle
} from "./gallery-layout";
import type { GalleryMetadataField } from "./gallery-metadata";

interface GalleryGridProps {
  assets: AssetRecord[];
  aspect: AspectMode;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  measuredAspectRatios: Record<string, string>;
  resetKey: string;
  savingRatingAssetIds: ReadonlySet<string>;
  selectedAssetIds: ReadonlySet<string>;
  onLoadMore: () => void;
  onFavoriteAsset: (asset: AssetRecord, favorite: boolean) => void;
  onMediaDimensionsKnown: (assetId: string, width: number, height: number) => void;
  onRateAsset: (asset: AssetRecord, rating: number | null) => void;
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
  loadMoreRef,
  measuredAspectRatios,
  resetKey,
  savingRatingAssetIds,
  selectedAssetIds,
  onLoadMore,
  onFavoriteAsset,
  onMediaDimensionsKnown,
  onRateAsset,
  onSelectAsset,
  onToggleSelection
}: GalleryGridProps) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const minTileWidth = galleryMinTileWidth(gridSize);
  const columnCount = galleryColumnCount(containerWidth, minTileWidth);
  const rows = useMemo(
    () => chunkAssetsIntoRows(assets, columnCount),
    [assets, columnCount]
  );
  const estimateRowSize = useCallback(
    () =>
      estimateGalleryRowHeight({
        aspect,
        columnCount,
        containerWidth,
        metadataFields,
        minTileWidth
      }),
    [aspect, columnCount, containerWidth, metadataFields, minTileWidth]
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: estimateRowSize,
    getItemKey: (index) => rows[index]?.[0]?.id ?? index,
    gap: GALLERY_GRID_GAP,
    overscan: 7
  });

  useEffect(() => {
    const observedElement = scrollParentRef.current;

    if (!observedElement) {
      return;
    }

    const element: HTMLDivElement = observedElement;

    function updateWidth() {
      setContainerWidth(element.clientWidth);
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

  useEffect(() => {
    scrollParentRef.current?.scrollTo({ top: 0 });
    rowVirtualizer.scrollToOffset(0);
  }, [aspect, gridSize, metadataFields, resetKey]);

  useAutoLoadSentinel({
    enabled: hasMore && !isLoading && !isLoadingMore,
    onLoadMore,
    rootMargin: "380px 0px",
    rootRef: scrollParentRef,
    targetRef: loadMoreRef
  });

  if (isLoading) {
    return (
      <section
        className="gallery-viewport"
        ref={scrollParentRef}
        aria-label="Gallery view"
      >
        <div className="gallery-grid" data-size={gridSize} data-aspect={aspect}>
          {Array.from({ length: 18 }).map((_, index) => (
            <article className="media-tile" key={index}>
              <div className="media-skeleton" />
              <div className="tile-info">
                <div className="tile-meta">
                  <span>Loading</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (assets.length === 0) {
    return (
      <section
        className="gallery-viewport"
        ref={scrollParentRef}
        aria-label="Gallery view"
      >
        <div className="empty-library">
          <SlidersHorizontal size={22} />
          <strong>No indexed media in this folder</strong>
          <span>Run a scan after adding images or videos to the local media root.</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="gallery-viewport"
      ref={scrollParentRef}
      aria-label="Gallery view"
    >
      <div
        className="virtual-gallery"
        data-aspect={aspect}
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
                const showRatingControl = metadataFields.has("rating");
                const showFavoriteControl = metadataFields.has("favorite");
                const hasCuration =
                  showRatingControl ||
                  showFavoriteControl ||
                  tagBadges.length > 0 ||
                  hiddenTagCount > 0;
                const hasCardInfo =
                  hasTitle || hasSecondaryMetadata || hasCuration;
                const isSavingRating = savingRatingAssetIds.has(asset.id);

                return (
                  <article
                    className={isSelected ? "media-tile selected" : "media-tile"}
                    key={asset.id}
                    style={mediaTileStyle(asset, aspect, measuredAspectRatios)}
                  >
                    <label className="tile-select" title="Select media">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        aria-label={`Select ${asset.name}`}
                        onChange={() => onToggleSelection(asset.id)}
                      />
                      <span className="tile-select-box" aria-hidden="true">
                        {isSelected ? <Check size={13} /> : null}
                      </span>
                    </label>
                    <button
                      className="media-preview-button"
                      type="button"
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
                            disabled={isSavingRating}
                            hiddenTagCount={hiddenTagCount}
                            showFavorite={showFavoriteControl}
                            showRating={showRatingControl}
                            tags={tagBadges}
                            onFavoriteChange={onFavoriteAsset}
                            onRatingChange={onRateAsset}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
      {hasMore ? (
        <div className="load-more-row" ref={loadMoreRef}>
          <button
            className="ghost-action"
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Loading" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
