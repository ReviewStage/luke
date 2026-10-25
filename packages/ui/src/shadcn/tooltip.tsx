import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "../cn.js";

/**
 * tooltip.tsx -- shadcn/ui's tooltip (style `base-nova`, on Base UI), vendored and drawn as Luke's dark pill.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add tooltip` reads as a small diff. Luke's
 * changes: the pill is the palette's tooltip ink with its hairline, corner,
 * and lift, at the caption's type, held inside the window however long its
 * words; it takes no presses, fades and grows in on the motion tokens from
 * the edge facing its control, and is never part of the desktop's drag
 * region. It hangs below its control and turns above where the window
 * ends, held a margin inside it, on the window's own layer; the positioner
 * takes the control it hangs from (`anchor`) and a fixed position, because
 * when it shows is `@luke/ui`'s `Tooltip`'s (`components/tooltip/hint.tsx`),
 * not a trigger's. shadcn's arrow, trigger, and provider are left out: the
 * pill always hangs centred on what it names. What an app draws is
 * `@luke/ui`'s `TooltipPill`; this is its inside.
 */

/** The gap between a control and its hint, and the hint's least distance from the window's edge, in CSS pixels. */
export const TOOLTIP_GAP = 6;
export const TOOLTIP_MARGIN = 6;

/** The pill, and what a card hung in its place shares with it: its layer of type and motion, and fading as it leaves. */
export const TOOLTIP_SURFACE =
  "luke-tooltip font-sans text-tag font-tag origin-(--transform-origin) animate-tooltip-in data-leaving:pointer-events-none data-leaving:animate-tooltip-leave in-data-[luke-profile=desktop]:[-webkit-app-region:no-drag]";

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipContent({
  className,
  side = "bottom",
  sideOffset = TOOLTIP_GAP,
  align = "center",
  alignOffset = 0,
  anchor,
  collisionAvoidance,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor" | "collisionAvoidance"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        collisionPadding={TOOLTIP_MARGIN}
        collisionAvoidance={collisionAvoidance}
        positionMethod="fixed"
        className="isolate z-tooltip"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            TOOLTIP_SURFACE,
            "pointer-events-none flex w-fit max-w-tooltip items-center gap-icon-gap rounded-tooltip border border-tooltip-edge bg-tooltip px-2 py-1 text-tooltip-foreground shadow-tooltip wrap-anywhere",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent };
