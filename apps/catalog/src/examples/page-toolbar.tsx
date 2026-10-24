import {
  BackButton,
  BUTTON_VARIANT,
  Button,
  ONE_LINE_ELEMENT,
  OneLine,
  PageToolbar,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * page-toolbar.tsx -- a page's strip with its heading and actions, one led
 * by a way back, and one holding a way back alone. The strip wears the
 * window's own toolbar classes, which the panel's stylesheet lays out, so
 * here it stands in the order it reads rather than as the window draws it.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

function PageToolbars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="page-toolbar-heading" title="Heading and actions">
        <PageToolbar
          heading={<OneLine as={ONE_LINE_ELEMENT.H1}>Automations</OneLine>}
          actions={
            <Button variant={BUTTON_VARIANT.PRIMARY} onClick={stay}>
              New automation
            </Button>
          }
        />
      </CatalogSection>
      <CatalogSection id="page-toolbar-lead" title="Led by a way back">
        <PageToolbar
          lead={<BackButton label="Inbox" place="inbox" onBack={stay} />}
          heading={<OneLine as={ONE_LINE_ELEMENT.H1}>New thread</OneLine>}
          actions={
            <Button variant={BUTTON_VARIANT.QUIET} onClick={stay}>
              Discard
            </Button>
          }
        />
      </CatalogSection>
      <CatalogSection id="page-toolbar-back" title="A way back alone">
        <PageToolbar lead={<BackButton label="Settings" place="settings" onBack={stay} />} />
      </CatalogSection>
    </>
  );
}

export const PAGE_TOOLBAR_EXAMPLE: Example = {
  id: "page-toolbar",
  title: "Page toolbar",
  Render: PageToolbars,
};
