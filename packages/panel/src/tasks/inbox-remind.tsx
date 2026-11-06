import { dateChipText, readerZone } from "@repo/features/date-mention";
import type { InboxItem } from "@repo/features/inbox-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { dropBelowStart, STATUS_TONE, useMenu } from "@repo/ui";
import { GLYPH, InboxIcon } from "@repo/ui/icons";
import { type RefObject, useCallback } from "react";
import { useAppCommand } from "../app-commands.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { TOAST_HOLD, useToast } from "../toast.js";
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
 * reminder already offers Cancel reminder besides. What a reminder does to
 * the item, and how it comes back, is `inbox-model.ts`'s `inboxAtNow`.
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
  CANCEL: "Cancel reminder",
  PAST: "Pick a time after now to be reminded",
} as const;

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

/** How an item's reminder is set: for an instant, or canceled where it is null. */
export type InboxReminder = (item: InboxItem, until: number | null) => void;

/** What a Remind me menu acts through: the reminder, and the date picker for a time of the reader's own, where the menu's surface holds one. */
export interface RemindDoors {
  readonly onRemind: InboxReminder;
  readonly onPick?: ((item: InboxItem) => void) | undefined;
}

/** The times a menu offers for `item`, each saying when it comes due. */
function timeActions(item: InboxItem, onRemind: InboxReminder): MenuAction[] {
  const now = Date.now();
  return REMIND_TIMES.map((time) => ({
    label: time.label,
    detail: remindWords(time.at(now), now),
    onSelect: () => onRemind(item, time.at(Date.now())),
  }));
}

/** Cancel reminder, on an item with a reminder already; nothing on one without. */
function cancelReminderActions(item: InboxItem, onRemind: InboxReminder): MenuAction[] {
  return hasReminder(item)
    ? [{ label: WORDS.CANCEL, icon: <InboxIcon />, onSelect: () => onRemind(item, null) }]
    : [];
}

/**
 * An item's menu's reminder entries: Remind me, a submenu of the times
 * and, where the menu's surface holds a picker, a time of the reader's own,
 * printing H where `keyed`, on any item, open or settled, as H sets a
 * reminder on any; and Cancel reminder on an item with a reminder already.
 */
export function remindEntries(item: InboxItem, doors: RemindDoors, keyed: boolean): MenuEntry[] {
  const { onPick } = doors;
  const pick: MenuAction[] =
    onPick === undefined
      ? []
      : [{ label: WORDS.PICK, icon: <GLYPH.TIME />, onSelect: () => onPick(item) }];
  const remind: MenuEntry = {
    label: WORDS.REMIND_ME,
    icon: <GLYPH.TIME />,
    items: [...timeActions(item, doors.onRemind), ...pick],
    ...(keyed ? { command: APP_COMMAND.REMIND_ME } : undefined),
  };
  return [remind, ...cancelReminderActions(item, doors.onRemind)];
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
}): { readonly popover: React.ReactNode; readonly onPick: (item: InboxItem) => void } {
  const picker = useDatePicker(room);
  const toast = useToast();
  const menu = useMenu(active);
  const { open } = picker;
  const onPick = useCallback(
    (item: InboxItem) => {
      const row = rowOf(item.id);
      if (row === undefined || onRemind === undefined) return;
      open({
        at: row,
        date: { start: momentOf(dayAt(Date.now(), 1, MORNING_HOUR)) },
        moment: REMIND_MOMENT,
        onClose: (picked) => {
          const named = pickedInstant(picked, Date.now());
          if (named.kind === PICKED.AT) onRemind(item, named.at);
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
          timeActions(chosen, onRemind),
          [{ label: WORDS.PICK, icon: <GLYPH.TIME />, onSelect: () => onPick(chosen) }],
          cancelReminderActions(chosen, onRemind),
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
