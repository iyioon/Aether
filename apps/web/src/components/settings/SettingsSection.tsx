import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card";

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
    <Card className="settings-card">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-5 text-muted-foreground" />
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{value}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">{children}</CardContent>
    </Card>
  );
}
