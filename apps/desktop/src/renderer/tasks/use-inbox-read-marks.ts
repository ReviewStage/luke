import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { ActHandle } from "@luke/panel/act";
import { useAppCommand } from "@luke/panel/app-commands";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type InboxGroup, type InboxReadMark, isUnread, withReadMarks } from "./inbox-model";

/**
 * use-inbox-read-marks.ts -- the Inbox's read and unread marks as one control: an item marked read or unread, or every item marked read, its dot flipping at once.
 *
 * A mark goes to the service as an act, and is laid over what the reads
 * hold (`inbox-model.ts`'s `withReadMarks`) so the dot flips the moment it
 * is pressed, until the reads hold the item as the mark left it; then the
 * mark is let go, so a later read, another window's mark among them, is
 * what the row draws. The acts go one at a time, in the order the marks
 * were made, so a quick read, unread, read reaches the service as the last,
 * Mark all as read in its turn among them. A mark the service did not take
 * is let go, and the dot stands as the reads hold it. Marking every item
 * read marks the items the Inbox lists in the one workspace it lists, as
 * the service marks them, and asks the reads again once it is taken, since
 * the write moves nothing main hears of; an item waiting on the developer
 * keeps waiting, since the dots are all it clears.
 *
 * Opening an item marks it read, once each time it is shown
 * (`useReadOnOpen`), so an item the reader marks unread while it is shown
 * stays unread until they open it again, as a mail app keeps it; and a
 * plain U marks the chosen item read or unread, as its row's menu says.
 */

/** What the Inbox's read marks offer: the reads with the marks laid over them, and the marks themselves. */
export interface InboxReadMarks {
  /** The groups as the reads hold them, the marks they have not caught up with laid over them. */
  readonly groups: readonly InboxGroup[];
  /** Marks one item read or unread. */
  readonly onMark: (item: InboxItem, unread: boolean) => void;
  /** Marks every item given that is unread as read, as the service marks the listed workspace's. */
  readonly onMarkAll: (items: readonly InboxItem[]) => void;
}

/** No marks, one map so a hook that holds none hands down the same one. */
const NO_MARKS: ReadonlyMap<string, InboxReadMark> = new Map();

/** What a mark the act channel refused hears, as the service not answering. */
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Whether the reads hold an item as a mark left it, or have moved past the item it was made on: either way the mark has nothing left to say. */
function caughtUp(groups: readonly InboxGroup[], itemId: string, mark: InboxReadMark): boolean {
  for (const { items } of groups) {
    const item = items.find((each) => each.id === itemId);
    if (item !== undefined)
      return item.updatedAt !== mark.updatedAt || isUnread(item) === mark.unread;
  }
  return false;
}

/**
 * The Inbox's read marks over `groups`, the reads as they stand, sent
 * through `act`; every item marked read in `workspaceId` where the Inbox
 * lists one, and `onMarkedAll` heard once the service took it, so the
 * reads are asked again.
 *
 * A mark stands over the reads until they hold the item as it left it, and
 * is let go then, so a later read, another window's mark included, is what
 * the row draws. The marks go to the service one at a time, in the order
 * they were made, an item's later mark standing for any of its own still
 * waiting to go, so a quick read, unread, read reaches it as the last.
 */
export function useInboxReadMarks({
  act,
  workspaceId,
  groups,
  onMarkedAll,
}: {
  act: ActHandle["act"];
  workspaceId: string | undefined;
  groups: readonly InboxGroup[];
  onMarkedAll: () => void;
}): InboxReadMarks {
  const [marks, setMarks] = useState(NO_MARKS);
  // The writes, one after another, and each item's latest mark still to go, which its queued write sends.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const wanted = useRef(new Map<string, ReadonlyMap<string, InboxReadMark>>());
  const heard = useRef(onMarkedAll);
  useLayoutEffect(() => {
    heard.current = onMarkedAll;
  });
  // Note that a mark is let go only where it still stands as it was made, so a later mark on the same item outlives an earlier one's refusal.
  const letGo = useCallback((made: ReadonlyMap<string, InboxReadMark>) => {
    setMarks((held) => {
      const kept = new Map(held);
      for (const [itemId, mark] of made) if (kept.get(itemId) === mark) kept.delete(itemId);
      return kept.size === held.size ? held : kept;
    });
  }, []);
  const lay = useCallback((made: ReadonlyMap<string, InboxReadMark>) => {
    setMarks((held) => new Map([...held, ...made]));
  }, []);
  const send = useCallback((write: () => Promise<void>) => {
    queue.current = queue.current.then(write);
  }, []);
  useEffect(() => {
    const done = [...marks].filter(([itemId, mark]) => caughtUp(groups, itemId, mark));
    if (done.length > 0) letGo(new Map(done));
  });
  const onMark = useCallback(
    (item: InboxItem, unread: boolean) => {
      const made = new Map([[item.id, { unread, updatedAt: item.updatedAt }]]);
      lay(made);
      wanted.current.set(item.id, made);
      send(() => {
        const latest = wanted.current.get(item.id);
        const mark = latest?.get(item.id);
        if (latest === undefined || mark === undefined) return Promise.resolve();
        wanted.current.delete(item.id);
        return act(ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, {
          itemId: item.id,
          unread: mark.unread,
        })
          .catch(() => UNANSWERED)
          .then((answer) => {
            if ("failure" in answer) letGo(latest);
          });
      });
    },
    [act, lay, letGo, send],
  );
  const onMarkAll = useCallback(
    (items: readonly InboxItem[]) => {
      const made = new Map(
        items
          .filter(isUnread)
          .map((item) => [item.id, { unread: false, updatedAt: item.updatedAt }] as const),
      );
      if (made.size === 0) return;
      lay(made);
      send(() =>
        act(ACT_KIND.CODING_AGENTS_INBOX_READ_ALL, workspaceId === undefined ? {} : { workspaceId })
          .catch(() => UNANSWERED)
          .then((answer) => {
            if ("failure" in answer) letGo(made);
            else heard.current();
          }),
      );
    },
    [act, workspaceId, lay, letGo, send],
  );
  const marked = useMemo(() => withReadMarks(groups, marks), [groups, marks]);
  return { groups: marked, onMark, onMarkAll };
}

/**
 * Marks the item an Inbox shows read as it is opened, once each time it is
 * shown, and offers U, which marks the chosen item read or unread, while
 * the Inbox stands. `shown` is the item the pane draws, none while the
 * Inbox is hidden or shows its list alone.
 */
export function useReadOnOpen({
  shown,
  chosen,
  active,
  onMark,
}: {
  shown: InboxItem | undefined;
  chosen: InboxItem | undefined;
  active: boolean;
  onMark: (item: InboxItem, unread: boolean) => void;
}): void {
  const readOn = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shown === undefined) {
      readOn.current = undefined;
      return;
    }
    if (readOn.current === shown.id) return;
    readOn.current = shown.id;
    if (isUnread(shown)) onMark(shown, false);
  }, [shown, onMark]);
  useAppCommand(
    APP_COMMAND.TOGGLE_INBOX_ITEM_READ,
    active && chosen !== undefined ? () => onMark(chosen, !isUnread(chosen)) : undefined,
  );
}
