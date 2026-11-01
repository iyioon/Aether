import {
  formatPresentationTime,
  type HighlightTimelineRange
} from "./presentation-model";

export function PlaybackHighlight({
  range,
  descriptionId
}: {
  range: HighlightTimelineRange;
  descriptionId: string;
}) {
  return (
    <>
      <span className="playback-highlight" aria-hidden="true">
        <span
          className="playback-highlight__range"
          style={{
            left: `min(${range.startPercent}%, calc(100% - 2px))`,
            width: `max(2px, ${range.endPercent - range.startPercent}%)`
          }}
        />
      </span>
      <span id={descriptionId} className="sr-only">
        Highlight from {formatPresentationTime(range.startMs)} to{" "}
        {formatPresentationTime(range.endMs)}.
      </span>
    </>
  );
}
