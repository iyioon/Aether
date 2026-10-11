import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface ToolbarMenuProps {
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
  icon: LucideIcon;
  isOpen: boolean;
  label: string;
  menuId: string;
  valueLabel: string;
  onOpenChange: (isOpen: boolean) => void;
}

export function ToolbarMenu({
  align = "start",
  children,
  className,
  icon: Icon,
  isOpen,
  label,
  menuId,
  valueLabel,
  onOpenChange
}: ToolbarMenuProps) {
  const panelId = `control-menu-${menuId}`;
  return (
    <div
      className={["control-menu", className].filter(Boolean).join(" ")}
      data-state={isOpen ? "open" : "closed"}
    >
      <Tooltip>
        <Popover open={isOpen} onOpenChange={onOpenChange}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                className="control-menu-trigger"
                type="button"
                size="icon"
                variant="outline"
                aria-label={`${label}: ${valueLabel}`}
                aria-controls={panelId}
                aria-expanded={isOpen}
              >
                <Icon />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <PopoverContent
            align={align}
            className="max-h-[70vh] w-80 overflow-y-auto"
            collisionPadding={12}
            id={panelId}
            sideOffset={8}
            aria-label={label}
          >
            <PopoverHeader>
              <PopoverTitle>{label}</PopoverTitle>
              <PopoverDescription>{valueLabel}</PopoverDescription>
            </PopoverHeader>
            {children}
          </PopoverContent>
        </Popover>
        <TooltipContent side="bottom">
          {label}: {valueLabel}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
