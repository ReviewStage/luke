import type { CodingAgentInboxAnswerView } from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { INBOX_CURSOR_START, type InboxItem } from "@sidecar/hosted/inbox-wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInboxPlanHolding } from "#shared/messages/app-state";
import type { InboxReader } from "./use-plan-inbox";

/**
 * use-inbox-items.ts -- every listed plan's inbox items for the window's Inbox, each plan read once and again only when main says it changed.
 *
 * The window's Inbox lists the items of every plan holding one, settled as
 * well as waiting, and main's read of the account carries only what waits,
 * in brief. So each plan main lists is read whole here, from the start, which
 * the service answers at once, and read again only when main's list says
 * the plan's latest item moved, rather than holding a read open on every
 * plan: main's own read is already held open on the account, and is what
 * hears a change. The plan whose item is chosen holds its own read open
 * besides (`use-plan-inbox.ts`), which answers and is drawn in this one's
 * place, so an answer shows at once. A read that did not answer leaves the
 * plan as it was last read, or unread, and says so, with Try again; a
 * later change of the plan's asks again of its own accord.
 */

/** One plan's items as last read, and the moment main said its latest item changed when they were asked for. */
interface Read {
  readonly at: number;
  readonly items: readonly InboxItem[];
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** What the window's Inbox lists from. */
export interface InboxItemsControl {
  /** Each plan's items as last read, by plan; a plan not yet read is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** Whether a plan's last read did not answer, so the list offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
}

export function useInboxItems(input: {
  /** Every plan the Inbox lists, as main last read them. */
  holdings: readonly AppInboxPlanHolding[];
  readInbox: InboxReader;
}): InboxItemsControl {
  const { holdings, readInbox } = input;
  const [reads, setReads] = useState<ReadonlyMap<string, Read>>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  // The read out for each plan, by the moment it asks for, so a plan is asked once per change.
  const asking = useRef(new Map<string, number>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const latest = useRef({ readInbox, reads });
  latest.current = { readInbox, reads };

  // A retry's press asks again of the plans whose read failed, the ones not yet read.
  useEffect(() => {
    for (const { planId, updatedAt } of holdings) {
      if (latest.current.reads.get(planId)?.at === updatedAt) continue;
      if (asking.current.get(planId) === updatedAt) continue;
      asking.current.set(planId, updatedAt);
      latest.current
        .readInbox({ planId, after: INBOX_CURSOR_START })
        .catch((): CodingAgentInboxAnswerView => UNANSWERED)
        .then((answer) => {
          if (asking.current.get(planId) === updatedAt) asking.current.delete(planId);
          if (!live.current) return;
          const failure = "failure" in answer;
          setFailed((was) => {
            if (was.has(planId) === failure) return was;
            const next = new Set(was);
            if (failure) next.add(planId);
            else next.delete(planId);
            return next;
          });
          if (failure) return;
          // A read landing after a newer one for the same plan is let go.
          setReads((was) =>
            (was.get(planId)?.at ?? -1) > updatedAt
              ? was
              : new Map(was).set(planId, { at: updatedAt, items: answer.items }),
          );
        });
    }
  }, [holdings, attempt]);

  const onRetry = useCallback(() => {
    setFailed(new Set());
    setAttempt((count) => count + 1);
  }, []);
  const items = useMemo(
    () => new Map([...reads].map(([planId, read]) => [planId, read.items])),
    [reads],
  );
  return { items, failed: failed.size > 0, onRetry };
}
