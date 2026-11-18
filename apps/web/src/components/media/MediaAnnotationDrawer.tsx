import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AiStatus, AssetRecord, TagRecord } from "../../api/client";
import { useIsMobile } from "../../hooks/use-mobile";
import { panelExitDurationMs } from "../../lib/motion";
import {
  captureFocusTarget,
  restoreFocusAfterClose
} from "../../lib/focus-restoration";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "../ui/sheet";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AssetAnnotationPanel } from "./AssetAnnotationPanel";
import { MediaHighlightsPanel } from "./MediaHighlightsPanel";
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
  selectedHighlightId?: string | null;
  onViewHighlight?: (asset: AssetRecord, highlightId: string) => void;
  onEditHighlights?: (asset: AssetRecord) => void;
  onMakeMainHighlight?: (
    asset: AssetRecord,
    highlightId: string,
    signal: AbortSignal
  ) => Promise<AssetRecord>;
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
  onAssetTagsUpdated,
  selectedHighlightId,
  onViewHighlight,
  onEditHighlights,
  onMakeMainHighlight
}: MediaAnnotationDrawerProps) {
  const isMobile = useIsMobile();
  const [returnFocusTarget] = useState(captureFocusTarget);
  const [isOpen, setIsOpen] = useState(true);
  const closeTimerRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);
  const busyRef = useRef(false);
  const busyPanelsRef = useRef({ details: false, highlights: false });
  const [isBusy, setIsBusy] = useState(false);
  const [tab, setTab] = useState("details");
  const handleDetailsBusyChange = useCallback((busy: boolean) => {
    busyPanelsRef.current.details = busy;
    busyRef.current = busy || busyPanelsRef.current.highlights;
    setIsBusy(busyRef.current);
  }, []);
  const handleHighlightsBusyChange = useCallback((busy: boolean) => {
    busyPanelsRef.current.highlights = busy;
    busyRef.current = busy || busyPanelsRef.current.details;
    setIsBusy(busyRef.current);
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
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocusAfterClose(returnFocusTarget);
        }}
        showCloseButton={false}
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
        <SheetClose asChild>
          <Button
            className="absolute top-4 right-4"
            variant="ghost"
            size="icon"
            aria-label="Close"
            disabled={isBusy}
          >
            <X aria-hidden="true" />
          </Button>
        </SheetClose>
        <SheetHeader>
          <SheetTitle className="truncate pr-8" title={asset.name}>
            {asset.name}
          </SheetTitle>
          <SheetDescription>
            {asset.mediaType} · {mediaDetailLine(asset)}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <Tabs value={tab} onValueChange={setTab} className="media-info-tabs">
            <TabsList aria-label="Media information">
              <TabsTrigger value="details" disabled={isBusy}>
                Details
              </TabsTrigger>
              <TabsTrigger value="highlights" disabled={isBusy}>
                Highlights
              </TabsTrigger>
            </TabsList>
            <TabsContent value="details" forceMount hidden={tab !== "details"}>
              <AssetAnnotationPanel
                onBusyChange={handleDetailsBusyChange}
                aiStatus={aiStatus}
                asset={asset}
                isScoreSaving={isScoreSaving}
                onRankingChanged={onRankingChanged}
                onScoreChange={onScoreChange}
                onAssetTagsUpdated={onAssetTagsUpdated}
                onAssetUpdated={onAssetUpdated}
              />
            </TabsContent>
            <TabsContent
              value="highlights"
              forceMount
              hidden={tab !== "highlights"}
            >
              <MediaHighlightsPanel
                asset={asset}
                disabled={isBusy}
                selectedHighlightId={selectedHighlightId}
                onViewHighlight={onViewHighlight}
                onEditHighlights={onEditHighlights}
                onMakeMainHighlight={onMakeMainHighlight}
                onAssetUpdated={onAssetUpdated}
                onBusyChange={handleHighlightsBusyChange}
              />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
