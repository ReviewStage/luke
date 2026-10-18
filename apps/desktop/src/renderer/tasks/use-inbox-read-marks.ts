import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { ActHandle } from "@luke/panel/act";
import { useAppCommand } from "@luke/panel/app-commands";
import { useInboxSettler } from "@luke/panel/tasks/inbox-settling";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { isUnread } from "./inbox-model";

/**
 * use-inbox-read-marks.ts -- the Inbox's read and unread marks as one control: an item marked read or unread, or every item marked read, its dot flipping at once.
 *
 * A mark goes to the service as an act, and is laid over every read the
 * window draws (`@luke/panel`'s `inbox-settling.ts`, through its
 * `withReadMark`) so the dot flips the moment it is pressed, and stands
 * there until a read holds the item changed since, or a held read that
 * held it as marked holds it otherwise, another window's mark among them,
 * whose word the row then draws. Note that a mark moves nothing main hears
 * of, so a list's read of the item's plan is never read again on its
 * account, and the mark stands over it for as long as that read stands. The acts go one at a time, in the order the marks
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

/** What the Inbox's read marks offer: the presses that mark. */
export interface InboxReadMarks {
  /** Marks one item read or unread. */
  readonly onMark: (item: InboxItem, unread: boolean) => void;
  /** Marks every item given that is unread as read, as the service marks the listed workspace's. */
  readonly onMarkAll: (items: readonly InboxItem[]) => void;
}

/** What a mark the act channel refused hears, as the service not answering. */
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** An item's latest mark still to go: what it says, and the press it was made by. */
interface Wanted {
  readonly made: symbol;
  readonly unread: boolean;
}

/**
 * The Inbox's read marks, sent through `act`; every item marked read in
 * `workspaceId` where the Inbox lists one, and `onMarkedAll` heard once the
 * service took it, so the reads are asked again.
 *
 * A mark stands over every read the window draws (`inbox-settling.ts`)
 * until a read holds the item changed since, or a held read holds a later
 * mark, another window's included, which the row then draws. The marks go to
 * the service one at a time, in the order they were made, an item's later
 * mark standing for any of its own still waiting to go, so a quick read,
 * unread, read reaches it as the last.
 */
export function useInboxReadMarks({
  act,
  workspaceId,
  onMarkedAll,
}: {
  act: ActHandle["act"];
  workspaceId: string | undefined;
  onMarkedAll: () => void;
}): InboxReadMarks {
  const settler = useInboxSettler();
  // The writes, one after another, and each item's latest mark still to go, which its queued write sends.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const wanted = useRef(new Map<string, Wanted>());
  const heard = useRef(onMarkedAll);
  useLayoutEffect(() => {
    heard.current = onMarkedAll;
  });
  const send = useCallback((write: () => Promise<void>) => {
    queue.current = queue.current.then(write);
  }, []);
  const onMark = useCallback(
    (item: InboxItem, unread: boolean) => {
      const made = settler.mark(new Map([[item.id, { unread, updatedAt: item.updatedAt }]]));
      wanted.current.set(item.id, { made, unread });
      send(() => {
        const latest = wanted.current.get(item.id);
        if (latest === undefined) return Promise.resolve();
        wanted.current.delete(item.id);
        return act(ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, {
          itemId: item.id,
          unread: latest.unread,
        })
          .catch(() => UNANSWERED)
          .then((answer) => {
            // Note that a mark is let go only where it still stands as it was made, so a later mark on the same item outlives an earlier one's refusal.
            if ("failure" in answer) settler.unmark(latest.made);
            else settler.marked(latest.made);
          });
      });
    },
    [act, send, settler],
  );
  const onMarkAll = useCallback(
    (items: readonly InboxItem[]) => {
      const marks = new Map(
        items
          .filter(isUnread)
          .map((item) => [item.id, { unread: false, updatedAt: item.updatedAt }] as const),
      );
      if (marks.size === 0) return;
      const made = settler.mark(marks);
      send(() =>
        act(ACT_KIND.CODING_AGENTS_INBOX_READ_ALL, workspaceId === undefined ? {} : { workspaceId })
          .catch(() => UNANSWERED)
          .then((answer) => {
            if ("failure" in answer) {
              settler.unmark(made);
              return;
            }
            settler.marked(made);
            heard.current();
          }),
      );
    },
    [act, workspaceId, send, settler],
  );
  return useMemo(() => ({ onMark, onMarkAll }), [onMark, onMarkAll]);
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
