import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "../cn.js";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabel,
  thumbValueText,
  ...props
}: SliderPrimitive.Root.Props & {
  thumbLabel?: string | undefined;
  thumbValueText?: string | undefined;
}) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : value !== undefined
        ? [value]
        : [min, max];

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-disabled data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-ui-full bg-switch-track select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-switch-on select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            getAriaLabel={thumbLabel === undefined ? undefined : () => thumbLabel}
            getAriaValueText={thumbValueText === undefined ? undefined : () => thumbValueText}
            className="relative block size-4 shrink-0 rounded-ui-full bg-switch-thumb shadow-switch-thumb transition-transform duration-(--ui-duration-fast) ease-spring-fast select-none after:absolute after:-inset-2 cursor-press active:scale-[0.85] disabled:pointer-events-none disabled:opacity-disabled"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
