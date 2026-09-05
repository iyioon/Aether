import type { CSSProperties, ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
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
        <span>{label}</span>
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
    <button
      className={
        active
          ? "settings-choice settings-choice-with-swatch active"
          : "settings-choice settings-choice-with-swatch"
      }
      style={{ "--settings-swatch": option.color } as CSSProperties}
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
    >
      <span className="settings-swatch" aria-hidden="true" />
      <span>
        <strong>{option.label}</strong>
      </span>
      <CheckMark active={active} />
    </button>
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
    <button
      className={
        active
          ? "settings-choice settings-choice-text-only active"
          : "settings-choice settings-choice-text-only"
      }
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
    >
      <span>
        <strong>{label}</strong>
      </span>
      <CheckMark active={active} />
    </button>
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
    <button
      className={
        active
          ? "settings-choice settings-choice-with-icon active"
          : "settings-choice settings-choice-with-icon"
      }
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
    >
      <span className="settings-choice-icon" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span>
        <strong>{label}</strong>
      </span>
      <CheckMark active={active} />
    </button>
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
    <label
      className={
        active ? "settings-checkbox-option active" : "settings-checkbox-option"
      }
    >
      <input type="checkbox" checked={active} onChange={onChange} />
      <span className="settings-checkbox" aria-hidden="true">
        {active ? <Check size={13} /> : null}
      </span>
      <span>{label}</span>
    </label>
  );
}

export function CheckMark({ active }: { active: boolean }) {
  return (
    <span className="settings-choice-check" aria-hidden="true">
      {active ? <Check size={13} /> : null}
    </span>
  );
}
