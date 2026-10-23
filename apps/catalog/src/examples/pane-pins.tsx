/**
 * pane-pins.tsx -- a pane floated by its toggle and put away by a press anywhere outside it: a press inside the pane, or on the strip that holds its toggle, is pinned as its own and leaves it standing.
 */

import {
  BUTTON_VARIANT,
  Button,
  GAP,
  PANE_PIN_ELEMENT,
  PanePin,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useEffect, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function PanePins(): React.JSX.Element {
  const [floating, setFloating] = useState(false);
  const [presses, setPresses] = useState(0);
  // Whether the press the document hears next was pinned on its way up.
  const pinned = useRef(false);
  useEffect(() => {
    if (!floating) return;
    pinned.current = false;
    const press = () => {
      if (!pinned.current) setFloating(false);
      pinned.current = false;
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [floating]);
  const pin = () => {
    pinned.current = true;
  };
  return (
    <CatalogSection id="pane-pin-float" title="A floating pane">
      <Stack gap={GAP.FIELD}>
        <PanePin as={PANE_PIN_ELEMENT.DIV} onPin={floating ? pin : undefined}>
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setFloating((on) => !on)}>
            {floating ? "Put the pane away" : "Float the pane"}
          </Button>
        </PanePin>
        {floating ? (
          <PanePin aria-label="Floating pane" onPin={pin}>
            <Stack gap={GAP.TIGHT}>
              <Text variant={TEXT_VARIANT.LABEL}>Pinned while you press in here</Text>
              <Button onClick={() => setPresses((count) => count + 1)}>Press inside</Button>
            </Stack>
          </PanePin>
        ) : null}
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {`Pressed inside ${String(presses)} times · a press anywhere else puts it away`}
        </Text>
      </Stack>
    </CatalogSection>
  );
}

export const PANE_PINS_EXAMPLE: Example = {
  id: "pane-pins",
  title: "Pane pins",
  Render: PanePins,
};
