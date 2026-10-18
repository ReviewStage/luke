import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActHandle } from "../act";
import { useAppCommand } from "../app-commands";
import { type InboxGroup, type InboxReadMark, isUnread, withReadMarks } from "./inbox-model";

/**
 * use-inbox-read-marks.ts -- the Inbox's read and unread marks as one control: an item marked read or unread, or every item marked read, its dot flipping at once.
 *
 * A mark goes to the service as an act, which wakes the held reads of the
 * account on its own, so nothing here reads again; until those reads
 * answer, the mark is laid over what they hold (`inbox-model.ts`'s
 * `withReadMarks`), so the dot flips the moment it is pressed. A mark the
 * service did not take is let go, and the dot stands as the reads hold it.
 * Marking every item read marks only the items the Inbox lists that are
 * unread, in the one workspace it lists, as the service marks them; an item
 * waiting on the developer keeps waiting, since the dots are all it clears.
 *
 * Opening an item marks it read, once each time it is shown
 * (`useReadOnOpen`), so an item the reader marks unread while it is shown
 * stays unread until they open it again, as a mail app keeps it; and a
 * plain U marks the chosen item read or unread, as its row's menu says.
 */

/** What the Inbox's read marks offer: the reads with the marks laid over them, and the marks themselves. */
export interface InboxReadMarks {
  /** The groups as the reads hold them, the marks not yet read back laid over them. */
  readonly over: (groups: readonly InboxGroup[]) => readonly InboxGroup[];
  /** Marks one item read or unread. */
  readonly onMark: (item: InboxItem, unread: boolean) => void;
  /** Marks every item given that is unread as read, as the service marks the listed workspace's. */
  readonly onMarkAll: (items: readonly InboxItem[]) => void;
}

/** What a mark the act channel refused hears, as the service not answering. */
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** No marks, one map so a hook that holds none hands down the same one. */
const NO_MARKS: ReadonlyMap<string, InboxReadMark> = new Map();

/** The Inbox's read marks, sent through `act`, every item marked read in `workspaceId` where the Inbox lists one. */
export function useInboxReadMarks({
  act,
  workspaceId,
}: {
  act: ActHandle["act"];
  workspaceId: string | undefined;
}): InboxReadMarks {
  const [marks, setMarks] = useState(NO_MARKS);
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
  const onMark = useCallback(
    (item: InboxItem, unread: boolean) => {
      const made = new Map([[item.id, { unread, updatedAt: item.updatedAt }]]);
      lay(made);
      void act(ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, { itemId: item.id, unread })
        .catch(() => UNANSWERED)
        .then((answer) => {
          if ("failure" in answer) letGo(made);
        });
    },
    [act, lay, letGo],
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
      void act(
        ACT_KIND.CODING_AGENTS_INBOX_READ_ALL,
        workspaceId === undefined ? {} : { workspaceId },
      )
        .catch(() => UNANSWERED)
        .then((answer) => {
          if ("failure" in answer) letGo(made);
        });
    },
    [act, workspaceId, lay, letGo],
  );
  const over = useCallback(
    (groups: readonly InboxGroup[]) => withReadMarks(groups, marks),
    [marks],
  );
  return { over, onMark, onMarkAll };
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
