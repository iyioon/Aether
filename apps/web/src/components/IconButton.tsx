import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./ui/button";

export interface IconButtonProps extends Omit<
  ComponentProps<typeof Button>,
  "children"
> {
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
  size = "icon",
  title,
  type = "button",
  variant = "outline",
  ...buttonProps
}: IconButtonProps) {
  return (
    <Button
      {...buttonProps}
      aria-label={label}
      className={className}
      title={title ?? label}
      type={type}
      size={size}
      variant={variant}
    >
      <Icon className={iconClassName} size={iconSize} />
    </Button>
  );
}
