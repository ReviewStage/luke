/**
 * rolling-number.tsx -- a count beside the words that say it, as a to-do
 * list's line says how far it has got: each press moves it on or back, and
 * the digits that changed roll, up as it grows and down as it falls.
 */

import {
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  RollingNumber,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const TOTAL = 12;

function RollingNumbers(): React.JSX.Element {
  const [done, setDone] = useState(8);
  return (
    <CatalogSection id="rolling-number-count" title="A count that ticks">
      <Inline gap={GAP.CONTROL}>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          <RollingNumber value={done} /> of <RollingNumber value={TOTAL} /> done
        </Text>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={() => setDone((now) => Math.max(0, now - 1))}
        >
          Back one
        </Button>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={() => setDone((now) => Math.min(TOTAL, now + 1))}
        >
          On one
        </Button>
      </Inline>
    </CatalogSection>
  );
}

export const ROLLING_NUMBER_EXAMPLE: Example = {
  id: "rolling-number",
  title: "Rolling number",
  Render: RollingNumbers,
};
