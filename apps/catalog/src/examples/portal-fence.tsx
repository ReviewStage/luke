/**
 * portal-fence.tsx -- a control inside a fold's summary whose press, fenced, stays its own rather than folding the summary around it, as a viewer drawn in a portal keeps its presses from the section that drew it.
 */

import {
  BUTTON_VARIANT,
  Button,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  PortalFence,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function PortalFences(): React.JSX.Element {
  const [presses, setPresses] = useState(0);
  return (
    <CatalogSection id="portal-fence-summary" title="Fenced in a summary">
      <Disclosure>
        <DisclosureSummary>
          <Text variant={TEXT_VARIANT.LABEL}>A section</Text>
          <PortalFence>
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              onClick={() => setPresses((count) => count + 1)}
            >
              Fenced
            </Button>
          </PortalFence>
        </DisclosureSummary>
        <DisclosureBody>
          <Text variant={TEXT_VARIANT.BODY}>What the section holds</Text>
        </DisclosureBody>
      </Disclosure>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {`Fenced pressed ${String(presses)} times · the section never folds at it`}
      </Text>
    </CatalogSection>
  );
}

export const PORTAL_FENCE_EXAMPLE: Example = {
  id: "portal-fence",
  title: "Portal fence",
  Render: PortalFences,
};
