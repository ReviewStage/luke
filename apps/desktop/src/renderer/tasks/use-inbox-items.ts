import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnswerView,
} from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START, type InboxItem } from "@luke/features/inbox-wire";
import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxReader } from "./use-task-inbox";

/**
 * use-inbox-items.ts -- every listed task's inbox items for the window's Inbox, each task read once and again only when main says it changed.
 *
 * The window's Inbox lists the items of every task holding one, settled as
 * well as waiting, and main's read of the account carries only what waits,
 * in brief. So each task main lists is read whole here, from the start, which
 * the service answers at once, and read again only when main's list says
 * the task's latest item moved, rather than holding a read open on every
 * task: main's own read is already held open on the account, and is what
 * hears a change. The task whose item is chosen holds its own read open
 * besides (`use-task-inbox.ts`), which answers and is drawn in this one's
 * place, so an answer shows at once. An answer to a read a newer one
 * overtook is let go, items and failure alike. A read that did not answer leaves the
 * task as it was last read, or unread, and says so, with Try again; a
 * later change of the task's asks again of its own accord.
 */

/** One task's items as last read, and the moment main said its latest item changed when they were asked for. */
interface Read {
  readonly at: number;
  readonly items: readonly InboxItem[];
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** What the window's Inbox lists from. */
export interface InboxItemsControl {
  /** Each task's items as last read, by task; a task not yet read is absent. */
  readonly items: ReadonlyMap<string, readonly InboxItem[]>;
  /** Whether a task's last read did not answer, so the list offers to try again. */
  readonly failed: boolean;
  /** Whether a listed plan has changed since its items were last read, and no read of it has failed: its items may be older than it. */
  readonly pending: boolean;
  /** The plans whose items are read as of main's latest word of them, or read and listed no more, so an item they do not hold is not theirs. */
  readonly current: ReadonlySet<string>;
  readonly onRetry: () => void;
}

export function useInboxItems(input: {
  /** Every task the Inbox lists, as main last read them. */
  holdings: readonly AppInboxTaskHolding[];
  readInbox: InboxReader;
}): InboxItemsControl {
  const { holdings, readInbox } = input;
  const [reads, setReads] = useState<ReadonlyMap<string, Read>>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  // The read out for each task, by the moment it asks for, so a task is asked once per change.
  const asking = useRef(new Map<string, number>());
  // The latest moment each task was asked for, so an answer to an earlier ask, landing last, is let go.
  const newest = useRef(new Map<string, number>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const latest = useRef({ readInbox, reads });
  latest.current = { readInbox, reads };

  // A retry's press asks again of the tasks whose read failed, the ones not yet read.
  useEffect(() => {
    for (const { taskId, updatedAt } of holdings) {
      if (latest.current.reads.get(taskId)?.at === updatedAt) continue;
      if (asking.current.get(taskId) === updatedAt) continue;
      asking.current.set(taskId, updatedAt);
      newest.current.set(taskId, Math.max(newest.current.get(taskId) ?? updatedAt, updatedAt));
      latest.current
        .readInbox({ taskId: taskId, after: INBOX_CURSOR_START })
        .catch((): CodingAgentInboxAnswerView => UNANSWERED)
        .then((answer) => {
          if (asking.current.get(taskId) === updatedAt) asking.current.delete(taskId);
          // Note that a superseded answer moves neither the items nor the failure, because the newer ask's answer says both.
          if (!live.current || updatedAt < (newest.current.get(taskId) ?? updatedAt)) return;
          const failure = "failure" in answer;
          setFailed((was) => {
            if (was.has(taskId) === failure) return was;
            const next = new Set(was);
            if (failure) next.add(taskId);
            else next.delete(taskId);
            return next;
          });
          if (failure) return;
          setReads((was) => new Map(was).set(taskId, { at: updatedAt, items: answer.items }));
        });
    }
  }, [holdings, attempt]);

  const onRetry = useCallback(() => {
    setFailed(new Set());
    setAttempt((count) => count + 1);
  }, []);
  const items = useMemo(
    () => new Map([...reads].map(([taskId, read]) => [taskId, read.items])),
    [reads],
  );
  // Note that only a task still listed fails the list, because one another workspace listed is not drawn.
  const pending = holdings.some(
    ({ taskId, updatedAt }) => reads.get(taskId)?.at !== updatedAt && !failed.has(taskId),
  );
  // Note that a plan main lists no more has no newer read on its way, so its last read stands.
  const current = new Set(
    [...reads].flatMap(([taskId, read]) => {
      const holding = holdings.find((each) => each.taskId === taskId);
      return holding === undefined || holding.updatedAt === read.at ? [taskId] : [];
    }),
  );
  return {
    items,
    failed: holdings.some((holding) => failed.has(holding.taskId)),
    pending,
    current,
    onRetry,
  };
}
