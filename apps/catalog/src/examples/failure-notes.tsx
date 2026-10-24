/**
 * failure-notes.tsx -- a failure's line with Retry after its words, one with
 * no Retry, a tool's error of several lines, and long words in a column
 * narrower than the line.
 */

import { FailureNote } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A press the catalog has nowhere to take. */
function stay(): void {}

function FailureNotes(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="failure-note-retry" title="With Retry">
        <div className="catalog-frame">
          <FailureNote onRetry={stay}>The message could not be sent.</FailureNote>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-alone" title="No Retry">
        <div className="catalog-frame">
          <FailureNote>The answer could not be sent.</FailureNote>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-lines" title="A tool's error of several lines">
        <div className="catalog-frame">
          <FailureNote>
            {
              "Command failed with exit code 1.\nerror: pathspec 'main' did not match any file(s) known to git"
            }
          </FailureNote>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-narrow" title="Long words in a narrow column">
        <div className="catalog-narrow">
          <FailureNote onRetry={stay}>
            The list of the workspace’s automations could not be read from the service.
          </FailureNote>
        </div>
      </CatalogSection>
    </>
  );
}

export const FAILURE_NOTES_EXAMPLE: Example = {
  id: "failure-notes",
  title: "Failure notes",
  Render: FailureNotes,
};
