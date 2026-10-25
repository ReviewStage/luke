/**
 * tab-notices.tsx -- the line under a tab's bar: words alone, words with the
 * press that answers them, and long words in a column narrower than the line.
 */

import { Button, TabNotice } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A press the catalog has nowhere to take. */
function stay(): void {}

function TabNotices(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="tab-notice-words" title="Words alone">
        <div className="catalog-frame">
          <TabNotice>
            <p>Only the first 300 files are shown.</p>
          </TabNotice>
        </div>
      </CatalogSection>
      <CatalogSection id="tab-notice-press" title="With a press">
        <div className="catalog-frame">
          <TabNotice>
            <p>Only files whose path holds “billing” are shown.</p>
            <Button onClick={stay}>Clear filter</Button>
          </TabNotice>
        </div>
      </CatalogSection>
      <CatalogSection id="tab-notice-narrow" title="Long words in a narrow column">
        <div className="catalog-narrow">
          <TabNotice>
            <p>New commits since these chapters were made. Their lines name an older head.</p>
            <Button onClick={stay}>Regenerate</Button>
          </TabNotice>
        </div>
      </CatalogSection>
    </>
  );
}

export const TAB_NOTICES_EXAMPLE: Example = {
  id: "tab-notices",
  title: "Tab notices",
  Render: TabNotices,
};
