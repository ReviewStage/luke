import {
  type DateSpan,
  type DateWall,
  type DateWallMoment,
  dateLabel,
  dateOfWall,
  dateOfWords,
  dateToday,
  dateWall,
  readerZone,
} from "@luke/features/date-mention";
import { encodeMention, MENTION_KIND, type MentionPlace } from "@luke/features/mention-link";
import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  Calendar,
  GAP,
  Inline,
  JUSTIFY,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
  PopoverPanel,
  Stack,
  Switch,
  TEXT_ELEMENT,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@luke/ui";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import type { MentionNode } from "../plan-editor/contract.js";
import { useMinute } from "./task-time.js";

/**
 * date-picker.tsx -- a date mention picked or changed in place, as Notion's date picker does: the date as written, a month to pick from, an end date, a time, and Clear, hung from the chip or the `@` word.
 *
 * A date chip in words that take a change (the plan's editor, an agent's
 * box, a comment's) opens this picker when pressed, and the `@` list
 * narrowed to dates opens it from its "Pick a date…" row to write a new
 * one. Top to bottom it holds the date's words, which Enter reads as an `@`
 * word is read (`dateOfWords`, so `next fri 3pm` works); the month the
 * date's start falls in (`@luke/ui`'s `Calendar`); an End date switch, after
 * which the next pick sets the range's end; an Include time switch, which
 * puts a time on each end, read and written in the reader's zone; and Clear.
 *
 * What the developer changes is held here until the picker closes, as
 * Notion applies a change: Escape, Enter in its words, a press outside, or
 * Clear. Its owner then writes it, once, so undo takes the change back
 * whole: a chip is named anew in place, or taken out by Clear; a pick from
 * the list is written as a new chip. A press outside leaves the caret where
 * it landed; any other close hands it back to the words.
 *
 * The picker stands in the room the `@` list stands in, over the editor
 * rather than inside it, so a box that scrolls its words cuts none of it,
 * and the editor reads none of its keys. Nothing of the date rides on an
 * attribute: the recording masks words and not attributes
 * (`mention-chip.tsx`'s header), so every date is said in a text node or a
 * field's value.
 */

/** How the picker closed: a key (Escape, or Enter in its words), focus leaving it, or Clear. */
export const DATE_PICKER_CLOSE = {
  KEY: "key",
  LEAVE: "leave",
  CLEAR: "clear",
} as const;

type DatePickerClose = (typeof DATE_PICKER_CLOSE)[keyof typeof DATE_PICKER_CLOSE];

/** What the picker hands its owner as it closes: the date it holds, whether the developer changed it, and how it closed. */
export interface DatePicked {
  readonly date: DateSpan | undefined;
  readonly changed: boolean;
  readonly how: DatePickerClose;
}

/** Where the picker hangs from: a chip's element, or an `@` word's place in the window. */
type DatePickerAnchor =
  | Element
  | { readonly left: number; readonly top: number; readonly bottom: number };

/** One opening of the picker: where it hangs, the date it opens on, none for a new one, and who hears it close. */
export interface DatePickerOpening {
  readonly at: DatePickerAnchor;
  readonly date: DateSpan | undefined;
  readonly onClose: (picked: DatePicked) => void;
}

/** The picker of one place: what it draws in the place's room while it stands, and what opens it. */
export interface DatePicker {
  readonly popover: ReactNode;
  readonly open: (opening: DatePickerOpening) => void;
}

/** The picker's width: a month's seven days at the window's control height, and the panel's insets. */
const DATE_PICKER_WIDTH = 264;

/** The time each end takes when Include time is switched on. */
const DEFAULT_TIME = { START: "09:00", END: "10:00" } as const;

/** The latest hour an end's time is put an hour after its start's. */
const LAST_HOUR = 23;

const WORDS = {
  TITLE: "Date",
  FIELD: "Date",
  END: "End date",
  TIME: "Include time",
  START_TIME: "Start time",
  END_TIME: "End time",
  CLEAR: "Clear",
} as const;

/** Where the picker's anchor stands in its room, in the room's own pixels. */
interface AnchorBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What the picker holds while it stands: the date's ends, whether the next
 * pick sets the end, the words typed in its field where they are not the
 * date's own, whether those read as no date, and whether anything changed.
 */
interface Draft {
  readonly wall: DateWall;
  readonly pickingEnd: boolean;
  readonly words: string | undefined;
  readonly invalid: boolean;
  readonly changed: boolean;
}

