import { EventCard, TEXT_LINK_LOOK, TextLink } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * event-cards.tsx -- what GitHub said on a pull request, as a transcript
 * draws it: a review with its words and five inline comments, the last two
 * folded behind the foot, and a failed check, a head alone.
 */

const PULL_REQUEST = "https://github.com/acme/relay/pull/42";

const COMMENTS = [
  ["apps/web/store.ts", 12, "Guard the empty list here."],
  ["apps/web/store.ts", 48, "This read runs twice."],
  ["packages/ui/src/list.tsx", 3, "Name the cap."],
  ["packages/ui/src/list.tsx", 90, "A test for the fold?"],
  ["README.md", 7, "Typo: recieve."],
] as const;

/** A link in the card, opening nothing in the catalog. */
function Link({ children }: { children: string }): React.JSX.Element {
  return (
    <TextLink href={PULL_REQUEST} look={TEXT_LINK_LOOK.UNDERLINED}>
      {children}
    </TextLink>
  );
}

function EventCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="event-card-review" title="A review with inline comments">
        <div className="catalog-column">
          <EventCard
            lead="@octocat requested changes on"
            subject={<Link>#42</Link>}
            notes={COMMENTS.map(([path, line, body]) => ({
              key: `${path}:${line}`,
              where: <Link>{`${path}:${line}`}</Link>,
              body,
            }))}
          >
            Close, but the store reads the list twice on every open.
          </EventCard>
        </div>
      </CatalogSection>
      <CatalogSection id="event-card-check" title="A failed check, its head alone">
        <div className="catalog-column">
          <EventCard
            lead={
              <>
                A check failed on <code>3f2a9c1</code> ·
              </>
            }
            subject={<Link>Checks</Link>}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const EVENT_CARDS_EXAMPLE: Example = {
  id: "event-cards",
  title: "Event cards",
  Render: EventCards,
};
