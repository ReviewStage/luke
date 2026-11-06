import { CountParts, GAP, Inline, linesCount, STATUS_TONE } from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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
