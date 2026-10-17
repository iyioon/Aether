import { useId, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { useIsMobile } from "../../hooks/use-mobile";
import type { ViewMode } from "../library-state";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { FilterControls, type FilterControlsProps } from "./FilterControls";
import { LayoutControls, type LayoutControlsProps } from "./LayoutControls";
import { SortControls, type SortControlsProps } from "./SortControls";

export interface LibraryViewOptionsProps
  extends FilterControlsProps, LayoutControlsProps, SortControlsProps {
  isOpen: boolean;
  view: ViewMode;
  onOpenChange: (isOpen: boolean) => void;
}

export function LibraryViewOptions(props: LibraryViewOptionsProps) {
  const { isOpen, view, onOpenChange, mediaType, scoreFilter, tagFilters } =
    props;
  const isMobile = useIsMobile();
  const titleId = useId();
  const [tab, setTab] = useState("filters");
  const activeTab = view === "feed" && tab === "layout" ? "filters" : tab;
  const filterCount =
    Number(mediaType !== "all") +
    Number(scoreFilter !== "all") +
    tagFilters.length;
  const label = filterCount
    ? `View options, ${filterCount} active ${filterCount === 1 ? "filter" : "filters"}`
    : "View options";
  const trigger = (
    <Button
      className="control-menu-trigger view-options-trigger"
      type="button"
      size="icon"
      variant="outline"
      aria-label={label}
    >
      <SlidersHorizontal aria-hidden="true" />
      {filterCount ? (
        <span className="view-options-count" aria-hidden="true">
          {filterCount}
        </span>
      ) : null}
    </Button>
  );
  const content = (
    <>
      <div className="view-options-heading">
        {isMobile ? (
          <SheetTitle>View options</SheetTitle>
        ) : (
          <h2 id={titleId}>View options</h2>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Close view options"
          onClick={() => onOpenChange(false)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {view === "compare" ? (
        <div className="view-options-body">
          <FilterControls {...props} />
        </div>
      ) : (
        <Tabs
          className="view-options-tabs"
          value={activeTab}
          onValueChange={setTab}
        >
          <TabsList aria-label="View options sections">
            <TabsTrigger value="filters">Filters</TabsTrigger>
            <TabsTrigger value="sort">Sort</TabsTrigger>
            {view === "gallery" ? (
              <TabsTrigger value="layout">Layout</TabsTrigger>
            ) : null}
          </TabsList>
          <div className="view-options-body" key={activeTab}>
            <TabsContent value="filters">
              <FilterControls {...props} />
            </TabsContent>
            <TabsContent value="sort">
              <SortControls {...props} />
            </TabsContent>
            {view === "gallery" ? (
              <TabsContent value="layout">
                <LayoutControls {...props} />
              </TabsContent>
            ) : null}
          </div>
        </Tabs>
      )}
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          className="view-options-panel view-options-sheet"
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        className="view-options-panel view-options-popover"
        align="end"
        collisionPadding={12}
        sideOffset={8}
        aria-labelledby={titleId}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}
