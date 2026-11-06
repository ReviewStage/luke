/**
 * turn-ends.tsx -- the line an agent's turn ends on: failed with Try again
 * on its row, failed with Continue in new agent, failed on a refused key
 * with its remedy inside the line, stopped, a failure too long to share its
 * row in a narrow column, and the row centered as an empty tab's column is.
 */

import { BUTTON_VARIANT, Button, TurnEnd } from "@repo/ui";
import { ArrowRightIcon, GLYPH } from "@repo/ui/icons";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A press the catalog has nowhere to take. */
function stay(): void {}

/** Try again, as a turn a message carries on ends on it. */
function TryAgain(): React.JSX.Element {
  return (
    <Button variant={BUTTON_VARIANT.OUTLINE} icon={<GLYPH.RETRY />} onClick={stay}>
      Try again
    </Button>
  );
}

/** Continue in new agent, as a turn only a new agent goes on from ends on it. */
function ContinueInNewAgent(): React.JSX.Element {
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      icon={<ArrowRightIcon aria-hidden="true" />}
      onClick={stay}
    >
      Continue in new agent
    </Button>
  );
}

function TurnEnds(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="turn-end-try-again" title="Failed, with Try again">
        <div className="catalog-frame">
          <TurnEnd failure={CATALOG_FAILURE} press={<TryAgain />}>
            Failed: the sandbox or checkout failed
          </TurnEnd>
        </div>
      </CatalogSection>
      <CatalogSection id="turn-end-continue" title="Failed, with Continue in new agent">
        <div className="catalog-frame">
          <TurnEnd failure={CATALOG_FAILURE} press={<ContinueInNewAgent />}>
            Failed: the agent's session ended and cannot be reached again
          </TurnEnd>
        </div>
      </CatalogSection>
      <CatalogSection id="turn-end-remedy" title="Failed on a refused key, its remedy in the line">
        <div className="catalog-frame">
          <TurnEnd
            failure={CATALOG_FAILURE}
            remedy={
              <Button variant={BUTTON_VARIANT.OUTLINE} onClick={stay}>
                Connect Claude
              </Button>
            }
          >
            Failed: your API key was refused or cannot be read
          </TurnEnd>
        </div>
      </CatalogSection>
      <CatalogSection id="turn-end-stopped" title="Stopped">
        <div className="catalog-frame">
          <TurnEnd>Stopped</TurnEnd>
        </div>
      </CatalogSection>
      <CatalogSection id="turn-end-narrow" title="A long failure in a narrow column">
        <div className="catalog-narrow">
          <TurnEnd failure={CATALOG_FAILURE} press={<TryAgain />}>
            Failed: GitHub refused or could not be reached
          </TurnEnd>
        </div>
      </CatalogSection>
      <CatalogSection id="turn-end-centered" title="Centered, as an empty tab's column">
        <div className="catalog-frame">
          <TurnEnd failure={CATALOG_FAILURE} press={<ContinueInNewAgent />} centered>
            Failed: the agent never started
          </TurnEnd>
        </div>
      </CatalogSection>
    </>
  );
}

export const TURN_ENDS_EXAMPLE: Example = {
  id: "turn-ends",
  title: "Turn ends",
  Render: TurnEnds,
};
