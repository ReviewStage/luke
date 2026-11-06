import { CARD_DROP_TARGET, DropSlot } from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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
