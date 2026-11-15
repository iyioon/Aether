import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Button } from "../ui/button";
import { RadioGroup } from "../ui/radio-group";
import type { AppearanceAccentOption } from "./useAppearanceSettings";

export function ChoiceGroup({
  children,
  columns = "auto",
  label,
  value,
  onValueChange
}: {
  children: ReactNode;
  columns?: "auto" | "two" | "three" | "five";
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="settings-field-group">
      <div className="settings-field-heading">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <RadioGroup
        className={`settings-choice-grid settings-choice-grid-${columns}`}
        aria-label={label}
        value={value}
        onValueChange={onValueChange}
      >
        {children}
      </RadioGroup>
    </div>
  );
}

export function SwatchChoice({
  active,
  option
}: {
  active: boolean;
  option: AppearanceAccentOption;
}) {
  return (
    <RadioGroupPrimitive.Item asChild value={option.value}>
      <Button
        className="justify-start"
        style={{ "--settings-swatch": option.color } as CSSProperties}
        type="button"
        variant={active ? "secondary" : "outline"}
      >
        <span className="settings-swatch" aria-hidden="true" />
        <strong className="truncate text-sm font-medium">{option.label}</strong>
      </Button>
    </RadioGroupPrimitive.Item>
  );
}

export function IconChoice({
  active,
  icon: Icon,
  label,
  value
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <RadioGroupPrimitive.Item asChild value={value}>
      <Button
        className="justify-start"
        type="button"
        variant={active ? "secondary" : "outline"}
      >
        <Icon />
        <strong className="truncate text-sm font-medium">{label}</strong>
      </Button>
    </RadioGroupPrimitive.Item>
  );
}
