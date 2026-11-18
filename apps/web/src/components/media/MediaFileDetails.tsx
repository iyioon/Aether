import type { AssetRecord } from "../../api/client";
import { mediaFileDetails } from "./media-file-details";

interface MediaFileDetailsProps {
  asset: AssetRecord;
  locationLabel?: string;
}

export function MediaFileDetails({
  asset,
  locationLabel
}: MediaFileDetailsProps) {
  const details = mediaFileDetails(asset, { locationLabel });
  if (details.length === 0) return null;

  return (
    <dl className="media-file-details" aria-label="File details">
      {details.map(({ label, value, dateTime }) => (
        <div className="media-file-detail" key={label}>
          <dt>{label}</dt>
          <dd>{dateTime ? <time dateTime={dateTime}>{value}</time> : value}</dd>
        </div>
      ))}
    </dl>
  );
}
