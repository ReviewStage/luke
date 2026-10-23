/**
 * one-line.tsx -- words held to one line in a narrow column, ending in a
 * fade and in an ellipsis, a pane's heading and a name in the code face,
 * and a short line that ends on its last letter;
 * the pointer resting on a line cut short reads it whole in the window's
 * tooltip (`wholeWordsHint`).
 */

import { GAP, ONE_LINE_ELEMENT, ONE_LINE_END, OneLine, Stack, wholeWordsHint } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const ADDRESS = "sam.rivera+release-notifications@relay.example.com";

function OneLines(): React.JSX.Element {
  return (
    <CatalogSection id="one-line-ends" title="Ends, in a narrow column">
      <div className="catalog-narrow">
        <Stack gap={GAP.CONTROL}>
          <OneLine hint={wholeWordsHint(ADDRESS)}>{ADDRESS}</OneLine>
          <OneLine
            as={ONE_LINE_ELEMENT.STRONG}
            end={ONE_LINE_END.ELLIPSIS}
            hint={wholeWordsHint(ADDRESS)}
          >
            {ADDRESS}
          </OneLine>
          <OneLine as={ONE_LINE_ELEMENT.H2}>Release notifications for every workspace</OneLine>
          <OneLine as={ONE_LINE_ELEMENT.CODE}>linear_create_issue_with_attachments</OneLine>
          <OneLine as={ONE_LINE_ELEMENT.SMALL} hint={wholeWordsHint("sam@relay.dev")}>
            sam@relay.dev
          </OneLine>
        </Stack>
      </div>
    </CatalogSection>
  );
}

export const ONE_LINE_EXAMPLE: Example = { id: "one-line", title: "One line", Render: OneLines };
