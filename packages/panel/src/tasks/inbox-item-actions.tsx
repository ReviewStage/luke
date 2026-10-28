import type { InboxItem } from "@luke/features/inbox-wire";
import { LINK_PLACE, type LinkPlace } from "@luke/features/link-grammar";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { GLYPH } from "@luke/ui/icons";
import { useCopyLinkItem } from "../copy-link-item.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { type InboxClose, type InboxCloser, useInboxClose } from "./inbox-close.js";
import { INBOX_HOLDER, type InboxHolder, isUnread } from "./inbox-model.js";
import { markReadItem } from "./task-menu-items.js";

/**
 * inbox-item-actions.tsx -- the acts every menu of one Inbox item offers, wherever the item is drawn: its row in the Inbox's list and the ⋯ on its thread's bar.
 *
 * Each menu offers the same groups in the same order: Copy link, the
 * item's link under the task or the agent that holds it; Mark as read or
 * unread, naming U where U reaches the item; Move to channel…, which asks
 * which channel its thread moves to (`move-thread-dialog.tsx`); and, alone
 * and last while the item is open, Resolve without answering, asked first
 * (`inbox-close.tsx`). A surface hands down only the doors it has, and a
 * group whose door is missing stands nowhere.
 */

/** What moves an item's thread, which asks where to first. */
const MOVE_TO_CHANNEL = "Move to channel…";

/** What an item's acts are offered with: the doors the surface hands down, and whether U reaches the item there. */
interface InboxItemDoors {
  /** Marks the item read or unread; none where the surface offers no mark. */
  readonly onMark: ((item: InboxItem, unread: boolean) => void) | undefined;
  /** Asks which channel the item's thread moves to; none where Channels is off or the surface offers no move. */
  readonly onMove?: ((item: InboxItem) => void) | undefined;
  /** Closes an open item without an answer; none where the surface offers no close. */
  readonly onClose: InboxCloser | undefined;
  /** Whether the surface is in sight, which the close's question goes with. */
  readonly shown: boolean;
  /** Whether U marks this item, so its Mark names the chord. */
  readonly keyed: boolean;
}

/** An item's acts as a menu draws them. */
interface InboxItemActions {
  /** Mark as read or unread, which a row presses from its hover too; none where no mark is handed down. */
  readonly read: MenuAction | undefined;
  /** The close, its menu item and its question, which the surface draws. */
  readonly close: InboxClose;
  /** The menu's groups, with `lead` over the item's own: a phone's, standing for what its bar draws. */
  readonly groups: (lead?: readonly MenuAction[][]) => MenuAction[][];
}

/** The place an item is linked by: under its task where a task holds it, else under its agent. */
function inboxItemPlace(holder: InboxHolder | undefined, item: InboxItem): LinkPlace {
  return holder?.kind === INBOX_HOLDER.TASK
    ? { kind: LINK_PLACE.INBOX_ITEM, planId: holder.task.id, itemId: item.id }
    : { kind: LINK_PLACE.INBOX_ITEM, agentId: item.agentId, itemId: item.id };
}

/** One item's acts; `holder` is what holds it, none where it is not read yet. */
export function useInboxItemActions(
  holder: InboxHolder | undefined,
  item: InboxItem,
  doors: InboxItemDoors,
): InboxItemActions {
  const { onMark, onMove, onClose, shown, keyed } = doors;
  const read =
    onMark === undefined
      ? undefined
      : {
          ...markReadItem({ unread: isUnread(item), onMark: (unread) => onMark(item, unread) }),
          ...(keyed ? { command: APP_COMMAND.TOGGLE_INBOX_ITEM_READ } : {}),
        };
  const copyLink = useCopyLinkItem()(inboxItemPlace(holder, item));
  const close = useInboxClose(item, onClose, shown);
  const move: MenuAction | undefined =
    onMove === undefined
      ? undefined
      : { label: MOVE_TO_CHANNEL, icon: <GLYPH.CHANNEL />, onSelect: () => onMove(item) };
  const groups = (lead: readonly MenuAction[][] = []) =>
    [
      ...lead,
      copyLink === undefined ? [] : [copyLink],
      read === undefined ? [] : [read],
      move === undefined ? [] : [move],
      close.action === undefined ? [] : [close.action],
    ].filter((group) => group.length > 0);
  return { read, close, groups };
}
