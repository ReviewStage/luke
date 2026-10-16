import type { CodingAgentInboxParams } from "@luke/features/coding-agent-view";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useMemo } from "react";
import { useAct } from "../act";
import {
  INBOX_GROUPING,
  type InboxListed,
  inboxList,
  listedItems,
  taskHolder,
  tasklessGroups,
} from "./inbox-model";
import { useInboxItems } from "./use-inbox-items";
import { useTasklessInboxItems } from "./use-taskless-inbox-items";
import type { TasksControl } from "./use-tasks-tab";

/**
 * use-waiting-items.ts -- every open Inbox item of the listed workspace, a teammate's agent's among them, as Home and Factory list what waits on the developer.
 *
 * Main's read of the account counts only what waits on its own agents, so
 * a place that lists what waits as the window's Inbox does reads each plan
 * holding an item whole, and each agent with no plan main says something
 * waits on, through the Inbox's own reads.
 */

/** What waits, the latest changed first; whether a read is still out or did not answer; and Retry. */
export interface WaitingItems {
  readonly items: readonly InboxListed[];
  /** The plans whose items were read as main says they stand now, which `items` speaks for whole; a plan that changed since, its read out or failed, is not among them. */
  readonly readPlans: ReadonlySet<string>;
  /** The agents with no plan whose items were read as main says they stand now, which `items` speaks for whole. */
  readonly readAgents: ReadonlySet<string>;
  readonly reading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/**
 * Every open Inbox item of the listed workspace's plans, and of its agents
 * with no plan, the latest changed first, read as the window's Inbox reads
 * them: each plan main says holds an item and the listed workspace's list
 * holds, read whole, a teammate's agent's items among them, as every
 * member's Inbox lists them, and each agent with no plan main says
 * something waits on.
 */
export function useWaitingItems(tasks: TasksControl): WaitingItems {
  const { act } = useAct();
  const readInbox = useCallback(
    (params: CodingAgentInboxParams) => act(ACT_KIND.CODING_AGENTS_INBOX, params),
    [act],
  );
  const { inboxTasks, tasks: listed } = tasks.listed;
  // Note that every plan holding an item is read, not only those main counts as waiting on the
  // account, because those are its own agents' alone, and the Inbox lists every member's.
  const holdings = useMemo(
    () => inboxTasks.filter((holding) => listed.some((plan) => plan.id === holding.taskId)),
    [inboxTasks, listed],
  );
  const read = useInboxItems({ holdings, readInbox });
  const planless = useTasklessInboxItems(tasks.inboxTaskless);
  const entries = [
    ...holdings.flatMap((holding) => {
      const plan = listed.find((each) => each.id === holding.taskId);
      return plan === undefined
        ? []
        : [{ holder: taskHolder(plan), items: read.items.get(holding.taskId) ?? [] }];
    }),
    ...tasklessGroups(tasks.inboxTaskless, planless.items, tasks.workspace?.id),
  ];
  const items = listedItems(
    inboxList(entries, { grouping: INBOX_GROUPING.NEWEST, waitingOnly: true, chosen: undefined }),
  );
  // Note that a plan read before it last changed is still being read, because a retry's newer read may yet answer what the older one did not hold.
  const reading =
    read.pending || tasks.inboxTaskless.some((each) => !planless.items.has(each.agentId));
  const onRetry = () => {
    read.onRetry();
    planless.onRetry();
  };
  return {
    items,
    readPlans: read.current,
    readAgents: planless.current,
    reading,
    failed: read.failed || planless.failed,
    onRetry,
  };
}
