import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

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
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const panelId = `control-menu-${menuId}`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      onOpenChange(false);
    }

    function closeOnFocusOutside(event: FocusEvent) {
      const target = event.target;

      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      onOpenChange(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("focusin", closeOnFocusOutside);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("focusin", closeOnFocusOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onOpenChange]);

  return (
    <details
      className={[
        "control-menu",
        align === "end" ? "align-end" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      open={isOpen}
      ref={menuRef}
    >
      <summary
        className="control-menu-trigger"
        aria-label={`${label}: ${valueLabel}`}
        aria-controls={panelId}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.preventDefault();
          onOpenChange(!isOpen);
        }}
      >
        <Icon size={15} />
        <span className="control-menu-text">
          <span className="control-menu-label">{label}</span>
          <small className="control-menu-value">{valueLabel}</small>
        </span>
        <ChevronDown size={14} className="control-menu-chevron" />
      </summary>
      <div
        className="control-menu-panel"
        id={panelId}
        role="group"
        aria-label={label}
      >
        <div className="control-menu-panel-header">
          <span className="control-menu-panel-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span className="control-menu-panel-title">
            <strong>{label}</strong>
            <small>{valueLabel}</small>
          </span>
        </div>
        {children}
      </div>
    </details>
  );
}
