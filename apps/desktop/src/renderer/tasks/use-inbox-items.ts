import { INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { useMemo } from "react";
import { useFollowedInboxes, useWindowInboxFollower } from "./use-followed-inboxes";

/**
 * use-inbox-items.ts -- every listed plan's inbox items for the window's Inbox, each plan followed while it is listed and pushed as it changes.
 *
 * The window's Inbox lists the items of every plan holding one, settled as
 * well as waiting, and main's read of the account carries only what waits,
 * in brief. So each plan main lists is followed whole here
 * (`use-followed-inboxes.ts`), and its items are pushed to the window as
 * they change rather than read again. A plan that could not be read
 * leaves its items as they were last pushed, or none, and says so, with
 * Try again; one main lists no more keeps its items as last pushed.
 */

/** What the window's Inbox lists from. */
export interface InboxItemsControl {
  /** Each plan's items as last pushed, by plan; a plan not yet pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** Whether a listed plan could not be read, so the list offers to try again. */
  readonly failed: boolean;
  /** Whether a listed plan has not been pushed as main says it now stands, and was not refused: its items are on their way. */
  readonly pending: boolean;
  /** The plans pushed as main says they now stand, or pushed and listed no more, which stand for them whole, so an item they do not hold is not theirs. */
  readonly current: ReadonlySet<string>;
  readonly onRetry: () => void;
}

/** When the latest of the items changed; nothing for none. */
function newest(items: readonly InboxItem[]): number {
  return items.reduce((latest, item) => Math.max(latest, item.updatedAt), Number.NEGATIVE_INFINITY);
}

export function useInboxItems(input: {
  /** Every plan the Inbox lists, as main last read them. */
  holdings: readonly AppInboxTaskHolding[];
}): InboxItemsControl {
  const { holdings } = input;
  const ids = useMemo(() => holdings.map((holding) => holding.taskId), [holdings]);
  const { items, failed, onRetry } = useFollowedInboxes(
    INBOX_SCOPE_KIND.PLAN,
    ids,
    useWindowInboxFollower(),
  );
  // Note that a plan main says changed later than anything pushed of it is not current yet, because
  // its push may land a moment after main's own word of the change.
  const current = useMemo(
    () =>
      new Set(
        [...items].flatMap(([taskId, held]) => {
          const holding = holdings.find((each) => each.taskId === taskId);
          return holding === undefined || newest(held) >= holding.updatedAt ? [taskId] : [];
        }),
      ),
    [items, holdings],
  );
  return {
    items,
    failed: ids.some((taskId) => failed.has(taskId)),
    pending: ids.some((taskId) => !current.has(taskId) && !failed.has(taskId)),
    current,
    onRetry,
  };
}
