import {
  BackIcon,
  Badge,
  BUTTON_VARIANT,
  Button,
  FoldingButton,
  NOT_FOUND_THING,
  NotFound,
  TOOLBAR_INSET,
  Toolbar,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * toolbars.tsx -- a workspace's bar with its title and actions; one led by a
 * way back, a tag after its title; one led by a control at the column's own
 * edge; a narrow bar, whose title ends in an ellipsis rather than wrapping;
 * and a place that is not found keeping its bar.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

function NewAutomation(): React.JSX.Element {
  return (
    <Button variant={BUTTON_VARIANT.PRIMARY} onClick={stay}>
      New automation
    </Button>
  );
}

function Toolbars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="toolbar-title" title="A title and actions">
        <Toolbar title="Automations" actions={<NewAutomation />} />
      </CatalogSection>
      <CatalogSection id="toolbar-lead" title="Led by a way back, a tag after the title">
        <Toolbar
          lead={<FoldingButton label="Inbox" icon={<BackIcon />} onClick={stay} />}
          title="New thread"
          tag={<Badge>Experiment</Badge>}
          actions={
            <Button variant={BUTTON_VARIANT.QUIET} onClick={stay}>
              Discard
            </Button>
          }
        />
      </CatalogSection>
      <CatalogSection id="toolbar-column" title="A control at the column's own edge">
        <Toolbar
          start={TOOLBAR_INSET.COLUMN}
          lead={<FoldingButton label="Settings" icon={<BackIcon />} onClick={stay} />}
        />
      </CatalogSection>
      <CatalogSection id="toolbar-narrow" title="A narrow bar cuts its title">
        <div className="catalog-narrow">
          <Toolbar title="Quarterly review of the onboarding funnel" actions={<NewAutomation />} />
        </div>
      </CatalogSection>
      <CatalogSection id="toolbar-not-found" title="Not found, under its bar">
        <div className="catalog-empty-room">
          <NotFound
            thing={NOT_FOUND_THING.AUTOMATION}
            bar={{ lead: <FoldingButton label="Automations" icon={<BackIcon />} onClick={stay} /> }}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const TOOLBARS_EXAMPLE: Example = {
  id: "toolbars",
  title: "Toolbars",
  Render: Toolbars,
};
