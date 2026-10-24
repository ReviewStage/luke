import { BUTTON_VARIANT, Button, MoreButton, PAGE_HEADER_END, PageHeader } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * page-header.tsx -- a document's own header: a plan's title, the line
 * saying what it is, and its acts at the title's end; Settings' title with
 * a quiet Reset whose words end on the content's edge; and a long title in
 * a narrow column, its acts wrapping under it rather than standing outside
 * the page.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

function PlanActions(): React.JSX.Element {
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} onClick={stay}>
        Share
      </Button>
      <MoreButton thing="Task" onClick={stay} />
    </>
  );
}

function PageHeaders(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="page-header-plan" title="A plan's title, what it is, and its acts">
        <PageHeader
          title="Launch checklist"
          description="A task in the platform workspace."
          actions={<PlanActions />}
        />
      </CatalogSection>
      <CatalogSection id="page-header-settings" title="A quiet Reset ends on the content's edge">
        <PageHeader
          title="Settings"
          actions={
            <Button variant={BUTTON_VARIANT.QUIET} onClick={stay}>
              Reset
            </Button>
          }
          end={PAGE_HEADER_END.WORDS}
        />
      </CatalogSection>
      <CatalogSection id="page-header-narrow" title="A long title wraps its acts under it">
        <div className="catalog-narrow">
          <PageHeader title="Quarterly review of the onboarding funnel" actions={<PlanActions />} />
        </div>
      </CatalogSection>
    </>
  );
}

export const PAGE_HEADER_EXAMPLE: Example = {
  id: "page-header",
  title: "Page header",
  Render: PageHeaders,
};
