import { Maximize2 } from "lucide-react";
import type { PresentationAspect } from "../../api/client";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type MutableRefObject
} from "react";
import {
  libraryMediaEntryLabel,
  type LibraryMediaEntry
} from "../media/library-media-entries";
import {
  MediaPreview,
  type MediaPlaybackCommands
} from "../media/MediaPreview";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { MediaCardInfo } from "../media/MediaCardInfo";
import { IconButton } from "../IconButton";

export type FeedSoundState = "blocked" | "muted" | "on";

interface FeedItemProps {
  asset: LibraryMediaEntry;
  framingAspect: PresentationAspect;
  useSavedFraming: boolean;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  feedSoundState: FeedSoundState;
  index: number;
  isActive: boolean;
  isFeedChromeHidden: boolean;
  isFeedMuted: boolean;
  isPlaybackPaused: boolean;
  loadMoreRef: MutableRefObject<HTMLDivElement | null>;
  onAudibleAutoplayBlocked: () => void;
  onAudiblePlaybackStarted: () => void;
  onFeedSoundToggle: () => void;
  onOpenAnnotations: (assetId: string, entryKey?: string) => void;
  onOpenAsset: (assetId: string) => void;
  onRegisterItem: (index: number, node: HTMLElement | null) => void;
  onVideoControlsReady: (
    assetId: string,
    commands: MediaPlaybackCommands | null
  ) => void;
  onToggleFeedChrome: () => void;
  preloadPreview: boolean;
  renderMedia: boolean;
  showLoadSentinel: boolean;
}

export const FeedItem = memo(function FeedItem({
  asset,
  framingAspect,
  useSavedFraming,
  metadataFields,
  feedSoundState,
  index,
  isActive,
  isFeedChromeHidden,
  isFeedMuted,
  isPlaybackPaused,
  loadMoreRef,
  onAudibleAutoplayBlocked,
  onAudiblePlaybackStarted,
  onFeedSoundToggle,
  onOpenAnnotations,
  onOpenAsset,
  onRegisterItem,
  onVideoControlsReady,
  onToggleFeedChrome,
  preloadPreview,
  renderMedia,
  showLoadSentinel
}: FeedItemProps) {
  const [controlsContainer, setControlsContainer] =
    useState<HTMLElement | null>(null);
  const registerItem = useCallback(
    (node: HTMLElement | null) => {
      onRegisterItem(index, node);
    },
    [index, onRegisterItem]
  );
  const displayMetadataFields = useMemo(
    () =>
      asset.highlightId
        ? new Set([...metadataFields].filter((field) => field !== "title"))
        : metadataFields,
    [asset.highlightId, metadataFields]
  );
  const registerVideoControls = useCallback(
    (_assetId: string, commands: MediaPlaybackCommands | null) =>
      onVideoControlsReady(asset.entryKey, commands),
    [asset.entryKey, onVideoControlsReady]
  );
  return (
    <article
      className={isFeedChromeHidden ? "feed-item details-hidden" : "feed-item"}
      aria-label={`${asset.mediaType}: ${libraryMediaEntryLabel(asset)}`}
      data-entry-key={asset.entryKey}
      data-feed-index={index}
      data-aspect={framingAspect}
      data-audio-state={feedSoundState}
      ref={registerItem}
    >
      {renderMedia ? (
        <div className="feed-frame" ref={setControlsContainer}>
          <div className="media-preview-button">
            <MediaPreview
              asset={asset.source}
              selectedHighlightId={asset.highlightId}
              controlsContainer={controlsContainer}
              framingAspect={framingAspect}
              useSavedFraming={useSavedFraming}
              defaultFit={useSavedFraming ? "cover" : "contain"}
              isActive={isActive}
              muted={!isActive || isFeedMuted}
              onAudibleAutoplayBlocked={onAudibleAutoplayBlocked}
              onAudiblePlaybackStarted={onAudiblePlaybackStarted}
              onExpand={() => onOpenAsset(asset.entryKey)}
              onToggleMuted={onFeedSoundToggle}
              onVideoControlsReady={registerVideoControls}
              onVideoPress={onToggleFeedChrome}
              playbackPaused={isPlaybackPaused}
              preloadPreview={preloadPreview}
              showVideoTimeline
              tall
              useOriginalImage={isActive}
              useOriginalVideo
            />
          </div>
          {asset.mediaType !== "video" ? (
            <button
              className="feed-image-tap-surface"
              type="button"
              aria-label={`${isFeedChromeHidden ? "Show" : "Hide"} feed controls and details`}
              onClick={onToggleFeedChrome}
            />
          ) : null}
          <div
            className="feed-meta"
            data-has-info={
              metadataFields.size > 0 || asset.highlightId !== null
            }
          >
            {metadataFields.size > 0 || asset.highlightId !== null ? (
              <button
                className="feed-meta-button"
                type="button"
                aria-haspopup="dialog"
                aria-label={`Open details for ${libraryMediaEntryLabel(asset)}`}
                title="Open details"
                onClick={() => onOpenAnnotations(asset.id, asset.entryKey)}
              >
                {asset.highlightName ? (
                  <span className="media-card-info media-card-info--compact">
                    <strong title={asset.highlightName}>
                      {asset.highlightName}
                    </strong>
                    <span title={asset.name}>{asset.name}</span>
                  </span>
                ) : null}
                {displayMetadataFields.size > 0 ? (
                  <MediaCardInfo
                    asset={asset.source}
                    fields={displayMetadataFields}
                    compact
                  />
                ) : null}
              </button>
            ) : null}
          </div>
          {asset.mediaType !== "video" ? (
            <div className="feed-actions">
              <IconButton
                className="media-overlay-button"
                icon={Maximize2}
                iconSize={17}
                label={`Open ${libraryMediaEntryLabel(asset)} fullscreen`}
                title="Fullscreen"
                onClick={() => onOpenAsset(asset.entryKey)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {showLoadSentinel ? (
        <div className="feed-load-sentinel" ref={loadMoreRef} />
      ) : null}
    </article>
  );
});
