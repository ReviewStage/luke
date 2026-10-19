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
  POPOVER_ALIGN,
  SETTINGS_ROW_DENSITY,
  Stack,
  TEXT_FIELD_TYPE,
  TextField,
} from "@luke/ui";
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { MentionNode } from "../plan-editor/contract.js";
import { PopoverPanel } from "../popover-panel.js";
import { SwitchRow } from "../settings/switch-row.js";
import { useMinute } from "./task-time.js";

/**
 * date-picker.tsx -- a date mention picked or changed in place, as Notion's date picker does: the date as written, a month to pick from, an end date, a time, and Clear, hung from the chip or the `@` word.
 *
 * A date chip in words that take a change (the plan's editor, an agent's
 * box, a comment's) opens this picker when pressed, and the `@` list
 * narrowed to dates opens it from its "Pick a date…" row to write a new
 * one. It is drawn as the window's other popovers with settings in them
 * are (`view-settings.tsx`): a card under its title and ×, its switches the
 * Settings rows' own (`../settings/switch-row.tsx`) at their compact
 * density, and its one action, Clear, a quiet button at its ruled foot, as
 * the MCP servers popover's Settings stands (`agent-servers.tsx`). Top
 * to bottom it holds a field for each end's date, as Notion's does, each
 * read as an `@` word is read (`dateOfWords`, so `next fri 3pm` works) as
 * Enter or leaving the field takes it, and beside each, while Include
 * time is on, the end's time in the reader's zone, which the switch's row
 * names; the month the date's start falls in (`@luke/ui`'s `Calendar`); End
 * date, after which the next pick sets the range's end; Include time; and
 * Clear.
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

/** The day's last hour, after which an end an hour on falls on the next day. */
const LAST_HOUR = 23;

const WORDS = {
  TITLE: "Date",
  /** The date fields', named apart from the End date switch. */
  START_DATE: "Start",
  END_DATE: "End",
  END: "End date",
  TIME: "Include time",
  START_TIME: "Start time",
  END_TIME: "End time",
  CLEAR: "Clear",
  CLOSE: "Close",
} as const;

/** Where the picker's anchor stands in its room, in the room's own pixels. */
interface AnchorBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Which end of the date a field writes. */
const DATE_END = {
  START: "start",
  END: "end",
} as const;

type DateEnd = (typeof DATE_END)[keyof typeof DATE_END];

/** Words typed into one end's date field and not yet read, and whether they were read as no date. */
interface Typing {
  readonly end: DateEnd;
  readonly words: string;
  readonly invalid: boolean;
}

/**
 * What the picker holds while it stands: the date's ends, whether the next
 * pick sets the end, words typed into a date field and not yet read, and
 * whether anything changed.
 */
interface Draft {
  readonly wall: DateWall;
  readonly pickingEnd: boolean;
  readonly typing: Typing | undefined;
  readonly changed: boolean;
}

/** The last day a date mention spells, whose year is the last of four digits. */
const LAST_DAY = "9999-12-31";

