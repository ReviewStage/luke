import { type ReactNode, useState } from "react";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { ShowMoreRow } from "../show-more-row/show-more-row.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * event-card.tsx -- what another service said, as a transcript draws it: a head naming who did what to which thing, their words, and the notes they left on its lines.
 *
 * A line a service steered into an agent, a pull request's review or a
 * failed check, is drawn as this compact card rather than as the prompt
 * the agent read: one head line in the caption's size, which the caller
 * fills with who did it and the thing's chip, the words they wrote under
 * it, and then each note they left on a line, its place over its words.
 * The card draws the frame and the order; the words, the chip, and each
 * place's link are the caller's, drawn as its own markdown and chips are.
 * The first `EVENT_CARD_NOTES_SHOWN` notes stand, and the rest wait behind
 * the foot every capped list ends in (`ShowMoreRow`).
 */

/** How many of a card's notes stand before the rest fold behind its foot. */
const EVENT_CARD_NOTES_SHOWN = 3;

/** One note left on a line: where it is, its words, and a key the caller holds it by. */
export interface EventCardNote {
  readonly key: string;
  /** Where it was left, as a link or words, such as `path:line`. */
  readonly where: ReactNode;
  readonly body: ReactNode;
}

/** No notes. */
const NO_NOTES: readonly EventCardNote[] = [];

/** One note: its place in the code's font over its words. */
function NoteRow({ note }: { note: EventCardNote }): React.JSX.Element {
  return (
    <li className="flex min-w-0 flex-col gap-luke-4 border-t border-border pt-luke-8">
      <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} font={TEXT_FONT.MONO} truncate>
        {note.where}
      </Text>
      <div className="min-w-0">{note.body}</div>
    </li>
  );
}

/** What a service said, framed: its head, its words where it wrote any, and its notes, the first few standing. */
export function EventCard({
  head,
  children,
  notes = NO_NOTES,
  ...rest
}: {
  /** Who did what, to which thing, as one line. */
  head: ReactNode;
  /** Their words, where they wrote any. */
  children?: ReactNode;
  notes?: readonly EventCardNote[] | undefined;
} & { readonly [data: `data-${string}`]: string | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const shown = open ? notes : notes.slice(0, EVENT_CARD_NOTES_SHOWN);
  return (
    <Card
      {...rest}
      look={CARD_LOOK.RAISED}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.COMPACT}
      className="flex min-w-0 flex-col gap-luke-8"
    >
      <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {head}
      </Text>
      {children == null ? null : <div className="min-w-0">{children}</div>}
      {notes.length === 0 ? null : (
        <ul className="m-0 flex min-w-0 list-none flex-col gap-luke-8 p-0">
          {shown.map((note) => (
            <NoteRow key={note.key} note={note} />
          ))}
        </ul>
      )}
      <ShowMoreRow
        more={notes.length - EVENT_CARD_NOTES_SHOWN}
        shown={open}
        onToggle={() => setOpen(!open)}
      />
    </Card>
  );
}
