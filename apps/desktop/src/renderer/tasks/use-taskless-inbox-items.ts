import { INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { useMemo } from "react";
import { useFollowedInboxes, useWindowInboxFollower } from "./use-followed-inboxes";

/**
 * use-planless-inbox-items.ts -- the items of each agent with no plan that something waits on, for the window's Inbox, each agent followed while something waits on it and pushed as its items change.
 *
 * Main's read of the account carries the items of agents with no plan that
 * wait on the developer, in brief, as it carries a plan's. So each such
 * agent is followed whole here (`use-followed-inboxes.ts`), its settled
 * items as well, and pushed to the window as they change rather than read
 * again. An agent that could not be read leaves its items as they were last
 * pushed, or none, and says so, with Try again; one nothing waits on any
 * more keeps its items as last pushed.
 */

/** What the window's Inbox lists of the agents with no plan. */
export interface TasklessInboxItems {
  /** Each agent's items as last pushed, by agent; an agent not yet pushed is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** Whether an agent something waits on could not be read, so the list offers to try again. */
  readonly failed: boolean;
  /** The agents pushed holding every item main says waits on them, or pushed and waited on no more, which stand for them whole, so an item they do not hold is not theirs. */
  readonly current: ReadonlySet<string>;
  readonly onRetry: () => void;
}

export function useTasklessInboxItems(
  waiting: readonly AppInboxTasklessItem[],
): TasklessInboxItems {
  const ids = useMemo(() => waiting.map((item) => item.agentId), [waiting]);
  const { items, failed, onRetry } = useFollowedInboxes(
    INBOX_SCOPE_KIND.AGENT,
    ids,
    useWindowInboxFollower(),
  );
  // Note that an agent main lists an item waiting on that its push does not hold yet is not current,
  // because its push may land a moment after main's own word of the item.
  const current = useMemo(
    () =>
      new Set(
        [...items].flatMap(([agentId, held]) =>
          waiting.every(
            (item) => item.agentId !== agentId || held.some((each) => each.id === item.id),
          )
            ? [agentId]
            : [],
        ),
      ),
    [items, waiting],
  );
  return {
    items,
    failed: ids.some((agentId) => failed.has(agentId)),
    current,
    onRetry,
  };
}
