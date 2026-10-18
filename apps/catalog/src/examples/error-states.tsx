/**
 * error-states.tsx -- a failed read among rows with Retry beside it, one
 * alone in its region with Retry under it, one with no Retry, ones with a
 * remedy, Remove, or Dismiss beside Retry, one on a toolbar short of
 * room, long words and a long remedy in a pane narrower than the line,
 * and a list's foot that is itself the retry.
 */

import { ERROR_STATE_PLACEMENT, ErrorState, RetryRowLabel } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A press the catalog has nowhere to take. */
function stay(): void {}

function ErrorStates(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="error-state-inline" title="Among rows">
        <div className="catalog-frame">
          <ErrorState onRetry={stay}>Your tasks could not be read.</ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-centred" title="Alone in its region">
        <div className="catalog-frame catalog-region catalog-error-region">
          <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={stay}>
            The changes could not be read.
          </ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-alone" title="No Retry">
        <div className="catalog-frame">
          <ErrorState>This file is too large to show.</ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-remedy" title="A remedy beside Retry">
        <div className="catalog-frame">
          <ErrorState remedy={{ label: "Connect GitHub", onClick: stay }} onRetry={stay}>
            This workspace has no GitHub connected.
          </ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-remove" title="Retry and Remove">
        <div className="catalog-frame">
          <ErrorState onRetry={stay} onRemove={stay}>
            The picture could not be uploaded.
          </ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-dismiss" title="A remedy and Dismiss">
        <div className="catalog-frame">
          <ErrorState remedy={{ label: "Sign in with GitHub", onClick: stay }} onDismiss={stay}>
            GitHub needs you to sign in again before it takes this change.
          </ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-toolbar" title="On a toolbar, short of room">
        <div className="catalog-frame catalog-error-toolbar">
          <ErrorState
            placement={ERROR_STATE_PLACEMENT.TOOLBAR}
            remedy={{ label: "Connect GitHub", onClick: stay }}
            onRetry={stay}
          >
            Luke on GitHub doesn't have access to acme/a-very-long-repository-name.
          </ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-long-remedy" title="Narrow pane, long remedy">
        <div className="catalog-frame catalog-error-narrow">
          <ErrorState
            remedy={{
              label: "Add acme/a-very-long-repository-name to Luke on GitHub",
              onClick: stay,
            }}
            onRetry={stay}
          >
            Luke on GitHub doesn't have access to this repository.
          </ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-narrow" title="Narrow pane, long words">
        <div className="catalog-frame catalog-error-narrow">
          <ErrorState onRetry={stay}>
            The questions your agents asked while you were away could not be read.
          </ErrorState>
        </div>
      </CatalogSection>
      <CatalogSection id="error-state-row" title="A row that is itself the retry">
        <div className="catalog-frame catalog-error-narrow">
          <button type="button" className="catalog-retry-row" onClick={stay}>
            <RetryRowLabel failure="Could not read older versions." />
          </button>
        </div>
      </CatalogSection>
    </>
  );
}

export const ERROR_STATES_EXAMPLE: Example = {
  id: "error-states",
  title: "Error states",
  Render: ErrorStates,
};
