import { dateChipText, readerZone } from "@repo/features/date-mention";
import type { InboxItem } from "@repo/features/inbox-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { dropBelowStart, useMenu } from "@repo/ui";
import { GLYPH, InboxIcon } from "@repo/ui/icons";
import { type RefObject, useCallback } from "react";
import { useAppCommand } from "../app-commands.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { DATE_PICKER_CLOSE, type DatePicked, useDatePicker } from "./date-picker.js";
import { isSnoozed } from "./inbox-model.js";

/**
 * inbox-snooze.tsx -- snoozing an Inbox item: the times its menus offer, the menu H opens on the chosen row, and the date picker for a time of the reader's own.
 *
 * A snooze takes an item out of the reader's Inbox until a time they pick:
 * in an hour, tomorrow at 9 AM, next Monday at 9 AM, or a day and time
 * picked in the date picker a date mention opens (`date-picker.tsx`), a day
 * picked without a time meaning 9 AM. The item's row offers them in a
 * Snooze submenu, and H opens them on the chosen row; an item snoozed
 * already offers Unsnooze besides. What a snooze does to the item, and how
 * it comes back, is `inbox-model.ts`'s `inboxAtNow`.
 */

/** The hour a day picked without a time, tomorrow, and next week wake at, in the reader's own zone. */
const MORNING_HOUR = 9;

const HOUR_MS = 60 * 60 * 1000;

const WORDS = {
  SNOOZE: "Snooze",
  SNOOZE_UNTIL: "Snooze until",
  IN_AN_HOUR: "In 1 hour",
  TOMORROW: "Tomorrow",
  NEXT_WEEK: "Next week",
  PICK: "Pick a date and time…",
  UNSNOOZE: "Unsnooze",
} as const;

/** One time a snooze menu offers: its words, and when it wakes, counted from the moment it is chosen. */
interface SnoozeTime {
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

/** The times every snooze menu offers, in its order: an hour on, tomorrow morning, and next Monday morning. */
const SNOOZE_TIMES: readonly SnoozeTime[] = [
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

/** When a snooze wakes, in the words a date mention's chip uses from `now`: Today 11:24 AM, Tomorrow 9:00 AM, Monday 9:00 AM. */
export function snoozeWords(at: number, now: number): string {
  return dateChipText({ start: momentOf(at) }, now, readerZone());
}

/** The instant a picked date names: its time, or 9 AM on a day picked alone; none where it was cleared, names none, or is not ahead of `now`. */
function pickedInstant(picked: DatePicked, now: number): number | undefined {
  if (picked.how === DATE_PICKER_CLOSE.CLEAR || picked.date === undefined) return undefined;
  const { start } = picked.date;
  const at = /T/u.test(start)
    ? Date.parse(start)
    : new Date(`${start}T${String(MORNING_HOUR).padStart(2, "0")}:00`).getTime();
  return Number.isNaN(at) || at <= now ? undefined : at;
}

/** How an item is snoozed: until an instant, or no longer where it is null. */
export type InboxSnoozer = (item: InboxItem, until: number | null) => void;

/** What a snooze menu acts through: the snooze, and the date picker for a time of the reader's own. */
interface SnoozeDoors {
  readonly onSnooze: InboxSnoozer;
  readonly onPick: (item: InboxItem) => void;
}

/** The times a menu offers for `item`, each saying when it wakes. */
function timeActions(item: InboxItem, onSnooze: InboxSnoozer): MenuAction[] {
  const now = Date.now();
  return SNOOZE_TIMES.map((time) => ({
    label: time.label,
    detail: snoozeWords(time.at(now), now),
    onSelect: () => onSnooze(item, time.at(Date.now())),
  }));
}

/** Unsnooze, on an item snoozed already; nothing on one that is not. */
function unsnoozeActions(item: InboxItem, onSnooze: InboxSnoozer): MenuAction[] {
  return isSnoozed(item)
    ? [{ label: WORDS.UNSNOOZE, icon: <InboxIcon />, onSelect: () => onSnooze(item, null) }]
    : [];
}

/**
 * An item's row menu's snooze entries: Snooze, a submenu of the times and a
 * time of the reader's own, printing H where `keyed`, and Unsnooze on an
 * item snoozed already.
 */
export function snoozeEntries(item: InboxItem, doors: SnoozeDoors, keyed: boolean): MenuEntry[] {
  const pick: MenuAction = {
    label: WORDS.PICK,
    icon: <GLYPH.TIME />,
    onSelect: () => doors.onPick(item),
  };
  const snooze: MenuEntry = {
    label: WORDS.SNOOZE,
    icon: <GLYPH.TIME />,
    items: [...timeActions(item, doors.onSnooze), pick],
    ...(keyed ? { command: APP_COMMAND.SNOOZE } : undefined),
  };
  return [snooze, ...unsnoozeActions(item, doors.onSnooze)];
}

/**
 * Snoozing from an Inbox's list: H opens the snooze menu on the chosen
 * row while `active`, and Pick a date and time opens the date picker there,
 * drawn in `room`. `rowOf` finds the row an item is drawn in; an item whose
 * row is not drawn opens nothing. What it answers draws the menu and the
 * picker while either stands, and opens the picker for an item.
 */
export function useInboxSnoozing({
  room,
  rowOf,
  chosen,
  active,
  onSnooze,
}: {
  room: RefObject<HTMLElement | null>;
  rowOf: (itemId: string) => HTMLElement | undefined;
  chosen: InboxItem | undefined;
  active: boolean;
  onSnooze: InboxSnoozer | undefined;
}): { readonly popover: React.ReactNode; readonly onPick: (item: InboxItem) => void } {
  const picker = useDatePicker(room);
  const menu = useMenu(active);
  const { open } = picker;
  const onPick = useCallback(
    (item: InboxItem) => {
      const row = rowOf(item.id);
      if (row === undefined || onSnooze === undefined) return;
      open({
        at: row,
        date: undefined,
        onClose: (picked) => {
          const at = pickedInstant(picked, Date.now());
          if (at !== undefined) onSnooze(item, at);
        },
      });
    },
    [rowOf, onSnooze, open],
  );
  const { show } = menu;
  useAppCommand(
    APP_COMMAND.SNOOZE,
    active && chosen !== undefined && onSnooze !== undefined
      ? () => {
          const row = rowOf(chosen.id);
          if (row !== undefined) show(dropBelowStart(row), row);
        }
      : undefined,
  );
  const groups =
    chosen === undefined || onSnooze === undefined
      ? []
      : [
          timeActions(chosen, onSnooze),
          [{ label: WORDS.PICK, icon: <GLYPH.TIME />, onSelect: () => onPick(chosen) }],
          unsnoozeActions(chosen, onSnooze),
        ].filter((group) => group.length > 0);
  const popover = (
    <>
      {menu.drawn === undefined || groups.length === 0 ? null : (
        <ActionMenu
          label={WORDS.SNOOZE_UNTIL}
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
