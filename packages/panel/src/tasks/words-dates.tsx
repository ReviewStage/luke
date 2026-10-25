import { type DateSpan, dateLabel } from "@luke/features/date-mention";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import { createContext, type ReactNode, useContext, useRef } from "react";
import type { MarkdownSpan } from "../markdown-message.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerOpening,
  useDatePicker,
} from "./date-picker.js";

/**
 * words-dates.tsx -- a date chip in drawn words that take a change opens its picker where it stands, with no editor open, and the words are written anew with the date picked.
 *
 * A date's chip in an editor opens its picker and names its node anew
 * (`mention-chip.tsx`'s `MentionNodeChip`). Words drawn rather than edited,
 * the plan's sections at rest or the reader's own comment, take a change
 * too, so a date chip drawn in them opens the same picker
 * (`date-picker.tsx`) without the editor: the place drawing the words hands
 * its chips a door (`WordsDatesContext`), and the chip names where its link
 * is written in the words (`LinkDrawer`'s `at`). As the picker closes, a
 * date changed is written over the link in place, Clear takes the link out,
 * and the place saves the words through its own door, the plan's or the
 * comment's edit. Words that take no change hand no door, and their date
 * chips open nothing, as before.
 *
 * The picker hangs in a room laid over the words (`WordsDatePickerRoom`), as
 * the editor's hangs in its own, so a column that scrolls the words cuts
 * none of it.
 */

/** A date chip's link as drawn: where it is written in the words, the date it names, and where its mentions are written. */
interface WrittenDate {
  readonly at: MarkdownSpan;
  readonly date: DateSpan;
  readonly place: MentionPlace;
}

/** What a date chip drawn in words that take a change does when pressed: opens its picker hung from the chip. */
export interface WordsDates {
  readonly pick: (written: WrittenDate, chip: Element) => void;
}

/** The door the date chips of the words drawn inside it open their picker through; none where the words take no change. */
export const WordsDatesContext = createContext<WordsDates | undefined>(undefined);

/** Opens the picker of the room the words stand in; none outside one. */
const WordsDatePickerContext = createContext<((opening: DatePickerOpening) => void) | undefined>(
  undefined,
);

/** What the date chips of the words drawn here open through, where the place hands a door. */
export function useWordsDates(): WordsDates | undefined {
  return useContext(WordsDatesContext);
}

/** The opener of the date picker of the room around, which a place builds its words' door on (`wordsDatesDoor`); none outside a room. */
export function useWordsDatePicker(): ((opening: DatePickerOpening) => void) | undefined {
  return useContext(WordsDatePickerContext);
}

/**
 * A room laid over the words drawn in `children`, the date picker their
 * chips open hanging in it, and the opener of that picker handed to them
 * (`useWordsDatePicker`). Its box is the room's own, so whatever it stands
 * in, a plan's body or the Comments tab, the picker is placed from it.
 */
export function WordsDatePickerRoom({ children }: { children: ReactNode }): React.JSX.Element {
  const room = useRef<HTMLDivElement>(null);
  const picker = useDatePicker(room);
  return (
    <WordsDatePickerContext.Provider value={picker.open}>
      {children}
      <div ref={room} className="pointer-events-none absolute inset-0 m-0 *:pointer-events-auto">
        {picker.popover}
      </div>
    </WordsDatePickerContext.Provider>
  );
}

/** Where `link` stands in `words`: at `at` where it still does, else its one place, else nowhere, as words written anew since or twice over leave it. */
function linkIn(words: string, at: MarkdownSpan, link: string): MarkdownSpan | undefined {
  if (words.slice(at.from, at.to) === link) return at;
  const from = words.indexOf(link);
  if (from === -1 || words.indexOf(link, from + 1) !== -1) return undefined;
  return { from, to: from + link.length };
}

/**
 * The words with the date link `link`, written at `written.at` when the
 * picker opened, named anew as the date picked, or taken out by Clear;
 * nothing where the picker changed nothing, or the words no longer hold the
 * link to change.
 */
function wordsWithDate(
  words: string,
  written: WrittenDate,
  link: string,
  picked: DatePicked,
): string | undefined {
  const { date } = picked;
  const cleared = picked.how === DATE_PICKER_CLOSE.CLEAR;
  const moved =
    picked.changed &&
    date !== undefined &&
    (date.start !== written.date.start || date.end !== written.date.end || picked.zonePicked);
  if (!cleared && !moved) return undefined;
  const at = link === "" ? undefined : linkIn(words, written.at, link);
  if (at === undefined) return undefined;
  const named =
    cleared || date === undefined
      ? ""
      : mentionMarkdown(
          { kind: MENTION_KIND.DATE, ...date },
          dateLabel(date, picked.zone),
          written.place,
        );
  return `${words.slice(0, at.from)}${named}${words.slice(at.to)}`;
}

/**
 * The door of words that take a change: a date chip pressed opens `open`'s
 * picker hung from it, on its date, and as the picker closes, the words as
 * they then stand (`words`) are handed to `write` with the date changed or
 * cleared, beside the words they were made from. A key closing it hands the
 * keyboard back to the chip, as an editor hands it back after the chip.
 */
export function wordsDatesDoor(
  open: (opening: DatePickerOpening) => void,
  words: () => string | undefined,
  write: (next: string, base: string) => void,
): WordsDates {
  return {
    pick: (written, chip) => {
      const link = words()?.slice(written.at.from, written.at.to) ?? "";
      open({
        at: chip,
        date: written.date,
        onClose: (picked) => {
          if (picked.how === DATE_PICKER_CLOSE.KEY && chip instanceof HTMLElement) chip.focus();
          const base = words();
          const next = base === undefined ? undefined : wordsWithDate(base, written, link, picked);
          if (base !== undefined && next !== undefined) write(next, base);
        },
      });
    },
  };
}
