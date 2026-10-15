import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START, type InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxPlanlessItem } from "@luke/host/app-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act";

/**
 * use-planless-inbox-items.ts -- the items of each agent with no plan that something waits on, for the window's Inbox, each agent read whole once and again only when main says its items moved.
 *
 * Main's read of the account carries the items of agents with no plan that
 * wait on the developer, in brief, as it carries a plan's. So each such
 * agent is read whole here, its settled items as well, from the start,
 * which the service answers at once, and read again only when the newest
 * item main lists for it moves, rather than holding a read open on every
 * agent; the agent whose item is chosen holds its own read open besides,
 * as a plan's does (`use-plan-inbox.ts`). An answer a newer ask overtook is
 * let go. A read that did not answer leaves the agent as it was last read,
 * or unread, and says so, with Try again.
 */

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** What the window's Inbox lists of the agents with no plan. */
export interface PlanlessInboxItems {
  /** Each agent's items as last read, by agent; an agent not yet read is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** Whether an agent's last read did not answer, so the list offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** The moment main's newest listed item of each agent was posted: what an agent is read again on. */
function newestPerAgent(waiting: readonly AppInboxPlanlessItem[]): ReadonlyMap<string, number> {
  const newest = new Map<string, number>();
  for (const item of waiting) {
    newest.set(item.agentId, Math.max(newest.get(item.agentId) ?? item.postedAt, item.postedAt));
  }
  return newest;
}

export function usePlanlessInboxItems(
  waiting: readonly AppInboxPlanlessItem[],
): PlanlessInboxItems {
  const { act } = useAct();
  const [reads, setReads] = useState<
    ReadonlyMap<string, { at: number; items: readonly InboxItem[] }>
  >(new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const newest = useMemo(() => newestPerAgent(waiting), [waiting]);
  // The moment each agent was last asked for, so an agent is asked once per move and a late answer to an earlier ask is let go.
  const asked = useRef(new Map<string, number>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const readsNow = useRef(reads);
  readsNow.current = reads;

  useEffect(() => {
    void attempt;
    for (const [agentId, at] of newest) {
      if (readsNow.current.get(agentId)?.at === at || asked.current.get(agentId) === at) continue;
      asked.current.set(agentId, at);
      act(ACT_KIND.CODING_AGENTS_AGENT_INBOX, { agentId, after: INBOX_CURSOR_START })
        .catch(() => UNANSWERED)
        .then((answer) => {
          if (!live.current || asked.current.get(agentId) !== at) return;
          const failure = "failure" in answer;
          setFailed((was) => {
            if (was.has(agentId) === failure) return was;
            const next = new Set(was);
            if (failure) next.add(agentId);
            else next.delete(agentId);
            return next;
          });
          if (!("failure" in answer)) {
            setReads((was) => new Map(was).set(agentId, { at, items: answer.items }));
          }
        });
    }
  }, [act, newest, attempt]);

  const onRetry = useCallback(() => {
    asked.current.clear();
    setFailed(new Set());
    setAttempt((count) => count + 1);
  }, []);
  const items = useMemo(
    () => new Map([...reads].map(([agentId, read]) => [agentId, read.items])),
    [reads],
  );
  return { items, failed: [...newest.keys()].some((agentId) => failed.has(agentId)), onRetry };
}