/** The time an hour after `time`, held to the day's last hour. */
function hourAfter(time: string): string {
  const [hour = "0", minute = "00"] = time.split(":");
  return `${String(Math.min(Number(hour) + 1, LAST_HOUR)).padStart(2, "0")}:${minute}`;
}

/** A draft whose ends the developer changed, its words the date's own again. */
function changedTo(wall: DateWall, pickingEnd: boolean): Draft {
  return { wall, pickingEnd, words: undefined, invalid: false, changed: true };
}

/**
 * A day picked: the start of a single day; on a range, its end where the
 * next pick sets the end, an end before the start becoming the start so the
 * range stays in order, and else its start, the end after it next.
 */
function dayPicked(draft: Draft, day: string): Draft {
  const { start, end } = draft.wall;
  if (end === undefined) return changedTo({ start: { ...start, day } }, false);
  if (draft.pickingEnd) {
    const wall =
      day < start.day
        ? { start: { ...start, day }, end: { ...end, day: start.day } }
        : { start, end: { ...end, day } };
    return changedTo(wall, false);
  }
  return changedTo({ start: { ...start, day }, end: day > end.day ? { ...end, day } : end }, true);
}

/** End date switched: on, an end on the start's day, an hour after a time, which the next pick moves; off, the start alone. */
function endSwitched(draft: Draft, on: boolean): Draft {
  const { start } = draft.wall;
  if (!on) return changedTo({ start }, false);
  const end: DateWallMoment = {
    day: start.day,
    time: start.time === undefined ? undefined : hourAfter(start.time),
  };
  return changedTo({ start, end }, true);
}

/** Include time switched: on, a time on each end; off, the days alone. */
function timeSwitched(draft: Draft, on: boolean): Draft {
  const { start, end } = draft.wall;
  const timed = (moment: DateWallMoment, time: string) => ({
    day: moment.day,
    time: on ? time : undefined,
  });
  return changedTo(
    {
      start: timed(start, DEFAULT_TIME.START),
      end: end === undefined ? undefined : timed(end, DEFAULT_TIME.END),
    },
    draft.pickingEnd,
  );
}

/** A mention of `date` as the editor holds one: its words in full in the reader's zone, and its link. */
export function dateMentionNode(date: DateSpan, place: MentionPlace): MentionNode {
  return {
    name: dateLabel(date, readerZone()),
    target: encodeMention({ kind: MENTION_KIND.DATE, ...date }, place),
  };
}

/** A switch with its words beside it. */
function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <Inline justify={JUSTIFY.BETWEEN} wrap={false}>
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
        {label}
      </Text>
      <Switch label={label} checked={checked} onChange={(next) => onChange(next)} />
    </Inline>
  );
}

/** An end's time of day, written in the reader's zone. */
function TimeField({
  label,
  time,
  onChange,
}: {
  label: string;
  time: string | undefined;
  onChange: (time: string) => void;
}): React.JSX.Element {
  return (
    <TextField
      type={TEXT_FIELD_TYPE.TIME}
      label={label}
      value={time ?? ""}
      onChange={(next) => {
        if (next !== "") onChange(next);
      }}
    />
  );
}

