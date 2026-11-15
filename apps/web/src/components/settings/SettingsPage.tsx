import { Database, Palette, RefreshCw, ServerCog, Volume2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  LibraryDataResetOptions,
  LibraryDataResetResult,
  SettingsSummary,
  TreeRoot
} from "../../api/client";
import { Button } from "../ui/button";
import { isSettingsTab, type SettingsTab } from "../app-location-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { DataResetSettingsSection } from "./DataResetSettingsSection";
import { PlaybackSettingsSection } from "./PlaybackSettingsSection";
import type { PlaybackSettings } from "./usePlaybackSettings";
import {
  AiSettingsSection,
  SecuritySettingsSection,
  ServerStatusSettingsSection
} from "./ServerSettingsSections";
import type {
  AppearanceAccent,
  AppearanceAccentOption,
  AppearanceTheme,
  AppearanceThemeOption
} from "./useAppearanceSettings";

interface SettingsPageProps {
  playback: PlaybackSettings;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  accent: AppearanceAccent;
  accentOptions: AppearanceAccentOption[];
  customAccent: string;
  isLoading: boolean;
  settings: SettingsSummary | null;
  mediaRoots: TreeRoot[];
  settingsError: string | null;
  theme: AppearanceTheme;
  themeOptions: AppearanceThemeOption[];
  onRefreshSettings: () => void;
  onDataReset: (
    result: LibraryDataResetResult,
    options: LibraryDataResetOptions
  ) => void;
  onSetAccent: (accent: AppearanceAccent) => void;
  onSetCustomAccent: (color: string) => void;
  onSetTheme: (theme: AppearanceTheme) => void;
}

export function SettingsPage({
  playback,
  tab,
  onTabChange,
  accent,
  accentOptions,
  customAccent,
  isLoading,
  settings,
  mediaRoots,
  settingsError,
  theme,
  themeOptions,
  onRefreshSettings,
  onDataReset,
  onSetAccent,
  onSetCustomAccent,
  onSetTheme
}: SettingsPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-shell">
        <header className="settings-header">
          <div className="settings-heading">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight text-foreground outline-none"
            >
              Settings
            </h1>
          </div>
        </header>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isSettingsTab(value)) onTabChange(value);
          }}
        >
          <TabsList
            className="settings-tabs-list flex w-full"
            aria-label="Settings categories"
          >
            <TabsTrigger className="px-1 sm:px-2" value="appearance">
              <Palette className="hidden sm:block" />
              Appearance
            </TabsTrigger>
            <TabsTrigger className="px-1 sm:px-2" value="playback">
              <Volume2 className="hidden sm:block" />
              Playback
            </TabsTrigger>
            <TabsTrigger className="px-1 sm:px-2" value="server">
              <ServerCog className="hidden sm:block" />
              Server
            </TabsTrigger>
            <TabsTrigger className="px-1 sm:px-2" value="data">
              <Database className="hidden sm:block" />
              Database
            </TabsTrigger>
          </TabsList>

          <TabsContent className="settings-tab-panel" value="appearance">
            <div className="settings-tab-intro">
              <p className="text-sm text-muted-foreground">
                Theme and accent preferences are saved in this browser.
              </p>
            </div>
            <div className="settings-grid settings-grid-single">
              <AppearanceSettingsSection
                accent={accent}
                accentOptions={accentOptions}
                customAccent={customAccent}
                onSetAccent={onSetAccent}
                onSetCustomAccent={onSetCustomAccent}
                onSetTheme={onSetTheme}
                theme={theme}
                themeOptions={themeOptions}
              />
            </div>
          </TabsContent>

          <TabsContent className="settings-tab-panel" value="playback">
            <div className="settings-tab-intro">
              <p className="text-sm text-muted-foreground">
                Playback preferences are saved in this browser.
              </p>
            </div>
            <div className="settings-grid settings-grid-single">
              <PlaybackSettingsSection playback={playback} />
            </div>
          </TabsContent>

          <TabsContent className="settings-tab-panel" value="server">
            <div className="settings-tab-intro">
              <Button
                className="ml-auto"
                disabled={isLoading}
                size="sm"
                type="button"
                variant="outline"
                onClick={onRefreshSettings}
              >
                <RefreshCw className={isLoading ? "animate-spin" : undefined} />
                {isLoading ? "Refreshing" : "Refresh"}
              </Button>
            </div>

            {settingsError ? (
              <div
                className="settings-error text-sm text-destructive"
                role="alert"
              >
                {settingsError}
              </div>
            ) : null}

            <div className="settings-grid">
              <SecuritySettingsSection settings={settings} />
              <ServerStatusSettingsSection
                settings={settings}
                mediaRoots={mediaRoots}
              />
              <AiSettingsSection settings={settings} />
            </div>

            <p className="settings-runtime-note text-sm text-muted-foreground">
              Change server settings through environment variables, then restart
              Aether.
            </p>
          </TabsContent>

          <TabsContent className="settings-tab-panel" value="data">
            <div className="settings-grid settings-grid-single">
              <DataResetSettingsSection
                presentationEdits={settings?.library.presentationEdits}
                onResetComplete={onDataReset}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
