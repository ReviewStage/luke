import { Arrival, BUTTON_VARIANT, Button, NOTE_LINE_LOOK, NoteLine } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function Arrivals(): React.JSX.Element {
  const [reading, setReading] = useState(true);
  return (
    <>
      <CatalogSection id="arrival-reading" title="Reading, past a second">
        <div className="catalog-frame">
          <Arrival reading label="Reading your tasks…">
            <NoteLine look={NOTE_LINE_LOOK.ROWS}>Relay retries on 502</NoteLine>
          </Arrival>
        </div>
      </CatalogSection>
      <CatalogSection id="arrival-landing" title="Landing">
        <div className="catalog-frame">
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setReading((now) => !now)}>
            {reading ? "Land the read" : "Read again"}
          </Button>
          <Arrival reading={reading} label="Reading your tasks…">
            <NoteLine look={NOTE_LINE_LOOK.ROWS}>Relay retries on 502</NoteLine>
            <NoteLine look={NOTE_LINE_LOOK.ROWS}>Edge cache keys</NoteLine>
          </Arrival>
        </div>
      </CatalogSection>
    </>
  );
}

export const ARRIVALS_EXAMPLE: Example = {
  id: "arrivals",
  title: "Arrivals",
  Render: Arrivals,
};
