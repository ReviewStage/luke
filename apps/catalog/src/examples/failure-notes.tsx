/**
 * failure-notes.tsx -- a failure's line with Retry after its words, one with
 * no Retry, a tool's error of several lines, long words in a column
 * narrower than the line, one standing in a list's place beside a note
 * line, at the rows' inset, and one that is a transcript's history, drawn
 * the same but no alert.
 */

import {
  FAILURE_NOTE_LOOK,
  FAILURE_NOTE_TIME,
  FailureNote,
  NOTE_LINE_LOOK,
  NoteLine,
} from "@luke/ui";
import { UNREPORTED } from "@luke/ui/reported-failure";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A press the catalog has nowhere to take. */
function stay(): void {}

function FailureNotes(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="failure-note-retry" title="With Retry">
        <div className="catalog-frame">
          <FailureNote failure={CATALOG_FAILURE} onRetry={stay}>
            The message could not be sent.
          </FailureNote>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-alone" title="No Retry">
        <div className="catalog-frame">
          <FailureNote failure={CATALOG_FAILURE}>The answer could not be sent.</FailureNote>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-lines" title="A tool's error of several lines">
        <div className="catalog-frame">
          <FailureNote failure={UNREPORTED.TOOL}>
            {
              "Command failed with exit code 1.\nerror: pathspec 'main' did not match any file(s) known to git"
            }
          </FailureNote>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-narrow" title="Long words in a narrow column">
        <div className="catalog-narrow">
          <FailureNote failure={CATALOG_FAILURE} onRetry={stay}>
            The list of the workspace’s automations could not be read from the service.
          </FailureNote>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-list" title="In a list's place">
        <div className="catalog-frame">
          <FailureNote failure={CATALOG_FAILURE} look={FAILURE_NOTE_LOOK.LIST} onRetry={stay}>
            The files could not be shown.
          </FailureNote>
          <NoteLine look={NOTE_LINE_LOOK.LIST}>No files match.</NoteLine>
        </div>
      </CatalogSection>
      <CatalogSection id="failure-note-past" title="History, not announced">
        <div className="catalog-frame">
          <FailureNote failure={UNREPORTED.TOOL} time={FAILURE_NOTE_TIME.PAST}>
            Command failed with exit code 1.
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
