import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import type { AppearanceAccentOption } from "./useAppearanceSettings";

export function ChoiceGroup({
  children,
  columns = "auto",
  label
}: {
  children: ReactNode;
  columns?: "auto" | "two" | "three" | "five";
  label: string;
}) {
  return (
    <div className="settings-field-group">
      <div className="settings-field-heading">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div
        className={`settings-choice-grid settings-choice-grid-${columns}`}
        role="radiogroup"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

export function SwatchChoice({
  active,
  option,
  onClick
}: {
  active: boolean;
  option: AppearanceAccentOption;
  onClick: () => void;
}) {
  return (
    <Button
      className="justify-start"
      style={{ "--settings-swatch": option.color } as CSSProperties}
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      variant={active ? "secondary" : "outline"}
    >
      <span className="settings-swatch" aria-hidden="true" />
      <strong className="truncate text-sm font-medium">{option.label}</strong>
    </Button>
  );
}

export function TextChoice({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="justify-start"
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      variant={active ? "secondary" : "outline"}
    >
      <strong className="truncate text-sm font-medium">{label}</strong>
    </Button>
  );
}

export function IconChoice({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="justify-start"
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      variant={active ? "secondary" : "outline"}
    >
      <Icon />
      <strong className="truncate text-sm font-medium">{label}</strong>
    </Button>
  );
}

export function CheckboxChoice({
  active,
  label,
  onChange
}: {
  active: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <Checkbox checked={active} onCheckedChange={onChange} />
      <span className="truncate text-sm font-medium">{label}</span>
    </label>
  );
}
