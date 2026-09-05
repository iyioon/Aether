import { ArrowLeft, RefreshCw } from "lucide-react";
import type {
  MediaTypeFilter,
  RatingFilter,
  SettingsSummary,
  SortDirection,
  SortMode
} from "../../api/client";
import type { AspectMode, GridSize, ViewMode } from "../library-state";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import { IconButton } from "../ui/IconButton";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { BrowsingSettingsSection } from "./BrowsingSettingsSection";
import { FilterSettingsSection } from "./FilterSettingsSection";
import { LayoutSettingsSection } from "./LayoutSettingsSection";
import {
  AiSettingsSection,
  RuntimeSettingsSection,
  SecuritySettingsSection,
  ServerStatusSettingsSection
} from "./ServerSettingsSections";
import type {
  AppearanceAccent,
  AppearanceAccentOption
} from "./useAppearanceSettings";

interface SettingsPageProps {
  accent: AppearanceAccent;
  accentOptions: AppearanceAccentOption[];
  aspect: AspectMode;
  galleryMetadataFields: ReadonlySet<GalleryMetadataField>;
  gridSize: GridSize;
  isLoading: boolean;
  mediaType: MediaTypeFilter;
  ratingFilter: RatingFilter;
  settings: SettingsSummary | null;
  settingsError: string | null;
  sort: SortMode;
  sortDirection: SortDirection;
  sortSummary: string;
  view: ViewMode;
  onBack: () => void;
  onClearGalleryMetadataFields: () => void;
  onRefreshSettings: () => void;
  onResetGalleryMetadataFields: () => void;
  onSetAccent: (accent: AppearanceAccent) => void;
  onSetAspect: (aspect: AspectMode) => void;
  onSetGridSize: (gridSize: GridSize) => void;
  onSetMediaType: (mediaType: MediaTypeFilter) => void;
  onSetRatingFilter: (ratingFilter: RatingFilter) => void;
  onSetSort: (sort: SortMode) => void;
  onSetSortDirection: (sortDirection: SortDirection) => void;
  onSetView: (view: ViewMode) => void;
  onToggleGalleryMetadataField: (field: GalleryMetadataField) => void;
}

export function SettingsPage({
  accent,
  accentOptions,
  aspect,
  galleryMetadataFields,
  gridSize,
  isLoading,
  mediaType,
  ratingFilter,
  settings,
  settingsError,
  sort,
  sortDirection,
  sortSummary,
  view,
  onBack,
  onClearGalleryMetadataFields,
  onRefreshSettings,
  onResetGalleryMetadataFields,
  onSetAccent,
  onSetAspect,
  onSetGridSize,
  onSetMediaType,
  onSetRatingFilter,
  onSetSort,
  onSetSortDirection,
  onSetView,
  onToggleGalleryMetadataField
}: SettingsPageProps) {
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-header">
        <IconButton
          className="settings-back"
          icon={ArrowLeft}
          label="Back to library"
          onClick={onBack}
        />
        <div className="settings-heading">
          <h1>Settings</h1>
          <p>Library preferences and server configuration</p>
        </div>
        <button
          className="settings-refresh ghost-action"
          type="button"
          onClick={onRefreshSettings}
          disabled={isLoading}
        >
          <RefreshCw size={16} />
          <span>{isLoading ? "Refreshing" : "Refresh"}</span>
        </button>
      </div>

      {settingsError ? (
        <div className="settings-error" role="alert">
          {settingsError}
        </div>
      ) : null}

      <div className="settings-grid">
        <AppearanceSettingsSection
          accent={accent}
          accentOptions={accentOptions}
          onSetAccent={onSetAccent}
        />
        <BrowsingSettingsSection
          sort={sort}
          sortDirection={sortDirection}
          sortSummary={sortSummary}
          view={view}
          onSetSort={onSetSort}
          onSetSortDirection={onSetSortDirection}
          onSetView={onSetView}
        />
        <LayoutSettingsSection
          aspect={aspect}
          galleryMetadataFields={galleryMetadataFields}
          gridSize={gridSize}
          onClearGalleryMetadataFields={onClearGalleryMetadataFields}
          onResetGalleryMetadataFields={onResetGalleryMetadataFields}
          onSetAspect={onSetAspect}
          onSetGridSize={onSetGridSize}
          onToggleGalleryMetadataField={onToggleGalleryMetadataField}
        />
        <FilterSettingsSection
          mediaType={mediaType}
          ratingFilter={ratingFilter}
          onSetMediaType={onSetMediaType}
          onSetRatingFilter={onSetRatingFilter}
        />
        <SecuritySettingsSection settings={settings} />
        <ServerStatusSettingsSection settings={settings} />
        <AiSettingsSection settings={settings} />
        <RuntimeSettingsSection />
      </div>
    </section>
  );
}
