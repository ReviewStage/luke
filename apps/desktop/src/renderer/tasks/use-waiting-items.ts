import type { CodingAgentInboxParams } from "@luke/features/coding-agent-view";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { useTasklessInboxItems } from "@luke/panel/tasks/use-taskless-inbox-items";
import { useCallback, useMemo } from "react";
import {
  INBOX_GROUPING,
  type InboxListed,
  inboxList,
  listedItems,
  taskHolder,
  tasklessGroups,
} from "./inbox-model";
import { useSettledReads } from "./inbox-settling";
import { useInboxItems } from "./use-inbox-items";
import type { TasksControl } from "./use-tasks-tab";

/**
 * use-waiting-items.ts -- every open Inbox item of the listed workspace, a teammate's agent's among them, as Home and Factory list what waits on the developer.
 *
 * Main's read of the account counts only what waits on its own agents, so
 * a place that lists what waits as the window's Inbox does reads each plan
 * holding an item whole, and each agent with no plan main says something
 * waits on, through the Inbox's own reads. Every open item is listed, whoever
 * it waits on, since Factory counts what holds a teammate's task up and a
 * person's page what waits on them; Home keeps only the reader's own
 * (`needsReader`).
 */

/** What waits, the latest changed first; whether a read is still out or did not answer; and Retry. */
export interface WaitingItems {
  readonly items: readonly InboxListed[];
  /** The plans whose items were read as main says they stand now, which `items` speaks for whole; a plan that changed since, its read out or failed, is not among them. */
  readonly readTasks: ReadonlySet<string>;
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
    () => inboxTasks.filter((holding) => listed.some((task) => task.id === holding.taskId)),
    [inboxTasks, listed],
  );
  const read = useInboxItems({ holdings, readInbox });
  const tasklessReads = useTasklessInboxItems(tasks.inboxTaskless);
  // Note that the window's own answers and messages stand over the agents' reads until they hold them, so a stale read never brings an answered item back.
  const tasklessItems = useSettledReads(tasklessReads.items);
  const taskless = { ...tasklessReads, items: tasklessItems };
  const entries = [
    ...holdings.flatMap((holding) => {
      const task = listed.find((each) => each.id === holding.taskId);
      return task === undefined
        ? []
        : [{ holder: taskHolder(task), items: read.items.get(holding.taskId) ?? [] }];
    }),
    ...tasklessGroups(tasks.inboxTaskless, taskless.items, tasks.workspace?.id),
  ];
  // Note that no reader is named, so every open item is kept as one that waits, whoever started its agent.
  const items = listedItems(
    inboxList(entries, {
      grouping: INBOX_GROUPING.NEWEST,
      waitingOnly: true,
      chosen: undefined,
      readerId: undefined,
    }),
  );
  // Note that a plan read before it last changed is still being read, because a retry's newer read may yet answer what the older one did not hold.
  const reading =
    read.pending || tasks.inboxTaskless.some((each) => !taskless.items.has(each.agentId));
  const onRetry = () => {
    read.onRetry();
    taskless.onRetry();
  };
  return {
    items,
    readTasks: read.current,
    readAgents: taskless.current,
    reading,
    failed: read.failed || taskless.failed,
    onRetry,
  };
}
