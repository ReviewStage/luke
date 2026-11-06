import { dateChipText, readerZone } from "@repo/features/date-mention";
import type { InboxItem } from "@repo/features/inbox-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { dropBelowStart, STATUS_TONE, useMenu } from "@repo/ui";
import { GLYPH, InboxIcon } from "@repo/ui/icons";
import { type RefObject, useCallback } from "react";
import { useAppCommand } from "../app-commands.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerMoment,
  useDatePicker,
} from "./date-picker.js";
import { hasReminder } from "./inbox-model.js";

/**
 * inbox-remind.tsx -- setting a reminder on an Inbox item: the times its menus offer, the menu H opens on the chosen row, and the date picker for a time of the reader's own.
 *
 * A reminder takes an item out of the reader's Inbox until a time they pick:
 * in an hour, tomorrow at 9 AM, next Monday at 9 AM, or a day and time
 * picked in the date picker a date mention opens (`date-picker.tsx`), asked
 * there for one moment, opening on tomorrow at 9 AM, which only its Remind
 * me confirms. The item's row offers them in a
 * Remind me submenu, and H opens them on the chosen row; an item with a
 * reminder already offers Clear reminder at the submenu's foot, as Mail's
 * Remind Me does, the row saying when it comes due rather than the menu.
 * Several items chosen together are offered the same times, set on every
 * one, and Clear reminders where any holds one, answered by one toast whose
 * Undo puts each back as it stood. What a reminder does to the item, and
 * how it comes back, is `inbox-model.ts`'s `inboxAtNow`.
 */

/** The hour tomorrow, next week, and the picker's opening day come due at, in the reader's own zone. */
const MORNING_HOUR = 9;

const HOUR_MS = 60 * 60 * 1000;

const WORDS = {
  REMIND_ME: "Remind me",
  IN_AN_HOUR: "In 1 hour",
  TOMORROW: "Tomorrow",
  NEXT_WEEK: "Next week",
  PICK: "Pick a date and time…",
  CLEAR: "Clear reminder",
  CLEAR_ALL: "Clear reminders",
  CLEARED: "Reminders cleared",
  PAST: "Pick a time after now to be reminded",
} as const;

/** What the act that sets a reminder is called, wherever it stands. */
export const REMIND_ME = WORDS.REMIND_ME;

/** The picker asked for one moment: titled as the menu is, confirmed by Remind me. */
const REMIND_MOMENT: DatePickerMoment = { title: WORDS.REMIND_ME, verb: WORDS.REMIND_ME };

/** One time a Remind me menu offers: its words, and when it comes due, counted from the moment it is chosen. */
interface RemindTime {
  readonly label: string;
  readonly at: (now: number) => number;
}

/** `now`'s day in the reader's own zone, `days` on, at `hour` sharp. */
function dayAt(now: number, days: number, hour: number): number {
  const day = new Date(now);
  day.setDate(day.getDate() + days);
  day.setHours(hour, 0, 0, 0);
  return day.getTime();
}

/** The times every Remind me menu offers, in its order: an hour on, tomorrow morning, and next Monday morning. */
const REMIND_TIMES: readonly RemindTime[] = [
  { label: WORDS.IN_AN_HOUR, at: (now) => now + HOUR_MS },
  { label: WORDS.TOMORROW, at: (now) => dayAt(now, 1, MORNING_HOUR) },
  {
    label: WORDS.NEXT_WEEK,
    // Note that a Monday's next week is the Monday after, never the day itself.
    at: (now) => dayAt(now, (8 - new Date(now).getDay()) % 7 || 7, MORNING_HOUR),
  },
];

