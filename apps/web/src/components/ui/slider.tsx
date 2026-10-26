import * as React from "react";
import { cn } from "cn";
import { Slider as SliderPrimitive } from "radix-ui";

function Slider({
  className,
  value,
  defaultValue,
  thumbLabels,
  formatValue,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  thumbLabels?: string[];
  formatValue?: (value: number) => string;
}) {
  const values = value ?? defaultValue ?? [0];
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=horizontal]:h-11 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-11 data-[orientation=vertical]:flex-col",
        className
      )}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      {values.map((current, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          aria-label={thumbLabels?.[index]}
          aria-valuetext={formatValue?.(current)}
          className="block size-5 shrink-0 rounded-full border border-primary bg-background shadow-sm transition-[box-shadow] focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 after:absolute after:inset-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
