import { CircleAlert } from "lucide-react";
import { Button } from "../ui/button";

export function MediaErrorNotice({
  message,
  onRetry,
  placement = "center",
  compact = false,
  className = ""
}: {
  message: string;
  onRetry?: () => void;
  placement?: "center" | "above-controls";
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={[
        "media-error-notice",
        `media-error-notice--${placement}`,
        compact ? "media-error-notice--compact" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
    >
      {!compact ? <CircleAlert aria-hidden="true" size={16} /> : null}
      <span className="media-error-notice__message" title={message}>
        {message}
      </span>
      {onRetry ? (
        <Button
          className="media-error-notice__retry"
          type="button"
          variant="secondary"
          size="sm"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
        >
          Retry
        </Button>
      ) : null}
    </span>
  );
}
