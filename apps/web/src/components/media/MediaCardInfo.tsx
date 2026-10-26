import {
  ArrowUp,
  Clock3,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Tags,
  Video,
  type LucideIcon
} from "lucide-react";
import type { AssetRecord } from "../../api/client";
import { gallerySecondaryMetadata } from "../gallery/gallery-layout";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { formatBytes, formatDuration } from "./media-format";

export function MediaCardInfo({
  asset,
  fields,
  includeScore = true,
  compact = false
}: {
  asset: AssetRecord;
  fields: ReadonlySet<GalleryMetadataField>;
  includeScore?: boolean;
  compact?: boolean;
}) {
  const secondary = gallerySecondaryMetadata(asset, fields);
  const tags = asset.tags.map((tag) => tag.displayName).join(" · ");
  const favorite =
    fields.has("favorite") && asset.favorite ? (
      <span
        className="media-card-favorite"
        role={compact ? "img" : undefined}
        aria-label={compact ? "Favorite" : undefined}
        title={compact ? "Favorite" : undefined}
      >
        <Heart aria-hidden="true" size={14} fill="currentColor" />
        {compact ? null : "Favorite"}
      </span>
    ) : null;
  const hasValues =
    secondary.length > 0 ||
    (includeScore && fields.has("score")) ||
    (fields.has("tags") && asset.tags.length > 0) ||
    favorite !== null;
  return (
    <span
      className={`media-card-info${compact ? " media-card-info--compact" : ""}`}
    >
      {fields.has("title") ? (
        <strong title={asset.name}>{asset.name}</strong>
      ) : null}
      {compact ? (
        hasValues ? (
          <span className="media-card-info-row">
            {fields.has("mediaType") ? (
              <MetadataValue
                icon={asset.mediaType === "video" ? Video : ImageIcon}
                label="Type"
                value={asset.mediaType}
              />
            ) : null}
            {fields.has("size") ? (
              <MetadataValue
                icon={asset.durationMs ? Clock3 : HardDrive}
                label={asset.durationMs ? "Duration" : "File size"}
                value={
                  asset.durationMs
                    ? formatDuration(asset.durationMs)
                    : formatBytes(asset.sizeBytes)
                }
              />
            ) : null}
            {includeScore && fields.has("score") ? (
              <MetadataValue icon={ArrowUp} label="Score" value={asset.score} />
            ) : null}
            {favorite}
            {fields.has("tags") && asset.tags.length > 0 ? (
              <MetadataValue icon={Tags} label="Tags" value={tags} />
            ) : null}
          </span>
        ) : null
      ) : (
        <>
          {secondary.length ? <span>{secondary.join(" · ")}</span> : null}
          {includeScore && fields.has("score") ? (
            <span>Score {asset.score}</span>
          ) : null}
          {fields.has("tags") && asset.tags.length > 0 ? (
            <span>{tags}</span>
          ) : null}
          {favorite}
        </>
      )}
    </span>
  );
}

function MetadataValue({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
}) {
  return (
    <span className="media-card-info-item" title={`${label}: ${value}`}>
      <Icon aria-hidden="true" size={14} />
      <span className="sr-only">{label}: </span>
      <span>{value}</span>
    </span>
  );
}
