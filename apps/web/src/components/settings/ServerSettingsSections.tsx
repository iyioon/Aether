import {
  Clock3,
  LockKeyhole,
  ServerCog,
  Sparkles
} from "lucide-react";
import type { SettingsSummary } from "../../api/client";
import { boolLabel } from "./settings-formatters";
import { SettingsSection } from "./SettingsSection";
import { SummaryList } from "./SettingsSummaryList";

interface ServerSettingsSectionsProps {
  settings: SettingsSummary | null;
}

export function SecuritySettingsSection({ settings }: ServerSettingsSectionsProps) {
  return (
    <SettingsSection
      icon={LockKeyhole}
      title="Security"
      value={
        settings?.security.passwordConfigured
          ? "Password protected"
          : "Password missing"
      }
    >
      <SummaryList
        items={[
          ["Password", settings?.security.passwordConfigured ? "Configured" : "Missing"],
          ["Session", settings ? `${settings.security.sessionTtlDays} days` : "-"],
          ["Login limit", settings ? `${settings.security.loginMaxAttempts} attempts` : "-"],
          ["Window", settings ? `${settings.security.loginWindowMinutes} min` : "-"],
          ["Lockout", settings ? `${settings.security.loginLockoutMinutes} min` : "-"],
          ["Secure cookie", boolLabel(settings?.security.cookieSecure)],
          ["Trust proxy", boolLabel(settings?.security.trustProxy)]
        ]}
      />
    </SettingsSection>
  );
}

export function ServerStatusSettingsSection({
  settings
}: ServerSettingsSectionsProps) {
  return (
    <SettingsSection
      icon={ServerCog}
      title="Server"
      value={settings?.server.environment ?? "Loading"}
    >
      <SummaryList
        items={[
          ["Environment", settings?.server.environment ?? "-"],
          ["Version", settings?.server.version ?? "0.1.0"],
          ["Media roots", String(settings?.library.mediaRootCount ?? 0)],
          ["Watcher", settings?.library.watchEnabled ? "Enabled" : "Disabled"],
          ["Debounce", settings ? `${settings.library.watchDebounceMs} ms` : "-"]
        ]}
      />
      {settings?.library.mediaRoots.length ? (
        <div className="settings-root-list" aria-label="Media roots">
          {settings.library.mediaRoots.map((root) => (
            <span className="settings-pill" key={root.id}>
              {root.label}
            </span>
          ))}
        </div>
      ) : null}
    </SettingsSection>
  );
}

export function AiSettingsSection({ settings }: ServerSettingsSectionsProps) {
  return (
    <SettingsSection
      icon={Sparkles}
      title="AI"
      value={settings?.ai.enabled ? settings.ai.provider : "Disabled"}
    >
      <SummaryList
        items={[
          ["Provider", settings?.ai.provider ?? "-"],
          ["Model", settings?.ai.model ?? "-"],
          ["Timeout", settings ? `${settings.ai.timeoutMs} ms` : "-"]
        ]}
      />
    </SettingsSection>
  );
}

export function RuntimeSettingsSection() {
  return (
    <SettingsSection icon={Clock3} title="Runtime" value="Read-only">
      <p className="settings-note">
        Server configuration is managed through environment variables.
      </p>
    </SettingsSection>
  );
}
