import {
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  Stack,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * disclosures.tsx -- a fold closed and open, its body indented under the
 * summary's words or flush with the row, a fold whose holder keeps its
 * state, and a summary long enough to wrap in a pane narrower than its words.
 */

/** A fold whose open state its holder keeps, as a tab keeps which of its notes it folded. */
function HeldDisclosure(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <Disclosure open={open} onOpenChange={setOpen}>
      <DisclosureSummary>
        <span>Luke · Lines 12–18</span>
      </DisclosureSummary>
      <DisclosureBody>
        <Text>The retry loop starts here, before the first request is sent.</Text>
      </DisclosureBody>
    </Disclosure>
  );
}

function Disclosures(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="disclosure-indented" title="Body under the words">
        <div className="catalog-frame catalog-frame-wide">
          <Stack>
            <Disclosure>
              <DisclosureSummary>
                <span>3 tools called</span>
              </DisclosureSummary>
              <DisclosureBody>
                <Text>Read package.json</Text>
                <Text>Searched for “Disclosure”</Text>
                <Text>Edited disclosure.tsx</Text>
              </DisclosureBody>
            </Disclosure>
            <Disclosure defaultOpen>
              <DisclosureSummary>
                <span>2 tools called</span>
              </DisclosureSummary>
              <DisclosureBody>
                <Text>Ran the tests</Text>
                <Text>Opened a pull request</Text>
              </DisclosureBody>
            </Disclosure>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-flush" title="Body flush with the row">
        <div className="catalog-frame catalog-frame-wide">
          <Disclosure defaultOpen>
            <DisclosureSummary>
              <span>Summary of 12 earlier steps</span>
            </DisclosureSummary>
            <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
              <Text>
                Luke read the plan, split it into three tasks, and started an agent on each.
              </Text>
            </DisclosureBody>
          </Disclosure>
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-held" title="Held by its holder">
        <div className="catalog-frame catalog-frame-wide">
          <HeldDisclosure />
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-long" title="Long summary, narrow pane">
        <div className="catalog-frame">
          <Disclosure>
            <DisclosureSummary>
              <span>
                4 options offered · Dana picked “Keep the old endpoint until every client has moved”
              </span>
            </DisclosureSummary>
            <DisclosureBody>
              <Text>Keep the old endpoint until every client has moved</Text>
            </DisclosureBody>
          </Disclosure>
        </div>
      </CatalogSection>
    </>
  );
}

export const DISCLOSURES_EXAMPLE: Example = {
  id: "disclosures",
  title: "Disclosures",
  Render: Disclosures,
};
