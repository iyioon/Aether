import type {
  MediaTypeFilter,
  RatingFilter,
  SortDirection,
  SortMode,
  TagRecord
} from "../../api/client";
import { Check, MousePointer2 } from "lucide-react";
import type { AspectMode, GridSize, ViewMode } from "../library-state";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { FiltersControlMenu } from "./FiltersControlMenu";
import { LayoutControlMenu } from "./LayoutControlMenu";
import { SortControlMenu } from "./SortControlMenu";
import type { ControlMenuId } from "./library-control-options";

interface LibraryControlStripProps {
  aspect: AspectMode;
  filterSummary: string;
  filterTagSuggestions: TagRecord[];
  galleryMetadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  isSelectionMode: boolean;
  loadedAssetCount: number;
  layoutSummary: string;
  mediaType: MediaTypeFilter;
  mediaTypeLabel: string;
  openControlMenu: ControlMenuId | null;
  ratingFilter: RatingFilter;
  ratingFilterLabel: string;
  sort: SortMode;
  sortDirection: SortDirection;
  sortLabel: string;
  sortSummary: string;
  tagFilters: string[];
  tagFilterDraft: string;
  view: ViewMode;
  onAddTagFilter: (tagName: string) => void;
  onClearGalleryMetadataFields: () => void;
  onClearTagFilters: () => void;
  onRemoveTagFilter: (tagName: string) => void;
  onResetGalleryMetadataFields: () => void;
  onSetSelectionMode: (isSelectionMode: boolean) => void;
  onSetAspect: (aspect: AspectMode) => void;
  onSetGridSize: (gridSize: GridSize) => void;
  onSetMediaType: (mediaType: MediaTypeFilter) => void;
  onSetOpenControlMenu: (menu: ControlMenuId | null) => void;
  onSetRatingFilter: (ratingFilter: RatingFilter) => void;
  onSetSort: (sort: SortMode) => void;
  onSetSortDirection: (sortDirection: SortDirection) => void;
  onSetTagFilterDraft: (value: string) => void;
  onToggleGalleryMetadataField: (field: GalleryMetadataField) => void;
}

export function LibraryControlStrip({
  aspect,
  filterSummary,
  filterTagSuggestions,
  galleryMetadataFields,
  gridSize,
  isSelectionMode,
  loadedAssetCount,
  layoutSummary,
  mediaType,
  mediaTypeLabel,
  openControlMenu,
  ratingFilter,
  ratingFilterLabel,
  sort,
  sortDirection,
  sortLabel,
  sortSummary,
  tagFilters,
  tagFilterDraft,
  view,
  onAddTagFilter,
  onClearGalleryMetadataFields,
  onClearTagFilters,
  onRemoveTagFilter,
  onResetGalleryMetadataFields,
  onSetSelectionMode,
  onSetAspect,
  onSetGridSize,
  onSetMediaType,
  onSetOpenControlMenu,
  onSetRatingFilter,
  onSetSort,
  onSetSortDirection,
  onSetTagFilterDraft,
  onToggleGalleryMetadataField
}: LibraryControlStripProps) {
  return (
    <section className="control-strip" aria-label="Library controls">
      {view !== "compare" ? (
        <>
          <SortControlMenu
            isOpen={openControlMenu === "sort"}
            sort={sort}
            sortDirection={sortDirection}
            sortLabel={sortLabel}
            sortSummary={sortSummary}
            onOpenChange={(nextIsOpen) =>
              onSetOpenControlMenu(nextIsOpen ? "sort" : null)
            }
            onSetSort={onSetSort}
            onSetSortDirection={onSetSortDirection}
          />

          <LayoutControlMenu
            aspect={aspect}
            galleryMetadataFields={galleryMetadataFields}
            gridSize={gridSize}
            isOpen={openControlMenu === "layout"}
            layoutSummary={layoutSummary}
            onClearGalleryMetadataFields={onClearGalleryMetadataFields}
            onOpenChange={(nextIsOpen) =>
              onSetOpenControlMenu(nextIsOpen ? "layout" : null)
            }
            onResetGalleryMetadataFields={onResetGalleryMetadataFields}
            onSetAspect={onSetAspect}
            onSetGridSize={onSetGridSize}
            onToggleGalleryMetadataField={onToggleGalleryMetadataField}
          />
        </>
      ) : null}

      <FiltersControlMenu
        filterSummary={filterSummary}
        filterTagSuggestions={filterTagSuggestions}
        isOpen={openControlMenu === "filters"}
        mediaType={mediaType}
        mediaTypeLabel={mediaTypeLabel}
        ratingFilter={ratingFilter}
        ratingFilterLabel={ratingFilterLabel}
        tagFilters={tagFilters}
        tagFilterDraft={tagFilterDraft}
        onAddTagFilter={onAddTagFilter}
        onClearTagFilters={onClearTagFilters}
        onOpenChange={(nextIsOpen) =>
          onSetOpenControlMenu(nextIsOpen ? "filters" : null)
        }
        onSetMediaType={onSetMediaType}
        onSetRatingFilter={onSetRatingFilter}
        onSetTagFilterDraft={onSetTagFilterDraft}
        onRemoveTagFilter={onRemoveTagFilter}
      />

      {view !== "compare" ? <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="control-menu-trigger"
            type="button"
            size="icon"
            variant={isSelectionMode ? "secondary" : "outline"}
            aria-label={isSelectionMode ? "Exit selection mode" : "Select media"}
            aria-pressed={isSelectionMode}
            disabled={loadedAssetCount === 0}
            onClick={() => onSetSelectionMode(!isSelectionMode)}
          >
            {isSelectionMode ? <Check /> : <MousePointer2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isSelectionMode ? "Exit selection mode" : "Select media"}
        </TooltipContent>
      </Tooltip> : null}
    </section>
  );
}
