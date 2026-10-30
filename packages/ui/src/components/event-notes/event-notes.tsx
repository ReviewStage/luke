import { type ReactNode, useState } from "react";
import { useUntilFound } from "../../use-until-found.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { ShowMoreRow } from "../show-more-row/show-more-row.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * event-notes.tsx -- the notes another service left on the lines of what it is about, as a transcript draws them: each one's place over its words, the first few standing.
 *
 * A pull request's review steered into an agent carries the comments its
 * reviewer left on lines of the change, which the transcript's card for it
 * draws under the reviewer's words: each note's glyph, such as its file's
 * icon, and its place in the code's font, a link the caller draws, over
 * what was said there, a rule apart from what stands before it. The first
 * `NOTES_SHOWN` stand, and the rest wait behind the foot every capped list
 * ends in (`ShowMoreRow`), drawn and hidden until found
 * (`use-until-found.ts`), so a find reaches them and opens them all where
 * it lands in one, rather than a fold inside the card that holds them.
 */

/** How many notes stand before the rest fold behind the foot. */
const NOTES_SHOWN = 3;

/** One note left on a line: where it is, its words, and a key the caller holds it by. */
export interface EventNote {
  readonly key: string;
  /** Where it was left, as a link or words, such as `path:line`. */
  readonly where: ReactNode;
  /** The glyph before its place, such as its file's icon; none for the place alone. */
  readonly glyph?: ReactNode;
  readonly body: ReactNode;
}

/** One note: its glyph and its place in the code's font over its words. */
function NoteRow({ note }: { note: EventNote }): React.JSX.Element {
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
export function EventNotes({ notes }: { notes: readonly EventNote[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rest = useUntilFound<HTMLUListElement>(!open, () => setOpen(true));
  const more = notes.slice(NOTES_SHOWN);
  if (notes.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-luke-8 first:[&>ul:first-child>li:first-child]:border-t-0 first:[&>ul:first-child>li:first-child]:pt-0">
      <ul className="m-0 flex min-w-0 list-none flex-col gap-luke-8 p-0">
        {notes.slice(0, NOTES_SHOWN).map((note) => (
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
