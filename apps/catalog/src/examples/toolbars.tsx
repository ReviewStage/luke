import {
  BackButton,
  Badge,
  BUTTON_VARIANT,
  Button,
  ComposeIcon,
  FoldingButton,
  NOT_FOUND_THING,
  NotFound,
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  Toolbar,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * toolbars.tsx -- a workspace's bar with its title and actions; one led by a
 * way back, a tag after its title; one led by a control at the column's own
 * edge; a narrow bar, whose title fades where cut rather than wrapping; a
 * bar told to fold, its controls' glyphs alone; a tab strip's bar in a narrow
 * room, wrapping its strip to a row of its own; and a place that is not found
 * keeping its bar.
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
          lead={<BackButton label="Inbox" place="inbox" onBack={stay} />}
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
          lead={<BackButton label="Settings" place="settings" onBack={stay} />}
        />
      </CatalogSection>
      <CatalogSection id="toolbar-narrow" title="A narrow bar cuts its title">
        <div className="catalog-narrow">
          <Toolbar title="Quarterly review of the onboarding funnel" actions={<NewAutomation />} />
        </div>
      </CatalogSection>
      <CatalogSection
        id="toolbar-folded"
        title="Told to fold, its controls draw their glyphs alone"
      >
        <Toolbar
          title="Chat"
          folded
          actions={<FoldingButton label="Send feedback" icon={<ComposeIcon />} onClick={stay} />}
        />
      </CatalogSection>
      <CatalogSection id="toolbar-tabs" title="A tab strip's bar wraps its strip in a narrow room">
        <div data-room="narrow">
          <Toolbar
            look={TOOLBAR_LOOK.TABS}
            start={TOOLBAR_INSET.COLUMN}
            title={<Badge>Agent one</Badge>}
            actions={<NewAutomation />}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="toolbar-not-found" title="Not found, under its bar">
        <div className="catalog-empty-room">
          <NotFound
            thing={NOT_FOUND_THING.AUTOMATION}
            bar={{ lead: <BackButton label="Automations" place="automations" onBack={stay} /> }}
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
