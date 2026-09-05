import { ChevronUp } from "lucide-react";
import type {
  AssetRecord,
  MediaTypeFilter,
  RatingFilter,
  SortMode,
  TagRecord
} from "../../api/client";
import type { AspectMode, GridSize, ViewMode } from "../library-state";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { ActionsControlMenu } from "./ActionsControlMenu";
import { FiltersControlMenu } from "./FiltersControlMenu";
import { LayoutControlMenu } from "./LayoutControlMenu";
import { SortControlMenu } from "./SortControlMenu";
import type { ControlMenuId } from "./library-control-options";

interface LibraryControlStripProps {
  actionSummary: string;
  activeFilterLabels: string[];
  aspect: AspectMode;
  assets: AssetRecord[];
  filterSummary: string;
  filterTagSuggestions: TagRecord[];
  galleryMetadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  isLoadingAssets: boolean;
  isSavingBatch: boolean;
  layoutSummary: string;
  mediaType: MediaTypeFilter;
  mediaTypeLabel: string;
  openControlMenu: ControlMenuId | null;
  ratingFilter: RatingFilter;
  ratingFilterLabel: string;
  selectedAssetCount: number;
  sort: SortMode;
  sortLabel: string;
  tagFilter: string;
  tagFilterDraft: string;
  view: ViewMode;
  onApplyTagFilter: (tagName: string) => void;
  onClearGalleryMetadataFields: () => void;
  onClearLibraryFilters: () => void;
  onClearSelectedAssets: () => void;
  onClearTagFilter: () => void;
  onHideFeedControls: () => void;
  onResetGalleryMetadataFields: () => void;
  onSelectLoadedAssets: () => void;
  onSetAspect: (aspect: AspectMode) => void;
  onSetGridSize: (gridSize: GridSize) => void;
  onSetMediaType: (mediaType: MediaTypeFilter) => void;
  onSetOpenControlMenu: (menu: ControlMenuId | null) => void;
  onSetRatingFilter: (ratingFilter: RatingFilter) => void;
  onSetSort: (sort: SortMode) => void;
  onSetTagFilterDraft: (value: string) => void;
  onToggleGalleryMetadataField: (field: GalleryMetadataField) => void;
}

export function LibraryControlStrip({
  actionSummary,
  activeFilterLabels,
  aspect,
  assets,
  filterSummary,
  filterTagSuggestions,
  galleryMetadataFields,
  gridSize,
  isLoadingAssets,
  isSavingBatch,
  layoutSummary,
  mediaType,
  mediaTypeLabel,
  openControlMenu,
  ratingFilter,
  ratingFilterLabel,
  selectedAssetCount,
  sort,
  sortLabel,
  tagFilter,
  tagFilterDraft,
  view,
  onApplyTagFilter,
  onClearGalleryMetadataFields,
  onClearLibraryFilters,
  onClearSelectedAssets,
  onClearTagFilter,
  onHideFeedControls,
  onResetGalleryMetadataFields,
  onSelectLoadedAssets,
  onSetAspect,
  onSetGridSize,
  onSetMediaType,
  onSetOpenControlMenu,
  onSetRatingFilter,
  onSetSort,
  onSetTagFilterDraft,
  onToggleGalleryMetadataField
}: LibraryControlStripProps) {
  return (
    <section className="control-strip" aria-label="Library controls">
      {view === "feed" ? (
        <button
          className="ghost-action mobile-feed-collapse-control"
          type="button"
          aria-label="Hide feed controls"
          title="Hide controls"
          aria-expanded="true"
          onClick={onHideFeedControls}
        >
          <ChevronUp size={16} />
          <span>Hide</span>
        </button>
      ) : null}

      <SortControlMenu
        isOpen={openControlMenu === "sort"}
        sort={sort}
        sortLabel={sortLabel}
        onOpenChange={(nextIsOpen) =>
          onSetOpenControlMenu(nextIsOpen ? "sort" : null)
        }
        onSetSort={onSetSort}
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

      <FiltersControlMenu
        activeFilterLabels={activeFilterLabels}
        filterSummary={filterSummary}
        filterTagSuggestions={filterTagSuggestions}
        isOpen={openControlMenu === "filters"}
        mediaType={mediaType}
        mediaTypeLabel={mediaTypeLabel}
        ratingFilter={ratingFilter}
        ratingFilterLabel={ratingFilterLabel}
        tagFilter={tagFilter}
        tagFilterDraft={tagFilterDraft}
        onApplyTagFilter={onApplyTagFilter}
        onClearLibraryFilters={onClearLibraryFilters}
        onClearTagFilter={onClearTagFilter}
        onOpenChange={(nextIsOpen) =>
          onSetOpenControlMenu(nextIsOpen ? "filters" : null)
        }
        onSetMediaType={onSetMediaType}
        onSetOpenControlMenu={onSetOpenControlMenu}
        onSetRatingFilter={onSetRatingFilter}
        onSetTagFilterDraft={onSetTagFilterDraft}
      />

      <ActionsControlMenu
        actionSummary={actionSummary}
        assets={assets}
        isLoadingAssets={isLoadingAssets}
        isOpen={openControlMenu === "actions"}
        isSavingBatch={isSavingBatch}
        selectedAssetCount={selectedAssetCount}
        onClearSelectedAssets={onClearSelectedAssets}
        onOpenChange={(nextIsOpen) =>
          onSetOpenControlMenu(nextIsOpen ? "actions" : null)
        }
        onSelectLoadedAssets={onSelectLoadedAssets}
        onSetOpenControlMenu={onSetOpenControlMenu}
      />
    </section>
  );
}
