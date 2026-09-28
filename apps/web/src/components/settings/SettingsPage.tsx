import { Database, Palette, RefreshCw, ServerCog } from "lucide-react";
import type {
  LibraryDataResetOptions,
  LibraryDataResetResult,
  SettingsSummary
} from "../../api/client";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { DataResetSettingsSection } from "./DataResetSettingsSection";
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
  accent: AppearanceAccent;
  accentOptions: AppearanceAccentOption[];
  customAccent: string;
  isLoading: boolean;
  settings: SettingsSummary | null;
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
  accent,
  accentOptions,
  customAccent,
  isLoading,
  settings,
  settingsError,
  theme,
  themeOptions,
  onRefreshSettings,
  onDataReset,
  onSetAccent,
  onSetCustomAccent,
  onSetTheme
}: SettingsPageProps) {
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-shell">
        <header className="settings-header">
          <div className="settings-heading">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Personalize Aether and inspect its server configuration.
            </p>
          </div>
        </header>

        <Tabs defaultValue="appearance">
          <TabsList className="settings-tabs-list grid w-full grid-cols-3">
            <TabsTrigger value="appearance">
              <Palette />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="server">
              <ServerCog />
              Server
            </TabsTrigger>
            <TabsTrigger value="data">
              <Database />
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

          <TabsContent className="settings-tab-panel" value="server">
            <div className="settings-tab-intro">
              <p className="text-sm text-muted-foreground">
                Read-only values reported by the running Aether server.
              </p>
              <Button
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
              <ServerStatusSettingsSection settings={settings} />
              <AiSettingsSection settings={settings} />
            </div>

            <p className="settings-runtime-note text-sm text-muted-foreground">
              Change server settings through environment variables, then restart
              Aether.
            </p>
          </TabsContent>

          <TabsContent className="settings-tab-panel" value="data">
            <div className="settings-tab-intro">
              <p className="text-sm text-muted-foreground">
                Selectively reset library annotations and ranking information.
              </p>
            </div>
            <div className="settings-grid settings-grid-single">
              <DataResetSettingsSection onResetComplete={onDataReset} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
