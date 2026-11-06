import { useMemo } from "react";
import { type InboxGroup, type InboxListed, needsYou } from "./inbox-model.js";
import {
  agentHoldings,
  inboxGroups,
  NO_HOLDINGS,
  taskHoldings,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";
import type { TasksControl } from "./use-tasks-tab.js";

export interface InboxSearch {
  readonly items: readonly InboxListed[];
  readonly reading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

function searchOrder(groups: readonly InboxGroup[], readerId: string | undefined): InboxListed[] {
  const listed = groups.flatMap(({ holder, items }) => items.map((item) => ({ holder, item })));
  return listed.toSorted(
    (first, second) =>
      Number(needsYou(second, readerId)) - Number(needsYou(first, readerId)) ||
      second.item.updatedAt - first.item.updatedAt,
  );
}

export function useInboxSearch(tasks: TasksControl, asked: boolean): InboxSearch {
  const { inboxTasks, tasks: standing } = tasks.listed;
  const agents = tasks.inboxAgents;
  const holdings = useMemo(
    () =>
      asked
        ? [
            ...taskHoldings(
              inboxTasks.filter((holding) => standing.some((task) => task.id === holding.taskId)),
            ),
            ...agentHoldings(agents),
          ]
        : NO_HOLDINGS,
    [asked, inboxTasks, standing, agents],
  );
  const read = useHolderInboxItems(holdings);
  const workspaceId = tasks.workspace?.id;
  const items = useMemo(() => {
    const groups = asked
      ? inboxGroups(read.items, {
          tasks: inboxTasks,
          listed: standing,
          agents,
          workspaceId,
        })
      : [];
    return searchOrder(groups, tasks.me);
  }, [asked, inboxTasks, standing, read.items, agents, workspaceId, tasks.me]);
  const reading = read.pending;
  const { onRetry } = read;
  return { items, reading, failed: read.failed, onRetry };
}
