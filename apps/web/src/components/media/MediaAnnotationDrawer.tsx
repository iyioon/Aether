import { useCallback, useEffect, useRef, useState } from "react";
import type { AiStatus, AssetRecord, TagRecord } from "../../api/client";
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
  isScoreSaving: boolean;
  onClose: () => void;
  onRankingChanged: () => void;
  onScoreChange: (
    asset: AssetRecord,
    input: { score?: number; favorite?: boolean }
  ) => void;
  onAssetUpdated: (asset: AssetRecord) => void;
  onAssetTagsUpdated: (assetId: string, tags: TagRecord[]) => void;
}

export function MediaAnnotationDrawer({
  aiStatus,
  asset,
  isAboveViewer = false,
  isScoreSaving,
  onClose,
  onRankingChanged,
  onScoreChange,
  onAssetUpdated,
  onAssetTagsUpdated
}: MediaAnnotationDrawerProps) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(true);
  const closeTimerRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);
  const busyRef = useRef(false);
  const [isBusy, setIsBusy] = useState(false);
  const handleBusyChange = useCallback((busy: boolean) => {
    busyRef.current = busy;
    setIsBusy(busy);
  }, []);
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (isClosingRef.current || busyRef.current) {
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
        showCloseButton={!isBusy}
        onEscapeKeyDown={(event) => {
          if (busyRef.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busyRef.current) event.preventDefault();
        }}
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
            onBusyChange={handleBusyChange}
            aiStatus={aiStatus}
            asset={asset}
            isScoreSaving={isScoreSaving}
            onRankingChanged={onRankingChanged}
            onScoreChange={onScoreChange}
            onAssetTagsUpdated={onAssetTagsUpdated}
            onAssetUpdated={onAssetUpdated}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
