import type { InboxItem } from "@repo/features/inbox-wire";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import { useCopyLinkItem } from "../copy-link-item.js";
import type { MenuAction, MenuEntry } from "../desktop/action-menu.js";
import { closeAction } from "./inbox-close.js";
import { isUnread } from "./inbox-model.js";
import { type RemindDoors, remindEntries } from "./inbox-remind.js";
import { markReadItem } from "./task-menu-items.js";

interface InboxItemDoors {
  readonly onMark: ((item: InboxItem, unread: boolean) => void) | undefined;
  readonly onAskClose: ((item: InboxItem) => void) | undefined;
  readonly keyed: boolean;
  readonly remind?: RemindDoors | undefined;
}

interface InboxItemActions {
  readonly groups: (lead?: readonly MenuAction[][]) => MenuEntry[][];
}

function inboxItemPlace(item: InboxItem): LinkPlace {
  return { kind: LINK_PLACE.INBOX_ITEM, itemId: item.id };
}

export function useInboxItemActions(item: InboxItem, doors: InboxItemDoors): InboxItemActions {
  const { onMark, onAskClose, keyed, remind } = doors;
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
        ...(remind === undefined ? [] : remindEntries(item, remind, keyed)),
      ],
      close === undefined ? [] : [close],
    ].filter((group) => group.length > 0);
  return { groups };
}
