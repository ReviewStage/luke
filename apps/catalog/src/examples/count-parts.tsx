import { CountParts, GAP, Inline, linesCount, STATUS_TONE } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * count-parts.tsx -- what an option counts as parts each in its own tone: a
 * pull request's checks as one part, and a diff's lines as the two parts
 * `linesCount` builds, additions in the complete tone and deletions in the
 * danger tone.
 */

function CountPartsExample(): React.JSX.Element {
  return (
    <CatalogSection id="count-parts" title="One part, and two">
      <Inline gap={GAP.SECTION}>
        <span>
          <CountParts parts={[{ text: "9/9", tone: STATUS_TONE.COMPLETE }]} />
        </span>
        <span>
          <CountParts parts={[{ text: "3/9", tone: STATUS_TONE.ATTENTION }]} />
        </span>
        <span>
          <CountParts parts={[{ text: "12 files" }]} />
        </span>
        <span>
          <CountParts parts={linesCount(120, 34)} />
        </span>
      </Inline>
    </CatalogSection>
  );
}

export const COUNT_PARTS_EXAMPLE: Example = {
  id: "count-parts",
  title: "Count parts",
  Render: CountPartsExample,
};
