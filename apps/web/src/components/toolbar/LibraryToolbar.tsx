import {
  Grid3X3,
  SlidersHorizontal
} from "lucide-react";
import type { ViewMode } from "../library-state";
import { IconButton } from "../IconButton";

interface FeedCollapsedTopbarProps {
  selectedLabel: string;
  totalAssets: number;
  onOpenControls: () => void;
  onSwitchView: (view: ViewMode) => void;
}

export function FeedCollapsedTopbar({
  selectedLabel,
  totalAssets,
  onOpenControls,
  onSwitchView
}: FeedCollapsedTopbarProps) {
  return (
    <div className="feed-collapsed-topbar" aria-label="Feed controls">
      <button
        className="feed-collapsed-title"
        type="button"
        aria-label="Show feed controls"
        aria-expanded="false"
        onClick={onOpenControls}
      >
        <span>{selectedLabel}</span>
        <small>
          {totalAssets} {totalAssets === 1 ? "item" : "items"}
        </small>
      </button>
      <IconButton
        aria-expanded="false"
        icon={SlidersHorizontal}
        label="Show controls"
        title="Controls"
        onClick={onOpenControls}
      />
      <IconButton
        icon={Grid3X3}
        label="Gallery view"
        onClick={() => onSwitchView("gallery")}
      />
    </div>
  );
}
