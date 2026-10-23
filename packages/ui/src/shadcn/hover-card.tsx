import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { cn } from "../cn.js";
import { TOOLTIP_GAP, TOOLTIP_MARGIN, TOOLTIP_SURFACE } from "./tooltip.js";

/**
 * hover-card.tsx -- shadcn/ui's hover card (style `base-nova`, on Base UI's preview card), vendored and drawn as the light card a hint hangs in its pill's place.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add hover-card` reads as a small diff. Luke's
 * changes: the card is a small panel of the window's own, the menu's
 * surface, edge, corner, and lift, at a card's width, its words as far in
 * from its sides as a menu's so a row it lists washes off its edge as a
 * menu item does; it shares the pill's type, motion, and leaving
 * (`tooltip.tsx`), takes the pointer and lets its words be selected, and is
 * left out of a session recording whole by the recorder's fixed
 * `ph-no-capture` class. It hangs from its control's start below it, turning
 * above where the window ends, or beside it, on the window's own layer; the
 * positioner takes the control (`anchor`) and a fixed position, because
 * when it shows is `@luke/ui`'s `Tooltip`'s. shadcn's trigger is left out.
 * What an app draws is `@luke/ui`'s `TooltipCard`; this is its inside.
 */

function HoverCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardContent({
  className,
  side = "bottom",
  sideOffset = TOOLTIP_GAP,
  align = "start",
  alignOffset = 0,
  anchor,
  collisionAvoidance,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor" | "collisionAvoidance"
  >) {
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
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
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            TOOLTIP_SURFACE,
            "luke-tooltip-card ph-no-capture pointer-events-auto flex w-tooltip-card cursor-default flex-col items-stretch gap-1 rounded-menu border border-border-strong bg-popover px-tooltip-card-inline py-1.5 font-body text-popover-foreground shadow-menu wrap-normal select-text",
            className,
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent };
