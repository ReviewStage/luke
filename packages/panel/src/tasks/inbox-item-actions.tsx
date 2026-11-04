import type { InboxItem } from "@repo/features/inbox-wire";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import { useCopyLinkItem } from "../copy-link-item.js";
import type { MenuAction, MenuEntry } from "../desktop/action-menu.js";
import { closeAction } from "./inbox-close.js";
import { isUnread } from "./inbox-model.js";
import { type InboxSnoozer, snoozeEntries } from "./inbox-snooze.js";
import { markReadItem } from "./task-menu-items.js";

/**
 * inbox-item-actions.tsx -- the acts every menu of one Inbox item offers, wherever the item is drawn: its row in the Inbox's list and the ⋯ on its thread's bar.
 *
 * Each menu offers the same groups in the same order: Copy link, the
 * item's link under the task or the agent that holds it; Mark as read or
 * unread, naming U where U reaches the item, and Snooze beside it, naming H
 * there too (`inbox-snooze.tsx`); and, alone and last while the item is open, Resolve without answering, asked first
 * through the surface's one question (`inbox-close.tsx`). A surface hands
 * down only the doors it has, and a group whose door is missing stands
 * nowhere.
 */

/** What an item's acts are offered with: the doors the surface hands down, and whether U reaches the item there. */
interface InboxItemDoors {
  /** Marks the item read or unread; none where the surface offers no mark. */
  readonly onMark: ((item: InboxItem, unread: boolean) => void) | undefined;
  /** Asks to close an open item without an answer, through the question the surface draws (`useInboxCloseAsk`); none where it offers no close. */
  readonly onAskClose: ((item: InboxItem) => void) | undefined;
  /** Whether U marks this item, so its Mark names the chord, and H snoozes it, so its Snooze does. */
  readonly keyed: boolean;
  /** Snoozes the item, and opens the date picker for a time of the reader's own; none where the surface offers no snooze. */
  readonly snooze?:
    | { readonly onSnooze: InboxSnoozer; readonly onPick: (item: InboxItem) => void }
    | undefined;
}

/** An item's acts as a menu draws them. */
interface InboxItemActions {
  /** The menu's groups, with `lead` over the item's own: a phone's, standing for what its bar draws. */
  readonly groups: (lead?: readonly MenuAction[][]) => MenuEntry[][];
}

/** The place an item is linked by: its id alone, whose agent and task its reader asks the service for. */
function inboxItemPlace(item: InboxItem): LinkPlace {
  return { kind: LINK_PLACE.INBOX_ITEM, itemId: item.id };
}

/** One item's acts. */
export function useInboxItemActions(item: InboxItem, doors: InboxItemDoors): InboxItemActions {
  const { onMark, onAskClose, keyed, snooze } = doors;
  const read =
    onMark === undefined
      ? undefined
      : markReadItem({ unread: isUnread(item), onMark: (unread) => onMark(item, unread) }, keyed);
  const copyLink = useCopyLinkItem()(inboxItemPlace(item));
  const close = closeAction(item, onAskClose);
  const groups = (lead: readonly MenuAction[][] = []) =>
    [
      ...lead,
      copyLink === undefined ? [] : [copyLink],
      [
        ...(read === undefined ? [] : [read]),
        ...(snooze === undefined ? [] : snoozeEntries(item, snooze, keyed)),
      ],
      close === undefined ? [] : [close],
    ].filter((group) => group.length > 0);
  return { groups };
}
