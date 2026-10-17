import { EmptyState, SearchIcon, UserIcon } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * empty-states.tsx -- an empty place with a heading and its way on, one
 * with its line alone, and long words in a pane narrower than the state's
 * measure, each in a room it fills.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

function EmptyStates(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="empty-state-full" title="Heading, line, and a way on">
        <div className="catalog-frame catalog-empty-room">
          <EmptyState
            icon={<SearchIcon />}
            title="Not found"
            action={{ label: "Back to Inbox", onClick: stay }}
          >
            This Inbox item doesn't exist, or you don't have access to it.
          </EmptyState>
        </div>
      </CatalogSection>
      <CatalogSection id="empty-state-line" title="A line alone">
        <div className="catalog-frame catalog-empty-room">
          <EmptyState icon={<UserIcon />}>No agents at work</EmptyState>
        </div>
      </CatalogSection>
      <CatalogSection id="empty-state-narrow" title="Narrow pane, long words">
        <div className="catalog-frame catalog-empty-room catalog-empty-room-narrow">
          <EmptyState
            icon={<SearchIcon />}
            title="Nothing needs you"
            action={{ label: "Show all items in the Inbox", onClick: stay }}
          >
            Every question an agent asked has been answered, and every review requested is done.
          </EmptyState>
        </div>
      </CatalogSection>
    </>
  );
}

export const EMPTY_STATES_EXAMPLE: Example = {
  id: "empty-states",
  title: "Empty states",
  Render: EmptyStates,
};
