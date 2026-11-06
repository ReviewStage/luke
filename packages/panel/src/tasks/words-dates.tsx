import { type DateSpan, dateLabel } from "@repo/features/date-mention";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@repo/features/mention-link";
import { createContext, type ReactNode, useContext, useRef } from "react";
import type { MarkdownSpan } from "../markdown-message.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerOpening,
  useDatePicker,
} from "./date-picker.js";

interface WrittenDate {
  readonly at: MarkdownSpan;
  readonly date: DateSpan;
  readonly place: MentionPlace;
}

export interface WordsDates {
  readonly pick: (written: WrittenDate, chip: Element) => void;
}

export const WordsDatesContext = createContext<WordsDates | undefined>(undefined);

const WordsDatePickerContext = createContext<((opening: DatePickerOpening) => void) | undefined>(
  undefined,
);

export function useWordsDates(): WordsDates | undefined {
  return useContext(WordsDatesContext);
}

export function useWordsDatePicker(): ((opening: DatePickerOpening) => void) | undefined {
  return useContext(WordsDatePickerContext);
}

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

function linkIn(words: string, at: MarkdownSpan, link: string): MarkdownSpan | undefined {
  if (words.slice(at.from, at.to) === link) return at;
  const from = words.indexOf(link);
  if (from === -1 || words.indexOf(link, from + 1) !== -1) return undefined;
  return { from, to: from + link.length };
}

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
