import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import { useMemo } from "react";
import { type InboxListed, openItems } from "./inbox-model.js";
import {
  agentHoldings,
  inboxGroups,
  taskHoldings,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * use-waiting-items.ts -- every open Inbox item of the listed workspace, a teammate's agent's among them, as Home and a person's page list what waits.
 *
 * Main's read of the account counts only what waits on its own agents, so
 * a place that lists what waits as the window's Inbox does follows each plan
 * holding an item whole, and each agent with no plan main says something
 * waits on, as the Inbox follows them. Every open item is listed, whoever
 * it waits on, since a person's page lists what waits on them; Home keeps only the reader's own
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
 * holds an item.
 */
export function useWaitingItems(tasks: TasksControl): WaitingItems {
  const { inboxTasks, tasks: listed } = tasks.listed;
  // Note that every plan holding an item is read, not only those main counts as waiting on the
  // account, because those are its own agents' alone, and the Inbox lists every member's.
  const holdings = useMemo(
    () => inboxTasks.filter((holding) => listed.some((task) => task.id === holding.taskId)),
    [inboxTasks, listed],
  );
  const read = useHolderInboxItems(
    useMemo(
      () => [...taskHoldings(holdings), ...agentHoldings(tasks.inboxAgents)],
      [holdings, tasks.inboxAgents],
    ),
  );
  const entries = inboxGroups(read.items, {
    tasks: holdings,
    listed,
    agents: tasks.inboxAgents,
    workspaceId: tasks.workspace?.id,
  });
  // Note that every open item is kept as one that waits, whoever started its agent.
  const items = openItems(entries);
  return {
    items,
    readTasks: read.current[INBOX_SCOPE_KIND.PLAN],
    readAgents: read.current[INBOX_SCOPE_KIND.AGENT],
    // Note that a listed holder not pushed as main says it stands is still being read.
    reading: read.pending,
    failed: read.failed,
    onRetry: read.onRetry,
  };
}
