/**
 * use-inbox-search.ts -- the listed workspace's Inbox as ⌘K searches it: every item of every standing task holding one, and of every agent with no task something waits on, read only while a search asks for them.
 *
 * The palette reads the same followed inboxes the window's Inbox lists
 * (`use-inbox-items.ts`, `use-taskless-inbox-items.ts`), so an item found
 * is the item the Inbox opens. Note that nothing is followed until a search
 * asks, because most uses of the palette never look in the Inbox, and that
 * the items pushed are kept once it stops asking, so the next search shows
 * them at once while their follows come back. The archived tasks' items are
 * left out, as every Inbox scope but Archived leaves them out.
 */

import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { useMemo } from "react";
import {
  type InboxGroup,
  type InboxListed,
  needsYou,
  taskHolder,
  tasklessGroups,
} from "./inbox-model.js";
import { useSettledReads } from "./inbox-settling.js";
import { useInboxItems } from "./use-inbox-items.js";
import { useTasklessInboxItems } from "./use-taskless-inbox-items.js";
import type { TasksControl } from "./use-tasks-tab.js";

/** What a search finds in the Inbox: its items, what needs the reader first, then the latest changed; and how far their read has come. */
export interface InboxSearch {
  readonly items: readonly InboxListed[];
  /** Whether an inbox the search asked for has not been pushed yet. */
  readonly reading: boolean;
  /** Whether an inbox the search asked for could not be read. */
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** No task's items are followed while no search asks. */
const NO_HOLDINGS: readonly AppInboxTaskHolding[] = [];

/** No agent with no task is followed while no search asks. */
const NO_TASKLESS: TasksControl["inboxTaskless"] = [];

/** Every item the groups hold, the reader's waiting ones first, then the latest changed first. */
function searchOrder(groups: readonly InboxGroup[], readerId: string | undefined): InboxListed[] {
  const listed = groups.flatMap(({ holder, items }) => items.map((item) => ({ holder, item })));
  return listed.toSorted(
    (first, second) =>
      Number(needsYou(second, readerId)) - Number(needsYou(first, readerId)) ||
      second.item.updatedAt - first.item.updatedAt,
  );
}

/** The listed workspace's Inbox, followed while `asked`; see the module's head. */
export function useInboxSearch(tasks: TasksControl, asked: boolean): InboxSearch {
  const { inboxTasks, tasks: standing } = tasks.listed;
  const holdings = useMemo(
    () =>
      asked
        ? inboxTasks.filter((holding) => standing.some((task) => task.id === holding.taskId))
        : NO_HOLDINGS,
    [asked, inboxTasks, standing],
  );
  const read = useInboxItems({ holdings });
  const waiting = asked ? tasks.inboxTaskless : NO_TASKLESS;
  const taskless = useTasklessInboxItems(waiting);
  // Note that the window's own answers stand over a push until it holds them, as the Inbox draws them.
  const tasklessItems = useSettledReads(taskless.items);
  const workspaceId = tasks.workspace?.id;
  const items = useMemo(() => {
    const taskGroups = holdings.flatMap((holding) => {
      const task = standing.find((each) => each.id === holding.taskId);
      const held = read.items.get(holding.taskId);
      return task === undefined || held === undefined
        ? []
        : [{ holder: taskHolder(task), items: held }];
    });
    const groups = [...taskGroups, ...tasklessGroups(waiting, tasklessItems, workspaceId)];
    return searchOrder(groups, tasks.me);
  }, [holdings, standing, read.items, waiting, tasklessItems, workspaceId, tasks.me]);
  // Note that an inbox counts as read only once its push holds what main says it now holds, since an older push kept from the last search may lack the item sought.
  const reading =
    read.pending ||
    (!taskless.failed && waiting.some((each) => !taskless.current.has(each.agentId)));
  const { onRetry: retryTasks } = read;
  const { onRetry: retryTaskless } = taskless;
  return {
    items,
    reading,
    failed: read.failed || taskless.failed,
    onRetry: () => {
      retryTasks();
      retryTaskless();
    },
  };
}
