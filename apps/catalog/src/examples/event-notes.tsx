import { EventNotes, TEXT_LINK_LOOK, TextLink } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * event-notes.tsx -- the comments a review left on a pull request's lines,
 * as a transcript's card draws them under the reviewer's words: five, each
 * its place over its words, the last two folded behind the foot; and two,
 * each led by its file's glyph, with nothing before them.
 */

const PULL_REQUEST = "https://github.com/acme/relay/pull/42";

const COMMENTS = [
  ["apps/web/store.ts", 12, "Guard the empty list here."],
  ["apps/web/store.ts", 48, "This read runs twice."],
  ["packages/ui/src/list.tsx", 3, "Name the cap."],
  ["packages/ui/src/list.tsx", 90, "A test for the fold?"],
  ["README.md", 7, "Typo: recieve."],
] as const;

/** A link in a note's place, opening nothing in the catalog. */
function Link({ children }: { children: string }): React.JSX.Element {
  return (
    <TextLink href={PULL_REQUEST} look={TEXT_LINK_LOOK.UNDERLINED}>
      {children}
    </TextLink>
  );
}

function EventNotesExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="event-notes-review" title="A review's inline comments, past three folded">
        <div className="catalog-column">
          <p>Close, but the store reads the list twice on every open.</p>
          <EventNotes
            notes={COMMENTS.map(([path, line, body]) => ({
              key: `${path}:${line}`,
              where: <Link>{`${path}:${line}`}</Link>,
              body,
            }))}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="event-notes-glyph" title="Led by their file's glyph, nothing before them">
        <div className="catalog-column">
          <EventNotes
            notes={COMMENTS.slice(0, 2).map(([path, line, body]) => ({
              key: `${path}:${line}`,
              glyph: <GLYPH.FILE />,
              where: <Link>{path}</Link>,
              body,
            }))}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const EVENT_NOTES_EXAMPLE: Example = {
  id: "event-notes",
  title: "Event notes",
  Render: EventNotesExample,
};