/** The day after `day`, both `YYYY-MM-DD`; nothing after the last day a mention spells. */
function dayAfter(day: string): string | undefined {
  if (day >= LAST_DAY) return undefined;
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The end End date puts after `start`, always after it, so what the picker
 * shows is the range it writes: a day's the next day, and a time's an hour
 * later, past midnight onto the next day where it must be; nothing where no
 * day follows.
 */
function endAfter(start: DateWallMoment): DateWallMoment | undefined {
  if (start.time === undefined) {
    const day = dayAfter(start.day);
    return day === undefined ? undefined : { day };
  }
  const [hour = "0", minute = "00"] = start.time.split(":");
  const next = Number(hour) + 1;
  if (next <= LAST_HOUR)
    return { day: start.day, time: `${String(next).padStart(2, "0")}:${minute}` };
  const day = dayAfter(start.day);
  return day === undefined ? undefined : { day, time: `00:${minute}` };
}

/** A draft whose ends the developer changed, its fields the date's own words again. */
function changedTo(wall: DateWall, pickingEnd: boolean): Draft {
  return { wall, pickingEnd, typing: undefined, changed: true };
}

/** A moment as it orders against another: its day, then its time. */
function orderOf(moment: DateWallMoment): string {
  return `${moment.day}T${moment.time ?? ""}`;
}

/**
 * A day picked: the start of a single day; on a range, its end where the
 * next pick sets the end, an end before the start becoming the start so the
 * range stays in order, and one on a day-only start's own day leaving the
 * start alone, since it names no range; and else its start, the end after
 * it next, the end moved on where the start passed it.
 */
function dayPicked(draft: Draft, day: string): Draft {
  const { start, end } = draft.wall;
  if (end === undefined) return changedTo({ start: { ...start, day } }, false);
  if (draft.pickingEnd) {
    if (day < start.day) {
      return changedTo({ start: { ...start, day }, end: { ...end, day: start.day } }, false);
    }
    const picked = { ...end, day };
    // Note that an end at the start's own moment names no range, and one earlier on its day swaps with it.
    if (orderOf(picked) === orderOf(start)) return changedTo({ start }, false);
    const wall =
      orderOf(picked) < orderOf(start) ? { start: picked, end: start } : { start, end: picked };
    return changedTo(wall, false);
  }
  const moved = { ...start, day };
  const kept = { ...end, day: day > end.day ? day : end.day };
  const after = orderOf(moved) < orderOf(kept) ? kept : endAfter(moved);
  return changedTo({ start: moved, end: after }, after !== undefined);
}

/**
 * Ends kept in order after one was typed: an end before its start swaps
 * with it, and one at its start's own moment moves on just after it.
 */
function ordered(wall: DateWall): DateWall {
  const { start, end } = wall;
  if (end === undefined || orderOf(start) < orderOf(end)) return wall;
  if (orderOf(end) < orderOf(start)) return { start: end, end: start };
  return { start, end: endAfter(start) };
}

/**
 * A moment typed into one end's date field: its day, and its time where
 * the words named one or Include time is on, the end's own time kept where
 * they named none. Note that words naming a time switch Include time on,
 * the other end taking its default time, as the switch gives it.
 */
function typedInto(draft: Draft, which: DateEnd, moment: DateWallMoment): Draft {
  const { start, end } = draft.wall;
  const timed = start.time !== undefined || moment.time !== undefined;
  const timeOf = (was: DateWallMoment, fallback: string) =>
    timed ? (was.time ?? fallback) : undefined;
  const typed = (was: DateWallMoment, fallback: string) => ({
    day: moment.day,
    time: moment.time ?? timeOf(was, fallback),
  });
  const kept = (was: DateWallMoment, fallback: string) => ({
    day: was.day,
    time: timeOf(was, fallback),
  });
  const wall =
    which === DATE_END.START
      ? { start: typed(start, DEFAULT_TIME.START), end: end && kept(end, DEFAULT_TIME.END) }
      : { start: kept(start, DEFAULT_TIME.START), end: end && typed(end, DEFAULT_TIME.END) };
  return changedTo(ordered(wall), false);
}

/**
 * The draft with its typed words read as `dateOfWords` reads an `@` word,
 * and the day they named, whose month the calendar then shows: words
 * naming a range set both ends, and words naming one moment set the end
 * typed into; nothing where they name no date.
 */
function wordsRead(
  draft: Draft,
  now: number,
  zone: string,
): { readonly draft: Draft; readonly day: string } | undefined {
  const { typing } = draft;
  if (typing === undefined) return { draft, day: draft.wall.start.day };
  const named = dateOfWords(typing.words, now, zone);
  const wall = named === undefined ? undefined : dateWall(named, zone);
  if (wall === undefined) return undefined;
  if (wall.end !== undefined) return { draft: changedTo(wall, false), day: wall.start.day };
  return { draft: typedInto(draft, typing.end, wall.start), day: wall.start.day };
}

/** End date switched: on, an end just after the start (`endAfter`), which the next pick moves; off, the start alone. */
function endSwitched(draft: Draft, on: boolean): Draft {
  const { start } = draft.wall;
  if (!on) return changedTo({ start }, false);
  // Note that the last day a mention spells has no day after it, so its switch stays off.
  const end = endAfter(start);
  return end === undefined ? draft : changedTo({ start, end }, true);
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

/** An end's day as its field says it: in full, as a date mention writes it. */
function dayWords(moment: DateWallMoment): string {
  return dateLabel({ start: moment.day });
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

/**
 * The picker itself, opened on `date`, or on today for a new one, handing
 * what it holds to `onClose` once. Its fields stand as Notion's: each end's
 * date, and beside it, while Include time is on, its time, the end's row
 * under the start's; with no time the two dates share a row.
 */
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
    typing: undefined,
    changed: false,
  }));
  // Note that the draft is kept beside its state too, because a field's blur reads its words just before a press outside closes the picker, in the same event.
  const latest = useRef(draft);
  const [month, setMonth] = useState(() => draft.wall.start.day.slice(0, 7));
  const { start, end } = draft.wall;
  const timed = start.time !== undefined;

  const update = (next: Draft) => {
    latest.current = next;
    setDraft(next);
  };
  const finish = (how: DatePickerClose) => {
    if (done.current) return;
    done.current = true;
    const closing = wordsRead(latest.current, Date.now(), zone)?.draft ?? latest.current;
    onClose({ date: dateOfWall(closing.wall, zone), changed: closing.changed, how });
  };
  // Typed words are read as the field is left, the month shown moving to the end they set; words that name no date are marked and kept.
  const read = (): boolean => {
    const typing = latest.current.typing;
    if (typing === undefined) return true;
    const next = wordsRead(latest.current, Date.now(), zone);
    if (next === undefined) {
      update({ ...latest.current, typing: { ...typing, invalid: true } });
      return false;
    }
    update(next.draft);
    setMonth(next.day.slice(0, 7));
    return true;
  };
  const dateField = (which: DateEnd, moment: DateWallMoment) => {
    const typing = draft.typing?.end === which ? draft.typing : undefined;
    return (
      <TextField
        ref={which === DATE_END.START ? field : undefined}
        label={which === DATE_END.START ? WORDS.START_DATE : WORDS.END_DATE}
        value={typing?.words ?? dayWords(moment)}
        invalid={typing?.invalid === true}
        spellCheck={false}
        onChange={(words) =>
          update({ ...latest.current, typing: { end: which, words, invalid: false } })
        }
        onBlur={() => {
          read();
        }}
        onEnter={() => {
          if (read()) finish(DATE_PICKER_CLOSE.KEY);
        }}
      />
    );
  };
  const timeField = (which: DateEnd, moment: DateWallMoment) => (
    <TimeField
      label={which === DATE_END.START ? WORDS.START_TIME : WORDS.END_TIME}
      time={moment.time}
      onChange={(time) => {
        const wall =
          which === DATE_END.START
            ? { start: { ...start, time }, end }
            : { start, end: end && { ...end, time } };
        update(changedTo(wall, draft.pickingEnd));
      }}
    />
  );

  return (
    <PopoverPanel
      title={WORDS.TITLE}
      closeLabel={WORDS.CLOSE}
      initialFocus={field}
      onDismiss={() => finish(DATE_PICKER_CLOSE.KEY)}
      onLeave={() => finish(DATE_PICKER_CLOSE.LEAVE)}
    >
      <Stack gap={GAP.TIGHT}>
        {timed ? (
          <>
            <Inline gap={GAP.CONTROL} wrap={false}>
              {dateField(DATE_END.START, start)}
              {timeField(DATE_END.START, start)}
            </Inline>
            {end === undefined ? null : (
              <Inline gap={GAP.CONTROL} wrap={false}>
                {dateField(DATE_END.END, end)}
                {timeField(DATE_END.END, end)}
              </Inline>
            )}
          </>
        ) : (
          <Inline gap={GAP.CONTROL} wrap={false}>
            {dateField(DATE_END.START, start)}
            {end === undefined ? null : dateField(DATE_END.END, end)}
          </Inline>
        )}
      </Stack>
      <Calendar
        month={month}
        today={today}
        start={start.day}
        end={end?.day}
        onPick={(day) => {
          update(dayPicked(latest.current, day));
          setMonth(day.slice(0, 7));
        }}
        onShowMonth={setMonth}
      />
      <Stack gap={GAP.TIGHT}>
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label={WORDS.END}
          checked={end !== undefined}
          onChange={(on) => update(endSwitched(latest.current, on))}
        />
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label={WORDS.TIME}
          detail={timed ? zone : undefined}
          checked={timed}
          onChange={(on) => update(timeSwitched(latest.current, on))}
        />
      </Stack>
      <div className="task-compose-menu-foot">
        <Button variant={BUTTON_VARIANT.QUIET} onClick={() => finish(DATE_PICKER_CLOSE.CLEAR)}>
          {WORDS.CLEAR}
        </Button>
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

/** Whether two anchor boxes stand in the same place. */
function sameBox(a: AnchorBox, b: AnchorBox): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
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
  // A chip's place is read again as anything scrolls or the window resizes, so the picker stays hung from it as a box scrolls its words.
  const at = opened?.opening.at;
  useLayoutEffect(() => {
    if (!(at instanceof Element)) return;
    const follow = () => {
      const placed = room.current?.getBoundingClientRect();
      if (placed === undefined || !at.isConnected) return;
      const box = boxIn(placed, at);
      setOpened((was) => (was === undefined || sameBox(was.box, box) ? was : { ...was, box }));
    };
    document.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [at, room]);
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
