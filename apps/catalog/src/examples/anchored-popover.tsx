import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  JUSTIFY,
  POPOVER_ALIGN,
  type PopoverAlign,
  PopoverPanel,
  ScrollArea,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * anchored-popover.tsx -- a popover hung from its button by either edge, and
 * one inside a short room that scrolls, which turns below its button as the
 * room scrolls it toward the top. Each holds a panel, which fades out in
 * its place as the popover closes, and leaves the layer where it stood.
 */

/** A button and the popover it opens, hung from the edge `align` names. */
function Hung({ align, label }: { align: PopoverAlign; label: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  return (
    <div className="catalog-anchor" ref={root}>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </Button>
      <AnchoredPopover open={open} align={align}>
        <PopoverPanel
          open={open}
          title={label}
          closeLabel="Close"
          onDismiss={() => setOpen(false)}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        >
          <div className="catalog-popover">
            <Text tone={TEXT_TONE.MUTED}>Hung from the button's {align} edge.</Text>
          </div>
        </PopoverPanel>
      </AnchoredPopover>
    </div>
  );
}

function AnchoredPopoverExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="anchored-popover-edges" title="From either edge">
        <div className="catalog-popover-stage">
          <Inline gap={GAP.CONTROL} justify={JUSTIFY.BETWEEN}>
            <Hung align={POPOVER_ALIGN.START} label="Leading edge" />
            <Hung align={POPOVER_ALIGN.END} label="Trailing edge" />
          </Inline>
        </div>
      </CatalogSection>
      <CatalogSection id="anchored-popover-room" title="Inside a room that scrolls">
        <div className="catalog-popover-room" data-popover-room="">
          <ScrollArea>
            <div className="catalog-popover-scroll">
              <Hung align={POPOVER_ALIGN.START} label="Open, then scroll" />
            </div>
          </ScrollArea>
        </div>
      </CatalogSection>
    </>
  );
}

export const ANCHORED_POPOVER_EXAMPLE: Example = {
  id: "anchored-popover",
  title: "Anchored popover",
  Render: AnchoredPopoverExample,
};
