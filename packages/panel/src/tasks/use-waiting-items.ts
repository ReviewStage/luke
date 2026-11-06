import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { useMemo } from "react";
import { type InboxGroup, type InboxListed, openItems } from "./inbox-model.js";
import {
  agentHoldings,
  type HolderInboxItems,
  inboxGroups,
  taskHoldings,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";
import type { TasksControl } from "./use-tasks-tab.js";

export interface WaitingItems {
  readonly items: readonly InboxListed[];
  readonly readTasks: ReadonlySet<string>;
  readonly readAgents: ReadonlySet<string>;
  readonly reading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

function useListedInboxGroups(tasks: TasksControl): {
  readonly groups: readonly InboxGroup[];
  readonly read: HolderInboxItems;
} {
  const { inboxTasks, tasks: listed } = tasks.listed;
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
  const groups = inboxGroups(read.items, {
    tasks: holdings,
    listed,
    agents: tasks.inboxAgents,
    workspaceId: tasks.workspace?.id,
  });
  return { groups, read };
}

export function useWaitingItems(tasks: TasksControl): WaitingItems {
  const { groups, read } = useListedInboxGroups(tasks);
  const items = openItems(groups);
  return {
    items,
    readTasks: read.current[INBOX_SCOPE_KIND.PLAN],
    readAgents: read.current[INBOX_SCOPE_KIND.AGENT],
    reading: read.pending,
    failed: read.failed,
    onRetry: read.onRetry,
  };
}
