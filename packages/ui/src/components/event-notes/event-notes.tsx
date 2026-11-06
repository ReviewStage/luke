import { type ReactNode, useState } from "react";
import { useUntilFound } from "../../use-until-found.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { ShowMoreRow } from "../show-more-row/show-more-row.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_VARIANT, Text } from "../text/text.js";

const NOTES_SHOWN = 3;

export interface EventNote {
  readonly key: string;
  readonly where: ReactNode;
  readonly glyph?: ReactNode;
  readonly body: ReactNode;
}

function NoteRow({ note }: { note: EventNote }): React.JSX.Element {
  const where = (
    <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} font={TEXT_FONT.MONO} truncate>
      {note.where}
    </Text>
  );
  return (
    <li className="flex min-w-0 flex-col gap-ui-4 border-t border-border pt-ui-8">
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

export function EventNotes({ notes }: { notes: readonly EventNote[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rest = useUntilFound<HTMLUListElement>(!open, () => setOpen(true));
  const more = notes.slice(NOTES_SHOWN);
  if (notes.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-ui-8 first:[&>ul:first-child>li:first-child]:border-t-0 first:[&>ul:first-child>li:first-child]:pt-0">
      <ul className="m-0 flex min-w-0 list-none flex-col gap-ui-8 p-0">
        {notes.slice(0, NOTES_SHOWN).map((note) => (
          <NoteRow key={note.key} note={note} />
        ))}
      </ul>
      {more.length === 0 ? null : (
        <ul ref={rest} className="m-0 flex min-w-0 list-none flex-col gap-ui-8 p-0">
          {more.map((note) => (
            <NoteRow key={note.key} note={note} />
          ))}
        </ul>
      )}
      <ShowMoreRow more={more.length} shown={open} onToggle={() => setOpen(!open)} />
    </div>
  );
}
