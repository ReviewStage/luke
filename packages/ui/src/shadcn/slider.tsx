import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "../cn.js";

/**
 * slider.tsx -- shadcn/ui's slider (style `base-nova`, on Base UI), vendored and drawn in Luke's switch inks.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add slider` reads as a small diff. Luke's
 * changes: the track and range in the switch's track and "on" inks, the
 * thumb a 16px round of the switch's thumb ink lifted by its shadow, as a
 * switch's is, giving a little under a press held; a `thumbLabel` each
 * thumb is named by and a `thumbValueText` it is read as, which shadcn
 * leaves to its caller's `getAriaLabel` and `getAriaValueText`;
 * the one press cursor (`cursor-press`); and none of shadcn's outline or ring
 * utilities, because the window's own focus ring (`@luke/panel`'s
 * base.css) draws the keyboard's ring and a utility would outrank it
 * (`shadcn-focus.test.ts`). `@luke/ui`'s `Slider`
 * (`components/slider/slider.tsx`) is what an app draws; this is its inside.
 */

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
          className="relative grow overflow-hidden rounded-luke-full bg-switch-track select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
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
            className="relative block size-4 shrink-0 rounded-luke-full bg-switch-thumb shadow-switch-thumb transition-transform duration-(--luke-duration-fast) ease-spring-fast select-none after:absolute after:-inset-2 cursor-press active:scale-[0.85] disabled:pointer-events-none disabled:opacity-disabled"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
