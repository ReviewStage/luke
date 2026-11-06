import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "../cn.js";

export const TOOLTIP_GAP = 6;
export const TOOLTIP_MARGIN = 6;

export const TOOLTIP_SURFACE =
  "ui-tooltip font-sans text-tag font-tag origin-(--transform-origin) animate-tooltip-in data-leaving:pointer-events-none data-leaving:animate-tooltip-leave in-data-[ui-profile=desktop]:[-webkit-app-region:no-drag]";

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
