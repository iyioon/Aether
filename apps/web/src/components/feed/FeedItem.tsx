import { Maximize2, Volume2, VolumeX } from "lucide-react";
import type { MutableRefObject } from "react";
import type { AssetRecord } from "../../api/client";
import { MediaPreview } from "../media/MediaPreview";
import { IconButton } from "../ui/IconButton";

export type FeedSoundState = "blocked" | "muted" | "on";

interface FeedItemProps {
  activeIndex: number;
  asset: AssetRecord;
  audiblePlaybackRequest: number;
  feedSoundState: FeedSoundState;
  index: number;
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
  onToggleFeedChrome: () => void;
  preloadPreview: boolean;
  showLoadSentinel: boolean;
}

export function FeedItem({
  activeIndex,
  asset,
  audiblePlaybackRequest,
  feedSoundState,
  index,
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
  onToggleFeedChrome,
  preloadPreview,
  showLoadSentinel
}: FeedItemProps) {
  return (
    <article
      className={isFeedChromeHidden ? "feed-item details-hidden" : "feed-item"}
      data-feed-index={index}
      ref={(node) => onRegisterItem(index, node)}
    >
      <div className="feed-frame">
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
            audiblePlaybackRequest={
              index === activeIndex ? audiblePlaybackRequest : 0
            }
            isActive={index === activeIndex}
            muted={isFeedMuted}
            onAudibleAutoplayBlocked={onAudibleAutoplayBlocked}
            onAudiblePlaybackStarted={onAudiblePlaybackStarted}
            playbackPaused={isPlaybackPaused}
            preloadPreview={preloadPreview}
            tall
          />
        </button>
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
        <div className="feed-actions">
          {asset.mediaType === "video" ? (
            <IconButton
              aria-pressed={feedSoundState === "on"}
              className="feed-sound-action"
              data-audio-state={feedSoundState}
              icon={feedSoundState === "on" ? Volume2 : VolumeX}
              iconSize={17}
              label={
                feedSoundState === "on" ? "Mute feed sound" : "Enable feed sound"
              }
              title={
                feedSoundState === "blocked"
                  ? "Tap for sound"
                  : feedSoundState === "on"
                    ? "Sound on"
                    : "Sound off"
              }
              onClick={onFeedSoundToggle}
            />
          ) : null}
          <IconButton
            className="feed-expand-action"
            icon={Maximize2}
            iconSize={17}
            label={`Open ${asset.name} fullscreen`}
            title="Fullscreen"
            onClick={() => onOpenAsset(asset.id)}
          />
        </div>
      </div>
      {showLoadSentinel ? (
        <div className="feed-load-sentinel" ref={loadMoreRef} />
      ) : null}
    </article>
  );
}
