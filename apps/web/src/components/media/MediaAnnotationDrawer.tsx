import { useRef } from "react";
import { X } from "lucide-react";
import type {
  AiStatus,
  AssetRecord,
  TagRecord
} from "../../api/client";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { IconButton } from "../ui/IconButton";
import { AssetAnnotationPanel } from "./AssetAnnotationPanel";
import { mediaDetailLine } from "./media-format";

interface MediaAnnotationDrawerProps {
  aiStatus: AiStatus | null;
  asset: AssetRecord;
  isAboveViewer?: boolean;
  onClose: () => void;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}

export function MediaAnnotationDrawer({
  aiStatus,
  asset,
  isAboveViewer = false,
  onClose,
  onAssetUpdated,
  onAssetTagsUpdated
}: MediaAnnotationDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(drawerRef, onClose);

  return (
    <div
      className={
        isAboveViewer
          ? "feed-drawer-layer viewer-drawer-layer"
          : "feed-drawer-layer"
      }
    >
      <button
        className="feed-drawer-scrim"
        type="button"
        aria-label="Close details"
        onClick={onClose}
      />
      <section
        className="feed-annotation-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-annotation-title"
        tabIndex={-1}
      >
        <div className="feed-drawer-grip" aria-hidden="true" />
        <header className="feed-drawer-header">
          <div>
            <span>{asset.mediaType}</span>
            <h2 id="media-annotation-title" title={asset.name}>
              {asset.name}
            </h2>
            <p>{mediaDetailLine(asset)}</p>
          </div>
          <IconButton
            className="feed-drawer-close"
            icon={X}
            iconSize={18}
            label="Close details"
            onClick={onClose}
          />
        </header>
        <AssetAnnotationPanel
          aiStatus={aiStatus}
          asset={asset}
          onAssetTagsUpdated={onAssetTagsUpdated}
          onAssetUpdated={onAssetUpdated}
        />
      </section>
    </div>
  );
}
