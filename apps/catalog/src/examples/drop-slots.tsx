import { CARD_DROP_TARGET, DropSlot } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * drop-slots.tsx -- the empty place a carried row lands in, as a list that
 * holds no row yet draws it while one is carried, and as it stands with the
 * row carried over it.
 */

function DropSlots(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="drop-slot" title="Waiting for a row">
        <div className="catalog-frame">
          <DropSlot />
        </div>
      </CatalogSection>
      <CatalogSection id="drop-slot-target" title="A row carried over it">
        <div className="catalog-frame" {...{ [CARD_DROP_TARGET]: "true" }}>
          <DropSlot />
        </div>
      </CatalogSection>
    </>
  );
}

export const DROP_SLOTS_EXAMPLE: Example = {
  id: "drop-slots",
  title: "Drop slots",
  Render: DropSlots,
};
