import { CountFigure, GAP, Inline, STATUS_TONE } from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * count-figures.tsx -- a count's figure as every count draws it: a figure
 * up to 99 whole, one past it as 99+ with the whole number said to a reader.
 */

function CountFigures(): React.JSX.Element {
  return (
    <CatalogSection
      id="count-figure"
      title="Figures: 7 and 99 stand whole, 128 and 1,204 are drawn 99+ and read whole"
    >
      <Inline gap={GAP.CONTROL}>
        {[7, 99, 128, 1204].map((value) => (
          <span key={value} data-tone={STATUS_TONE.ATTENTION} className="text-tone-ink">
            <CountFigure value={value} />
          </span>
        ))}
      </Inline>
    </CatalogSection>
  );
}

export const COUNT_FIGURES_EXAMPLE: Example = {
  id: "count-figures",
  title: "Count figures",
  Render: CountFigures,
};
