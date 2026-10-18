import {
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  Stack,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * disclosures.tsx -- a fold closed and open, its body indented under the
 * summary's words or flush with the row, and a summary long enough to wrap
 * in a pane narrower than its words.
 */

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
