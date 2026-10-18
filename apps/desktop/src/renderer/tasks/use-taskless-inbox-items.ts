import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START, type InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act";

/**
 * use-taskless-inbox-items.ts -- the items of each agent with no task that something waits on, for the window's Inbox, each agent read whole once and again only when main says its items moved.
 *
 * Main's read of the account carries the items of agents with no task that
 * wait on the developer, in brief, as it carries a task's. So each such
 * agent is read whole here, its settled items as well, from the start,
 * which the service answers at once, and read again only when the items
 * main lists as waiting on it move, one answered or one opened, rather
 * than holding a read open on every agent; the agent whose item is chosen
 * holds its own read open besides, as a task's does (`use-task-inbox.ts`).
 * An answer a newer ask overtook is let go. A read that did not answer
 * leaves the agent as it was last read, or unread, and says so, with Try
 * again, which asks again of it whether or not it was read before.
 */

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** What the window's Inbox lists of the agents with no task. */
export interface TasklessInboxItems {
  /** Each agent's items as last read, by agent; an agent not yet read is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** Whether an agent's last read did not answer, so the list offers to try again. */
  readonly failed: boolean;
  /** The agents whose items are read as of main's latest word of what waits on them, or read and waited on no more, so an item they do not hold is not theirs. */
  readonly current: ReadonlySet<string>;
  readonly onRetry: () => void;
  /** Reads every agent's items again, as of now, though nothing main hears of moved: what every item marked read needs. */
  readonly onReread: () => void;
}

/** One agent's items as last read, and the waiting items that read answered for. */
interface Read {
  readonly items: readonly InboxItem[];
  readonly waitingIds: readonly string[];
}

/** The items main lists as waiting on each agent, by id in id order: what an agent is read again on, an item answered or opened since moving it. */
function waitingPerAgent(
  waiting: readonly AppInboxTasklessItem[],
): ReadonlyMap<string, readonly string[]> {
  const ids = new Map<string, string[]>();
  for (const item of waiting) {
    const held = ids.get(item.agentId) ?? [];
    held.push(item.id);
    ids.set(item.agentId, held);
  }
  return new Map([...ids].map(([agentId, held]) => [agentId, held.toSorted()]));
}

/** Whether two agents' waiting items are the same items. */
function sameItems(one: readonly string[] | undefined, other: readonly string[]): boolean {
  return (
    one !== undefined && one.length === other.length && one.every((id, at) => id === other[at])
  );
}

export function useTasklessInboxItems(
  waiting: readonly AppInboxTasklessItem[],
): TasklessInboxItems {
  const { act } = useAct();
  const [reads, setReads] = useState<ReadonlyMap<string, Read>>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const standing = useMemo(() => waitingPerAgent(waiting), [waiting]);
  // The waiting items each agent's held read answered for, so an agent is read again only when they move.
  const readFor = useRef(new Map<string, readonly string[]>());
  // Each agent's ask out now, by its number and the waiting items it asks for: an answer is taken
  // only for an agent's latest ask, so one overtaken, even for items it waited on before, is let go.
  const asking = useRef(new Map<string, { seq: number; items: readonly string[] }>());
  const asks = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    void attempt;
    for (const [agentId, items] of standing) {
      // Note that an agent whose items came back to what its read answered for lets go of an ask
      // still out for the items between, so that ask's late answer draws nothing over it.
      if (sameItems(readFor.current.get(agentId), items)) {
        asking.current.delete(agentId);
        continue;
      }
      if (sameItems(asking.current.get(agentId)?.items, items)) continue;
      asks.current += 1;
      const seq = asks.current;
      asking.current.set(agentId, { seq, items });
      act(ACT_KIND.CODING_AGENTS_AGENT_INBOX, { agentId, after: INBOX_CURSOR_START })
        .catch(() => UNANSWERED)
        .then((answer) => {
          if (!live.current || asking.current.get(agentId)?.seq !== seq) return;
          asking.current.delete(agentId);
          const failure = "failure" in answer;
          setFailed((was) => {
            if (was.has(agentId) === failure) return was;
            const next = new Set(was);
            if (failure) next.add(agentId);
            else next.delete(agentId);
            return next;
          });
          if ("failure" in answer) return;
          readFor.current.set(agentId, items);
          setReads((was) => new Map(was).set(agentId, { items: answer.items, waitingIds: items }));
        });
    }
  }, [act, standing, attempt]);

  // A retry asks again of every agent whose read failed, one read before among them, its last answer left drawn until the new one lands.
  const failedNow = useRef(failed);
  failedNow.current = failed;
  const onRetry = useCallback(() => {
    for (const agentId of failedNow.current) readFor.current.delete(agentId);
    asking.current.clear();
    setFailed(new Set());
    setAttempt((count) => count + 1);
  }, []);
  // Note that each agent's last read stays drawn until the new one lands.
  const onReread = useCallback(() => {
    readFor.current.clear();
    asking.current.clear();
    setAttempt((count) => count + 1);
  }, []);
  const items = useMemo(
    () => new Map([...reads].map(([agentId, read]) => [agentId, read.items])),
    [reads],
  );
  // Note that an agent nothing waits on any more has no newer read on its way, so its last read stands.
  const current = new Set(
    [...reads.keys()].filter((agentId) => {
      const waitingIds = standing.get(agentId);
      return waitingIds === undefined || sameItems(reads.get(agentId)?.waitingIds, waitingIds);
    }),
  );
  return {
    items,
    failed: [...standing.keys()].some((agentId) => failed.has(agentId)),
    current,
    onRetry,
    onReread,
  };
}
