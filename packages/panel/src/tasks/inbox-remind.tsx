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

export const REMIND_ME = WORDS.REMIND_ME;

const REMIND_MOMENT: DatePickerMoment = { title: WORDS.REMIND_ME, verb: WORDS.REMIND_ME };

interface RemindTime {
  readonly label: string;
  readonly at: (now: number) => number;
}

function dayAt(now: number, days: number, hour: number): number {
  const day = new Date(now);
  day.setDate(day.getDate() + days);
  day.setHours(hour, 0, 0, 0);
  return day.getTime();
}

const REMIND_TIMES: readonly RemindTime[] = [
  { label: WORDS.IN_AN_HOUR, at: (now) => now + HOUR_MS },
  { label: WORDS.TOMORROW, at: (now) => dayAt(now, 1, MORNING_HOUR) },
  {
    label: WORDS.NEXT_WEEK,
    at: (now) => dayAt(now, (8 - new Date(now).getDay()) % 7 || 7, MORNING_HOUR),
  },
];

function momentOf(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16)}+00:00`;
}

export function remindWords(at: number, now: number): string {
  return dateChipText({ start: momentOf(at) }, now, readerZone());
}

const PICKED = { NONE: "none", PAST: "past", AT: "at" } as const;

type Picked =
  | { readonly kind: typeof PICKED.NONE | typeof PICKED.PAST }
  | { readonly kind: typeof PICKED.AT; readonly at: number };

function pickedInstant(picked: DatePicked, now: number): Picked {
  if (picked.how !== DATE_PICKER_CLOSE.CONFIRM || picked.date === undefined) {
    return { kind: PICKED.NONE };
  }
  const at = Date.parse(picked.date.start);
  if (Number.isNaN(at)) return { kind: PICKED.NONE };
  return at <= now ? { kind: PICKED.PAST } : { kind: PICKED.AT, at };
}

export interface RemindSaying {
  readonly quiet: boolean;
}

const QUIET: RemindSaying = { quiet: true };

export type InboxReminder = (item: InboxItem, until: number | null, saying?: RemindSaying) => void;

export interface RemindDoors {
  readonly onRemind: InboxReminder;
  readonly onPick?: ((item: InboxItem) => void) | undefined;
}

function timeActions(onAt: (at: number) => void): MenuAction[] {
  const now = Date.now();
  return REMIND_TIMES.map((time) => ({
    label: time.label,
    detail: remindWords(time.at(now), now),
    onSelect: () => onAt(time.at(Date.now())),
  }));
}

function clearReminderActions(item: InboxItem, onRemind: InboxReminder): MenuAction[] {
  return hasReminder(item)
    ? [{ label: WORDS.CLEAR, icon: <InboxIcon />, onSelect: () => onRemind(item, null) }]
    : [];
}

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

export type InboxRemindMany = (items: readonly InboxItem[], until: number | null) => void;

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
  const onPick = useCallback(
    (item: InboxItem, onAt?: (at: number) => void) => {
      const row = rowOf(item.id) ?? (onAt === undefined ? undefined : (room.current ?? undefined));
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
