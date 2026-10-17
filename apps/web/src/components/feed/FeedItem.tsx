import { Maximize2 } from "lucide-react";
import { memo, type MutableRefObject } from "react";
import type { AssetRecord } from "../../api/client";
import {
  MediaPreview,
  type MediaPlaybackCommands
} from "../media/MediaPreview";
import { IconButton } from "../IconButton";

export type FeedSoundState = "blocked" | "muted" | "on";

interface FeedItemProps {
  asset: AssetRecord;
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
  onOpenAnnotations: (assetId: string) => void;
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
  return (
    <article
      className={isFeedChromeHidden ? "feed-item details-hidden" : "feed-item"}
      aria-label={`${asset.mediaType}: ${asset.name}`}
      data-feed-index={index}
      data-audio-state={feedSoundState}
      ref={(node) => onRegisterItem(index, node)}
    >
      {renderMedia ? (
        <div className="feed-frame">
          {asset.mediaType === "video" ? (
            <div className="media-preview-button">
              <MediaPreview
                asset={asset}
                isActive={isActive}
                muted={isFeedMuted}
                onAudibleAutoplayBlocked={onAudibleAutoplayBlocked}
                onAudiblePlaybackStarted={onAudiblePlaybackStarted}
                onExpand={() => onOpenAsset(asset.id)}
                onToggleMuted={onFeedSoundToggle}
                onVideoControlsReady={onVideoControlsReady}
                onVideoPress={onToggleFeedChrome}
                playbackPaused={isPlaybackPaused}
                preloadPreview={preloadPreview}
                showVideoTimeline
                tall
                useOriginalVideo
              />
            </div>
          ) : (
            <button
              className="media-preview-button"
              type="button"
              aria-label={`${
                isFeedChromeHidden ? "Show" : "Hide"
              } feed controls and details`}
              title={isFeedChromeHidden ? "Show details" : "Hide details"}
              onClick={onToggleFeedChrome}
            >
              <MediaPreview
                asset={asset}
                isActive={isActive}
                muted={isFeedMuted}
                onAudibleAutoplayBlocked={onAudibleAutoplayBlocked}
                onAudiblePlaybackStarted={onAudiblePlaybackStarted}
                playbackPaused={isPlaybackPaused}
                preloadPreview={preloadPreview}
                tall
                useOriginalImage
              />
            </button>
          )}
          <div className="feed-meta">
            <button
              className="feed-meta-button"
              type="button"
              aria-haspopup="dialog"
              aria-label={`Open details for ${asset.name}`}
              title="Open details"
              onClick={() => onOpenAnnotations(asset.id)}
            >
              <span>{asset.mediaType}</span>
              <strong title={asset.name}>{asset.name}</strong>
            </button>
          </div>
          {asset.mediaType !== "video" ? (
            <div className="feed-actions">
              <IconButton
                className="media-overlay-button"
                icon={Maximize2}
                iconSize={17}
                label={`Open ${asset.name} fullscreen`}
                title="Fullscreen"
                onClick={() => onOpenAsset(asset.id)}
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
