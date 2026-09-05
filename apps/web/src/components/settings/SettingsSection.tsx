import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function SettingsSection({
  children,
  icon: Icon,
  title,
  value
}: {
  children: ReactNode;
  icon: LucideIcon;
  title: string;
  value: string;
}) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <span className="settings-card-icon" aria-hidden="true">
          <Icon size={17} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{value}</p>
        </div>
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}
