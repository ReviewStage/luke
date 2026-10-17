import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  POPOVER_ALIGN,
  type PopoverAlign,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * anchored-popover.tsx -- a popover hung from its button by either edge, and
 * one inside a short room that scrolls, which turns below its button as the
 * room scrolls it toward the top.
 */

/** A button and the popover it opens, hung from the edge `align` names. */
function Hung({ align, label }: { align: PopoverAlign; label: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="catalog-anchor">
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open && (
        <AnchoredPopover align={align}>
          <div className="catalog-popover">
            <Text tone={TEXT_TONE.MUTED}>Hung from the button's {align} edge.</Text>
          </div>
        </AnchoredPopover>
      )}
    </div>
  );
}

function AnchoredPopoverExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="anchored-popover-edges" title="From either edge">
        <div className="catalog-popover-stage">
          <Inline gap={GAP.CONTROL} justify="between">
            <Hung align={POPOVER_ALIGN.START} label="Leading edge" />
            <Hung align={POPOVER_ALIGN.END} label="Trailing edge" />
          </Inline>
        </div>
      </CatalogSection>
      <CatalogSection id="anchored-popover-room" title="Inside a room that scrolls">
        <div className="catalog-popover-room" data-popover-room="">
          <div className="catalog-popover-scroll">
            <Hung align={POPOVER_ALIGN.START} label="Open, then scroll" />
          </div>
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
