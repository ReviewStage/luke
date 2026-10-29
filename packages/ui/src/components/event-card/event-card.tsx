import { type ReactNode, useState } from "react";
import { useUntilFound } from "../../use-until-found.js";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { ShowMoreRow } from "../show-more-row/show-more-row.js";
import { SubjectLine } from "../subject-line/subject-line.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * event-card.tsx -- what another service said, as a transcript draws it: a head naming who did what to which thing, their words, and the notes they left on its lines.
 *
 * A line a service steered into an agent, a pull request's review or a
 * failed check, is drawn as this compact card rather than as the prompt
 * the agent read: one head line in the caption's size (`SubjectLine`), who
 * did it whole and then the thing's chip, which takes the rest of the line,
 * the words they wrote under
 * it, and then each note they left on a line, its place over its words.
 * The card draws the frame and the order; the words, the chip, and each
 * place's link are the caller's, drawn as its own markdown and chips are.
 * The first `EVENT_CARD_NOTES_SHOWN` notes stand, and the rest wait behind
 * the foot every capped list ends in (`ShowMoreRow`), drawn and hidden
 * until found (`use-until-found.ts`), so a find reaches them and opens the
 * card where it lands in one. A card of another frame, a transcript's
 * folding card, draws the same notes as `EventNotes`.
 */

/** How many of a card's notes stand before the rest fold behind its foot. */
const EVENT_CARD_NOTES_SHOWN = 3;

/** One note left on a line: where it is, its words, and a key the caller holds it by. */
export interface EventCardNote {
  readonly key: string;
  /** Where it was left, as a link or words, such as `path:line`. */
  readonly where: ReactNode;
  /** The glyph before its place, such as its file's icon; none for the place alone. */
  readonly glyph?: ReactNode;
  readonly body: ReactNode;
}

/** No notes. */
const NO_NOTES: readonly EventCardNote[] = [];

/** One note: its glyph and its place in the code's font over its words. */
function NoteRow({ note }: { note: EventCardNote }): React.JSX.Element {
  const where = (
    <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} font={TEXT_FONT.MONO} truncate>
      {note.where}
    </Text>
  );
  return (
    <li className="flex min-w-0 flex-col gap-luke-4 border-t border-border pt-luke-8">
      {note.glyph == null ? (
        where
      ) : (
        <div className="flex min-w-0 items-center gap-icon-gap">
          <GlyphSlot>{note.glyph}</GlyphSlot>
          {where}
        </div>
      )}
      <div className="min-w-0">{note.body}</div>
    </li>
  );
}

/**
 * The notes a service left, under what else it said: the first few
 * standing, the rest behind the foot, drawn hidden until found. A rule
 * stands over each note, apart from what was said before it, but for a
 * first note nothing stands before, whose holder's own edge is rule enough.
 */
export function EventNotes({
  notes,
}: {
  notes: readonly EventCardNote[];
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rest = useUntilFound<HTMLUListElement>(!open, () => setOpen(true));
  const more = notes.slice(EVENT_CARD_NOTES_SHOWN);
  if (notes.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-luke-8 first:[&>ul:first-child>li:first-child]:border-t-0 first:[&>ul:first-child>li:first-child]:pt-0">
      <ul className="m-0 flex min-w-0 list-none flex-col gap-luke-8 p-0">
        {notes.slice(0, EVENT_CARD_NOTES_SHOWN).map((note) => (
          <NoteRow key={note.key} note={note} />
        ))}
      </ul>
      {more.length === 0 ? null : (
        <ul ref={rest} className="m-0 flex min-w-0 list-none flex-col gap-luke-8 p-0">
          {more.map((note) => (
            <NoteRow key={note.key} note={note} />
          ))}
        </ul>
      )}
      <ShowMoreRow more={more.length} shown={open} onToggle={() => setOpen(!open)} />
    </div>
  );
}

/** What a service said, framed: its head, its words where it wrote any, and its notes, the first few standing. */
export function EventCard({
  lead,
  subject,
  children,
  notes = NO_NOTES,
  ...attributes
}: {
  /** Who did what, in words kept whole: "@octocat reviewed". */
  lead: ReactNode;
  /** The chip, or link, of the thing they did it to, which takes the rest of the head's line. */
  subject?: ReactNode;
  /** Their words, where they wrote any. */
  children?: ReactNode;
  notes?: readonly EventCardNote[] | undefined;
} & { readonly [data: `data-${string}`]: string | undefined }): React.JSX.Element {
  return (
    <Card
      {...attributes}
      look={CARD_LOOK.RAISED}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.COMPACT}
      className="flex min-w-0 flex-col gap-luke-8"
    >
      <SubjectLine lead={lead}>{subject}</SubjectLine>
      {children == null ? null : <div className="min-w-0">{children}</div>}
      <EventNotes notes={notes} />
    </Card>
  );
}
