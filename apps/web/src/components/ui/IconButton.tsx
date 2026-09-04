import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  iconSize?: number;
}

export function IconButton({
  className,
  icon: Icon,
  iconClassName,
  iconSize = 18,
  label,
  title,
  type = "button",
  ...buttonProps
}: IconButtonProps) {
  const classNames = ["icon-button", className].filter(Boolean).join(" ");

  return (
    <button
      {...buttonProps}
      aria-label={label}
      className={classNames}
      title={title ?? label}
      type={type}
    >
      <Icon className={iconClassName} size={iconSize} />
    </button>
  );
}