/** An instant as a date mention spells a time, at UTC, so its chip's words say it in the reader's zone. */
function momentOf(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16)}+00:00`;
}

/** When a reminder comes due, in the words a date mention's chip uses from `now`: Today 11:24 AM, Tomorrow 9:00 AM, Monday 9:00 AM. */
export function remindWords(at: number, now: number): string {
  return dateChipText({ start: momentOf(at) }, now, readerZone());
}

/** What a pick names: nothing, where the picker closed without its Remind me or holds no date; a time not ahead of now; or the instant to be reminded at. */
const PICKED = { NONE: "none", PAST: "past", AT: "at" } as const;

type Picked =
  | { readonly kind: typeof PICKED.NONE | typeof PICKED.PAST }
  | { readonly kind: typeof PICKED.AT; readonly at: number };

/** What a pick names at `now`. Note that a picker closed any way but its Remind me names nothing, since only the act confirms a time. */
function pickedInstant(picked: DatePicked, now: number): Picked {
  if (picked.how !== DATE_PICKER_CLOSE.CONFIRM || picked.date === undefined) {
    return { kind: PICKED.NONE };
  }
  const at = Date.parse(picked.date.start);
  if (Number.isNaN(at)) return { kind: PICKED.NONE };
  return at <= now ? { kind: PICKED.PAST } : { kind: PICKED.AT, at };
}

/** How a reminder set says so: by its own toast, or quietly where its caller answers several at once. */
export interface RemindSaying {
  readonly quiet: boolean;
}

/** A reminder set among several, which their caller answers with one toast. */
const QUIET: RemindSaying = { quiet: true };

/** How an item's reminder is set: for an instant, or cleared where it is null. */
export type InboxReminder = (item: InboxItem, until: number | null, saying?: RemindSaying) => void;

/** What a Remind me menu acts through: the reminder, and the date picker for a time of the reader's own, where the menu's surface holds one. */
export interface RemindDoors {
  readonly onRemind: InboxReminder;
  readonly onPick?: ((item: InboxItem) => void) | undefined;
}

/** The times a menu offers, each saying when it comes due, set through `onAt` as it is chosen. */
function timeActions(onAt: (at: number) => void): MenuAction[] {
  const now = Date.now();
  return REMIND_TIMES.map((time) => ({
    label: time.label,
    detail: remindWords(time.at(now), now),
    onSelect: () => onAt(time.at(Date.now())),
  }));
}

/** Clear reminder, on an item with a reminder already; nothing on one without. */
function clearReminderActions(item: InboxItem, onRemind: InboxReminder): MenuAction[] {
  return hasReminder(item)
    ? [{ label: WORDS.CLEAR, icon: <InboxIcon />, onSelect: () => onRemind(item, null) }]
    : [];
}

/**
 * An item's menu's reminder entry: Remind me, a submenu of the times and,
 * where the menu's surface holds a picker, a time of the reader's own,
 * printing H where `keyed`, on any item, open or settled, as H sets a
 * reminder on any; and at its foot Clear reminder, on an item with a
 * reminder already, whose time its row says (`InboxItemMarks`).
 */
export function remindEntries(item: InboxItem, doors: RemindDoors, keyed: boolean): MenuEntry[] {
  const { onPick, onRemind } = doors;
  const pick: MenuAction[] =
    onPick === undefined
      ? []
      : [{ label: WORDS.PICK, icon: <GLYPH.TIME />, onSelect: () => onPick(item) }];
  const remind: MenuEntry = {
    label: WORDS.REMIND_ME,
    icon: <GLYPH.TIME />,
    items: [
      ...timeActions((at) => onRemind(item, at)),
      ...pick,
      ...clearReminderActions(item, onRemind),
    ],
    ...(keyed ? { command: APP_COMMAND.REMIND_ME } : undefined),
  };
  return [remind];
}

/** Sets or clears the reminder of several items chosen together. */
export type InboxRemindMany = (items: readonly InboxItem[], until: number | null) => void;

/**
 * The Remind me menu of several items chosen together: the times, set on
 * every one; a time of the reader's own where the surface holds a picker;
 * and Clear reminders where any of them holds one.
 */
export function remindManyGroups(
  items: readonly InboxItem[],
  onRemindMany: InboxRemindMany,
  onPick: (() => void) | undefined,
): MenuAction[][] {
  return [
    timeActions((at) => onRemindMany(items, at)),
    onPick === undefined ? [] : [{ label: WORDS.PICK, icon: <GLYPH.TIME />, onSelect: onPick }],
    items.some(hasReminder)
      ? [{ label: WORDS.CLEAR_ALL, icon: <InboxIcon />, onSelect: () => onRemindMany(items, null) }]
      : [],
  ].filter((group) => group.length > 0);
}

/**
 * Sets the reminder of several items at once, or clears it on those that
 * hold one, each quietly, and answers with one toast whose Undo puts each
 * back as it stood; a refusal is still each item's own to say.
 */
export function useRemindMany(onRemind: InboxReminder | undefined): InboxRemindMany {
  const toast = useToast();
  return useCallback(
    (items, until) => {
      const touched = until === null ? items.filter(hasReminder) : items;
      if (onRemind === undefined || touched.length === 0) return;
      for (const item of touched) onRemind(item, until, QUIET);
      const undo = () => {
        for (const item of touched) onRemind(item, item.remindAt ?? null, QUIET);
      };
      const words =
        until === null ? WORDS.CLEARED : `Reminder set for ${remindWords(until, Date.now())}`;
      toast({ ...undoToast(words, undo), replayUnmasked: true });
    },
    [onRemind, toast],
  );
}

/**
 * Reminders from an Inbox's list: H opens the Remind me menu on the chosen
 * row while `active`, and Pick a date and time opens the date picker there,
 * drawn in `room`. `rowOf` finds the row an item is drawn in; an item whose
 * row is not drawn opens nothing. What it answers draws the menu and the
 * picker while either stands, and opens the picker for an item.
 */
export function useInboxReminding({
  room,
  rowOf,
  chosen,
  active,
  onRemind,
}: {
  room: RefObject<HTMLElement | null>;
  rowOf: (itemId: string) => HTMLElement | undefined;
  chosen: InboxItem | undefined;
  active: boolean;
  onRemind: InboxReminder | undefined;
}): {
  readonly popover: React.ReactNode;
  readonly onPick: (item: InboxItem, onAt?: (at: number) => void) => void;
} {
  const picker = useDatePicker(room);
  const toast = useToast();
  const menu = useMenu(active);
  const { open } = picker;
  // Note that the picker opens on the row of `item`, setting its reminder unless `onAt` takes the time picked, as several items chosen together do.
  const onPick = useCallback(
    (item: InboxItem, onAt?: (at: number) => void) => {
      const row = rowOf(item.id);
      if (row === undefined || onRemind === undefined) return;
      open({
        at: row,
        date: { start: momentOf(dayAt(Date.now(), 1, MORNING_HOUR)) },
        moment: REMIND_MOMENT,
        onClose: (picked) => {
          const named = pickedInstant(picked, Date.now());
          if (named.kind === PICKED.AT) (onAt ?? ((at) => onRemind(item, at)))(named.at);
          if (named.kind === PICKED.PAST)
            toast({
              replayUnmasked: true,
              words: WORDS.PAST,
              tone: STATUS_TONE.ATTENTION,
              hold: TOAST_HOLD.FAILED,
            });
        },
      });
    },
    [rowOf, onRemind, open, toast],
  );
  const { show } = menu;
  useAppCommand(
    APP_COMMAND.REMIND_ME,
    active && chosen !== undefined && onRemind !== undefined
      ? () => {
          const row = rowOf(chosen.id);
          if (row !== undefined) show(dropBelowStart(row), row);
        }
      : undefined,
  );
  const groups =
    chosen === undefined || onRemind === undefined
      ? []
      : [
          timeActions((at) => onRemind(chosen, at)),
          [{ label: WORDS.PICK, icon: <GLYPH.TIME />, onSelect: () => onPick(chosen) }],
          clearReminderActions(chosen, onRemind),
        ].filter((group) => group.length > 0);
  const popover = (
    <>
      {menu.drawn === undefined || groups.length === 0 ? null : (
        <ActionMenu
          replayUnmasked
          label={WORDS.REMIND_ME}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
      {picker.popover}
    </>
  );
  return { popover, onPick };
}
