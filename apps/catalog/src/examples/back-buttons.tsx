import {
  BACK_BUTTON_LOOK,
  BackButton,
  BUTTON_VARIANT,
  Button,
  NAV_CURRENT,
  NavItem,
  Toolbar,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * back-buttons.tsx -- the one way back: in a bar, its words drawn, and
 * folded away to its glyph where the bar folds its acts; at the top of a column of places; and a
 * page with a parent, whose bar leads with its trail, the page's own name
 * last.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

function BackButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="back-button-header" title="In a bar">
        <Toolbar
          lead={<BackButton label="Inbox" place="inbox" onBack={stay} />}
          title="Nightly triage"
        />
      </CatalogSection>
      <CatalogSection id="back-button-folded" title="In a bar that folds its words">
        <div className="catalog-folded">
          <Toolbar
            lead={<BackButton label="Inbox" place="Inbox" onBack={stay} />}
            title="New thread"
            actions={
              <Button variant={BUTTON_VARIANT.QUIET} onClick={stay}>
                Discard
              </Button>
            }
          />
        </div>
      </CatalogSection>
      <CatalogSection id="back-button-column" title="At the top of a column">
        <div className="catalog-narrow">
          <BackButton
            look={BACK_BUTTON_LOOK.COLUMN}
            label="All versions"
            place="all versions"
            onBack={stay}
          />
          <NavItem current={NAV_CURRENT.PAGE}>Today, 9:41 AM</NavItem>
          <NavItem>Yesterday, 4:12 PM</NavItem>
        </div>
      </CatalogSection>
      <CatalogSection id="back-button-trail" title="A page with a parent leads with its trail">
        <Toolbar
          trail={[{ label: "Automations", icon: <GLYPH.AUTOMATION />, onPress: stay }]}
          title="Nightly triage"
        />
      </CatalogSection>
    </>
  );
}

export const BACK_BUTTONS_EXAMPLE: Example = {
  id: "back-buttons",
  title: "Back buttons",
  Render: BackButtons,
};
