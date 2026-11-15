import { LockKeyhole, ServerCog, Sparkles } from "lucide-react";
import type { SettingsSummary, TreeRoot } from "../../api/client";
import { boolLabel } from "./settings-formatters";
import { SettingsSection } from "./SettingsSection";
import { SummaryList } from "./SettingsSummaryList";

interface ServerSettingsSectionsProps {
  settings: SettingsSummary | null;
}

export function SecuritySettingsSection({
  settings
}: ServerSettingsSectionsProps) {
  return (
    <SettingsSection
      icon={LockKeyhole}
      title="Security"
      value={
        settings
          ? settings.security.passwordConfigured
            ? "Password protected"
            : "Password missing"
          : undefined
      }
    >
      <SummaryList
        items={[
          [
            "Password",
            settings
              ? settings.security.passwordConfigured
                ? "Configured"
                : "Missing"
              : "—"
          ],
          [
            "Session",
            settings ? `${settings.security.sessionTtlDays} days` : "-"
          ],
          [
            "Login limit",
            settings ? `${settings.security.loginMaxAttempts} attempts` : "-"
          ],
          [
            "Window",
            settings ? `${settings.security.loginWindowMinutes} min` : "-"
          ],
          [
            "Lockout",
            settings ? `${settings.security.loginLockoutMinutes} min` : "-"
          ],
          ["Secure cookie", boolLabel(settings?.security.cookieSecure)],
          ["Trust proxy", boolLabel(settings?.security.trustProxy)]
        ]}
      />
    </SettingsSection>
  );
}

export function ServerStatusSettingsSection({
  settings,
  mediaRoots
}: ServerSettingsSectionsProps & { mediaRoots: TreeRoot[] }) {
  return (
    <SettingsSection
      icon={ServerCog}
      title="Server"
      value={settings?.server.environment}
    >
      <SummaryList
        items={[
          ["Environment", settings?.server.environment ?? "-"],
          ["Version", settings?.server.version ?? "—"],
          [
            "Media roots",
            settings ? String(settings.library.mediaRootCount) : "—"
          ],
          [
            "Writable roots",
            mediaRoots.length
              ? String(mediaRoots.filter((root) => root.writable).length)
              : settings?.library.mediaRootCount === 0
                ? "0"
                : "—"
          ],
          ["Watcher", boolLabel(settings?.library.watchEnabled)],
          [
            "Debounce",
            settings ? `${settings.library.watchDebounceMs} ms` : "-"
          ]
        ]}
      />
      {settings?.library.mediaRoots.length ? (
        <div className="settings-root-list" aria-label="Media roots">
          {settings.library.mediaRoots.map((root) => {
            const capability = mediaRoots.find((entry) => entry.id === root.id);
            return (
              <span className="settings-pill text-xs font-medium" key={root.id}>
                {root.label}
                {capability
                  ? ` · ${capability.writable ? "Writable" : "Read-only"}`
                  : ""}
              </span>
            );
          })}
        </div>
      ) : null}
    </SettingsSection>
  );
}

export function AiSettingsSection({ settings }: ServerSettingsSectionsProps) {
  return (
    <SettingsSection
      icon={Sparkles}
      title="Tag suggestions"
      value={
        settings
          ? settings.ai.enabled
            ? settings.ai.provider
            : "Disabled"
          : undefined
      }
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
