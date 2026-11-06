import type { InboxItem } from "@repo/features/inbox-wire";
import type { RefObject } from "react";
import { useSteadyDoor } from "../steady-door.js";
import type { InboxResolver } from "./inbox-close.js";
import { type InboxReminder, useInboxReminding } from "./inbox-remind.js";
import type { InboxListMark } from "./inbox-selection.js";

/**
 * inbox-row-acts.tsx -- what an Inbox item's row acts through, wherever a list of them is drawn: the Inbox's own list, Home's, and a person's page's alike.
 *
 * A list hands down the doors it has, mark, resolve, and remind, and each
 * row's menu offers the acts those doors reach (`useInboxItemActions`):
 * Mark as read or unread, Remind me, a time of the reader's own picked
 * beside the row (`useInboxReminding`), and Resolve, at once with Undo
 * (`useInboxResolver`). The doors handed to the rows stand across draws,
 * each calling the newest the list was handed, so a row is drawn again only
 * where its item moves (`InboxItemRow`'s `memo`). H reaches the chosen
 * item's row, where the list has one.
 */

/** What a list's rows act through; a door left out stands nowhere in their menus. */
interface InboxListDoors {
  readonly onMark?: InboxListMark | undefined;
  readonly onResolve?: InboxResolver | undefined;
  readonly onRemind?: InboxReminder | undefined;
}

/** The doors each row is handed, spread onto its `InboxItemRow`. */
interface InboxRowDoors {
  readonly onMark: InboxListMark | undefined;
  readonly onResolve: InboxResolver | undefined;
  readonly onRemind: InboxReminder | undefined;
  readonly onPickRemind: ((item: InboxItem) => void) | undefined;
}

/** The rows' acts: what each row is handed, the date picker opened on an item, and the picker, drawn while it stands. */
interface InboxRowActs {
  readonly row: InboxRowDoors;
  /** Opens the date picker on the item's row, setting its reminder unless `onAt` takes the time picked. */
  readonly onPick: (item: InboxItem, onAt?: (at: number) => void) => void;
  readonly layers: React.ReactNode;
}

/**
 * The acts of a list's rows while the list is `shown`: `rowOf` finds an
 * item's row, `room` is the box the date picker opens in, and `chosen` the
 * item H reaches, none where no row is chosen.
 */
export function useInboxRowActs({
  doors,
  room,
  rowOf,
  chosen,
  shown,
}: {
  doors: InboxListDoors;
  room: RefObject<HTMLElement | null>;
  rowOf: (itemId: string) => HTMLElement | undefined;
  chosen: InboxItem | undefined;
  shown: boolean;
}): InboxRowActs {
  const { onMark, onResolve, onRemind } = doors;
  const mark = useSteadyDoor(onMark);
  const resolve = useSteadyDoor(onResolve);
  const remind = useSteadyDoor(onRemind);
  const reminding = useInboxReminding({ room, rowOf, chosen, active: shown, onRemind });
  const pickRemind = useSteadyDoor(reminding.onPick);
  return {
    row: {
      onMark: mark,
      onResolve: resolve,
      onRemind: remind,
      onPickRemind: onRemind === undefined ? undefined : pickRemind,
    },
    onPick: reminding.onPick,
    layers: reminding.popover,
  };
}
