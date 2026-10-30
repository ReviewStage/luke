import { PAGER_AXIS, PAGER_COUNT, Pager, PaneBar } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * pagers.tsx -- an item stepped through its list one at a time: its place
 * before arrows up and down a column, before arrows left and right through
 * pages at the end of a tab's bar, the arrow at the first stepped back, and
 * between them with what it counts.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

function Pagers(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="pager-column" title="Up and down a column, its place leading">
        <Pager
          axis={PAGER_AXIS.VERTICAL}
          place={{ at: 2, total: 8 }}
          previous={{ label: "Previous item", onStep: stay }}
          next={{ label: "Next item", onStep: stay }}
        />
      </CatalogSection>
      <CatalogSection
        id="pager-pages"
        title="Through pages at the end of a tab's bar, at the first"
      >
        <PaneBar
          title="Read the expiry"
          actions={
            <Pager
              axis={PAGER_AXIS.HORIZONTAL}
              place={{ at: 1, total: 8 }}
              previous={{ label: "Previous chapter", onStep: undefined }}
              next={{
                label: "Next chapter",
                hint: "Next chapter: Sweep what expired",
                onStep: stay,
              }}
            />
          }
        />
      </CatalogSection>
      <CatalogSection
        id="pager-between"
        title="Its place between the arrows, saying what it counts"
      >
        <Pager
          axis={PAGER_AXIS.HORIZONTAL}
          count={PAGER_COUNT.BETWEEN}
          place={{ at: 3, total: 5, noun: "Run" }}
          previous={{ label: "Older run", onStep: stay }}
          next={{ label: "Newer run", onStep: stay }}
        />
      </CatalogSection>
    </>
  );
}

export const PAGERS_EXAMPLE: Example = {
  id: "pagers",
  title: "Pagers",
  Render: Pagers,
};