/** The picker itself, opened on `date`, or on today for a new one, handing what it holds to `onClose` once. */
function DatePickerPanel({
  date,
  onClose,
}: {
  date: DateSpan | undefined;
  onClose: (picked: DatePicked) => void;
}): React.JSX.Element {
  const now = useMinute();
  const zone = readerZone();
  const today = dateToday(now, zone) ?? new Date(now).toISOString().slice(0, 10);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [draft, setDraft] = useState<Draft>(() => ({
    wall: (date === undefined ? undefined : dateWall(date, zone)) ?? { start: { day: today } },
    pickingEnd: false,
    words: undefined,
    invalid: false,
    changed: false,
  }));
  const [month, setMonth] = useState(() => draft.wall.start.day.slice(0, 7));
  const { start, end } = draft.wall;
  const held = dateOfWall(draft.wall, zone);
  const timed = start.time !== undefined;

  const finish = (how: DatePickerClose, closing: Draft = draft) => {
    if (done.current) return;
    done.current = true;
    onClose({ date: dateOfWall(closing.wall, zone), changed: closing.changed, how });
  };
  const change = (next: Draft) => {
    setDraft(next);
    setMonth(next.wall.start.day.slice(0, 7));
  };
  // Enter closes on the date the words typed name; words that name none are marked and kept.
  const typed = () => {
    if (draft.words === undefined) {
      finish(DATE_PICKER_CLOSE.KEY);
      return;
    }
    const named = dateOfWords(draft.words, Date.now(), zone);
    const wall = named === undefined ? undefined : dateWall(named, zone);
    if (wall === undefined) setDraft({ ...draft, invalid: true });
    else finish(DATE_PICKER_CLOSE.KEY, changedTo(wall, false));
  };

  return (
    <PopoverPanel
      title={WORDS.TITLE}
      look={POPOVER_PANEL_LOOK.MENU}
      initialFocus={field}
      onDismiss={() => finish(DATE_PICKER_CLOSE.KEY)}
      onLeave={() => finish(DATE_PICKER_CLOSE.LEAVE)}
    >
      <div className="date-picker">
        <Stack gap={GAP.CONTROL}>
          <TextField
            ref={field}
            label={WORDS.FIELD}
            value={draft.words ?? (held === undefined ? "" : dateLabel(held, zone))}
            invalid={draft.invalid}
            spellCheck={false}
            onChange={(words) => setDraft({ ...draft, words, invalid: false })}
            onEnter={typed}
          />
          <Calendar
            month={month}
            today={today}
            start={start.day}
            end={end?.day}
            onPick={(day) => change(dayPicked(draft, day))}
            onShowMonth={setMonth}
          />
          <SwitchRow
            label={WORDS.END}
            checked={end !== undefined}
            onChange={(on) => change(endSwitched(draft, on))}
          />
          <SwitchRow
            label={WORDS.TIME}
            checked={timed}
            onChange={(on) => change(timeSwitched(draft, on))}
          />
          {timed ? (
            <Stack gap={GAP.TIGHT}>
              <Inline gap={GAP.CONTROL} wrap={false}>
                <TimeField
                  label={WORDS.START_TIME}
                  time={start.time}
                  onChange={(time) =>
                    change(changedTo({ start: { ...start, time }, end }, draft.pickingEnd))
                  }
                />
                {end === undefined ? null : (
                  <TimeField
                    label={WORDS.END_TIME}
                    time={end.time}
                    onChange={(time) =>
                      change(changedTo({ start, end: { ...end, time } }, draft.pickingEnd))
                    }
                  />
                )}
              </Inline>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {zone}
              </Text>
            </Stack>
          ) : null}
          <Inline>
            <Button variant={BUTTON_VARIANT.QUIET} onClick={() => finish(DATE_PICKER_CLOSE.CLEAR)}>
              {WORDS.CLEAR}
            </Button>
          </Inline>
        </Stack>
      </div>
    </PopoverPanel>
  );
}

/** Where `at` stands in `room`, in the room's own pixels. */
function boxIn(room: DOMRect, at: DatePickerAnchor): AnchorBox {
  const box =
    at instanceof Element ? at.getBoundingClientRect() : { ...at, right: at.left, height: 0 };
  return {
    left: box.left - room.left,
    top: box.top - room.top,
    width: box.right - box.left,
    height: box.bottom - box.top,
  };
}

/**
 * The date picker of a place whose words stand in `room`: one opening at a
 * time, hung from where it was opened, a new opening taking the place of
 * the last.
 */
export function useDatePicker(room: RefObject<HTMLElement | null>): DatePicker {
  const [opened, setOpened] = useState<
    | { readonly opening: DatePickerOpening; readonly box: AnchorBox; readonly key: number }
    | undefined
  >(undefined);
  const counted = useRef(0);
  const open = (opening: DatePickerOpening) => {
    const placed = room.current?.getBoundingClientRect();
    if (placed === undefined) return;
    counted.current += 1;
    setOpened({ opening, box: boxIn(placed, opening.at), key: counted.current });
  };
  const popover =
    opened === undefined ? null : (
      <div className="date-picker-anchor" style={opened.box}>
        <AnchoredPopover align={POPOVER_ALIGN.START} width={DATE_PICKER_WIDTH}>
          <DatePickerPanel
            key={opened.key}
            date={opened.opening.date}
            onClose={(picked) => {
              setOpened(undefined);
              opened.opening.onClose(picked);
            }}
          />
        </AnchoredPopover>
      </div>
    );
  return { popover, open };
}
