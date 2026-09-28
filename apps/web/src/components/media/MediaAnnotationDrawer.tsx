import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiStatus,
  AssetRecord,
  TagRecord
} from "../../api/client";
import { useIsMobile } from "../../hooks/use-mobile";
import { panelExitDurationMs } from "../../lib/motion";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "../ui/sheet";
import { AssetAnnotationPanel } from "./AssetAnnotationPanel";
import { mediaDetailLine } from "./media-format";

interface MediaAnnotationDrawerProps {
  aiStatus: AiStatus | null;
  asset: AssetRecord;
  isAboveViewer?: boolean;
  onClose: () => void;
  onRankingChanged: () => void;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}

export function MediaAnnotationDrawer({
  aiStatus,
  asset,
  isAboveViewer = false,
  onClose,
  onRankingChanged,
  onAssetUpdated,
  onAssetTagsUpdated
}: MediaAnnotationDrawerProps) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(true);
  const closeTimerRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    setIsOpen(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, panelExitDurationMs());
  }, []);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          requestClose();
        }
      }}
    >
      <SheetContent
        className={[
          "media-info-sheet overflow-y-auto",
          isMobile
            ? "max-h-[85dvh] rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "sm:max-w-md",
          isAboveViewer ? "z-[60]" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        side={isMobile ? "bottom" : "right"}
      >
        <SheetHeader>
          <SheetTitle className="truncate pr-8" title={asset.name}>
            {asset.name}
          </SheetTitle>
          <SheetDescription>
            {asset.mediaType} · {mediaDetailLine(asset)}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <AssetAnnotationPanel
            aiStatus={aiStatus}
            asset={asset}
            onRankingChanged={onRankingChanged}
            onAssetTagsUpdated={onAssetTagsUpdated}
            onAssetUpdated={onAssetUpdated}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
