import { INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { useCallback, useMemo } from "react";
import { useAct } from "../act.js";
import { useInboxCloser } from "./inbox-close.js";
import {
  INBOX_HOLDER,
  type InboxGroup,
  type InboxListed,
  type TasklessInboxAgent,
  taskHolder,
  tasklessGroups,
} from "./inbox-model.js";
import { useSettledReads } from "./inbox-settling.js";
import { useCodingAgents } from "./use-coding-agents.js";
import { useInboxItems } from "./use-inbox-items.js";
import { useInboxReadMarks } from "./use-inbox-read-marks.js";
import { useTaskInbox } from "./use-task-inbox.js";
import { useTasklessInboxItems } from "./use-taskless-inbox-items.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "./use-tasks-tab.js";

/**
 * use-inbox-listing.ts -- the threads Channels reads, by what holds them:
 * every item of every task of the listed workspace that holds one, and
 * every agent with no task that waits, and the thread chosen, read live
 * through its holder's own read.
 *
 * The window's Channels reads it for the holder behind each post of a
 * channel's stream and the thread opened beside it (`desktop-inbox.tsx`).
 */

/**
 * The tasks the list holds items of, in main's order: each holding one that
 * the listed workspace's list given holds, so one not yet read, or another
 * workspace's, is listed nowhere. Note that a task's status never leaves
 * it out: a task done or canceled is listed, its items with it.
 */
function listedHoldings(
  holdings: TasksControl["inboxTasks"],
  listed: TasksControl["tasks"],
): readonly AppInboxTaskHolding[] {
  return holdings.filter((holding) => listed.some((task) => task.id === holding.taskId));
}

/** Each task holding items as the list groups it, with its items as last read; a task the list given does not hold is left out. */
function holdingGroups(
  holdings: readonly AppInboxTaskHolding[],
  listed: TasksControl["tasks"],
  itemsOf: (taskId: string) => readonly InboxItem[] | undefined,
): InboxGroup[] {
  return holdings.flatMap((holding) => {
    const task = listed.find((each) => each.id === holding.taskId);
    if (task === undefined) return [];
    return [{ holder: taskHolder(task), items: itemsOf(holding.taskId) ?? [] }];
  });
}

/** The choice that opens a listed item: by its task, or by its agent where it has none. */
export function choiceOf({ holder, item }: InboxListed): InboxChoice {
  return holder.kind === INBOX_HOLDER.TASK
    ? { taskId: holder.task.id, itemId: item.id }
    : { agentId: item.agentId, itemId: item.id };
}

/** The threads Channels reads, and the one chosen; see the module's head. */
export function useInboxListing(tasks: TasksControl) {
  const view = tasks.inboxView;
  const { act } = useAct();
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  // Note that the Inbox reads the automations whenever it stands, because the items of agents with no task it lists are every one an automation's.
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  const { inboxTasks, tasks: listedTasks } = tasks.listed;
  const holdings = useMemo(
    () => listedHoldings(inboxTasks, listedTasks),
    [inboxTasks, listedTasks],
  );
  const read = useInboxItems({ holdings });
  const waitingTaskless = tasks.inboxTaskless;
  const tasklessReads = useTasklessInboxItems(waitingTaskless);
  // Note that the window's own answers and messages stand over the agents' reads until they hold them, so a stale read never brings an answered item back.
  const tasklessItems = useSettledReads(tasklessReads.items);
  const taskless = { ...tasklessReads, items: tasklessItems };
  const asked = view.chosen;
  const chosenTask =
    asked !== undefined && "taskId" in asked
      ? tasks.tasks.find((task) => task.id === asked.taskId)
      : undefined;
  const taskId = chosenTask?.id;
  const chosenAgentId = asked !== undefined && "agentId" in asked ? asked.agentId : undefined;
  const agents = useCodingAgents({
    acts: { act },
    taskId,
    ...(chosenAgentId === undefined ? undefined : { agentId: chosenAgentId }),
    repository: chosenTask?.repository ?? null,
    // The Inbox draws no agent's composer, so nothing here opens Settings.
    onOpenIntegrations: () => undefined,
    onOpenApiKeys: () => undefined,
    onStarted: () => undefined,
    me: tasks.me,
  });
  // Note that an agent with no task holds its own read, by its id, as a task's is held by the task's.
  const live = useTaskInbox({
    taskId: taskId ?? chosenAgentId,
    kind: chosenAgentId === undefined ? INBOX_SCOPE_KIND.PLAN : INBOX_SCOPE_KIND.AGENT,
    shown: tasks.shown,
    onScreen: taskId !== undefined && tasks.inboxShown === taskId,
    waiting:
      tasks.inbox.some((each) => each.taskId === taskId) ||
      waitingTaskless.some((each) => each.agentId === chosenAgentId),
    readerId: tasks.me,
    agents,
  });
  // Note that the models come from the open task's agents where this task's have not read them, so an agent is named alike in both.
  const named = { ...agents, models: agents.models ?? tasks.agents.models };
  // The chosen holder's own held read stands in for the list's once it answered, so an answer shows
  // at once, and only while it holds, since one that failed stops hearing what changed.
  const liveItems: readonly InboxItem[] = [...live.board.open, ...live.board.settled];
  const holdsLive = live.read && !live.failed;
  const itemsOf =
    (reads: typeof read) =>
    (each: string): readonly InboxItem[] | undefined =>
      holdsLive && each === taskId ? liveItems : reads.items.get(each);
  const taskEntries = holdingGroups(holdings, tasks.tasks, itemsOf(read));
  const tasklessRead =
    holdsLive && chosenAgentId !== undefined
      ? new Map(taskless.items).set(chosenAgentId, liveItems)
      : taskless.items;
  // An agent with no plan that a link names, none of whose items waits any longer, is grouped by its own read, which the account's list of waiting agents leaves out, in its own workspace's list alone.
  const pageAgent = agents.agents?.[0] ?? agents.archived?.[0];
  const settledAgent: TasklessInboxAgent[] =
    chosenAgentId !== undefined &&
    holdsLive &&
    pageAgent !== undefined &&
    !waitingTaskless.some((each) => each.agentId === chosenAgentId)
      ? [
          {
            agentId: pageAgent.id,
            agentTitle: pageAgent.title,
            agentModel: pageAgent.model,
            automationId: pageAgent.automationId ?? null,
            automationName: null,
            repository: "",
            ...(agents.workspaceId === undefined ? undefined : { workspaceId: agents.workspaceId }),
          },
        ]
      : [];
  // Note that every read here draws the window's own marks, answers, and messages over it already (`inbox-settling.ts`).
  const standing: readonly InboxGroup[] = [
    ...taskEntries,
    ...tasklessGroups([...waitingTaskless, ...settledAgent], tasklessRead, tasks.workspace?.id),
  ];
  // Note that every item marked read is pushed with each followed inbox, its marker among its rows, so nothing is read again.
  const marks = useInboxReadMarks({ act });
  const chosen = standing
    .flatMap(({ holder, items }) => items.map((item) => ({ holder, item })))
    .find(({ item }) => item.id === asked?.itemId);
  // Note that a chosen item whose task or agent is listed but not read yet keeps its place, because
  // it may be listed once the read lands; one whose task left the list, deleted elsewhere, gives way.
  // A holder whose agents' read answered none, or that it is not there, holds no Inbox to read;
  // one whose agents are not read yet may still hold the item, until its Inbox's own read answers.
  const holderEmpty = agents.listMissing || agents.heldIds?.length === 0;
  const agentsUnread = agents.heldIds === undefined && !agents.listFailed && !agents.listMissing;
  // Note that a plan's items read before main's latest word of it may lack the item asked for, so only a current read settles it.
  const chosenWaits =
    (taskId !== undefined &&
      !read.current.has(taskId) &&
      !live.read &&
      (holdings.some((holding) => holding.taskId === taskId) || agentsUnread)) ||
    (chosenAgentId !== undefined &&
      !taskless.current.has(chosenAgentId) &&
      !live.read &&
      !agents.listMissing);
  // Note that the holdings are filtered against the task list, so until it is read they hold nothing and prove nothing.
  const listUnread = !tasks.listRead && !tasks.listFailed;
  // An item asked for by a link or a notification that no read holds once every read has landed is
  // not there for the reader, whether it was deleted or is of a task they cannot read, and its pane
  // says so rather than giving way to the first item.
  // Note that only the asked holder's own reads are waited on, since another's that failed says nothing of this item.
  const holderRead =
    taskId !== undefined
      ? read.current.has(taskId) || live.read || holderEmpty
      : chosenAgentId !== undefined
        ? live.read || taskless.current.has(chosenAgentId) || holderEmpty
        : true;
  // Note that only a task's item waits on the task list, since an agent with no task is read apart from it.
  const missing =
    asked?.opened === true &&
    chosen === undefined &&
    !chosenWaits &&
    holderRead &&
    (chosenAgentId !== undefined || !listUnread);
  // Note that a close the agent hears may open its turn, so its agents are read again once it is taken.
  const closeItem = useInboxCloser({ act, onHeard: agents.onRetryList });
  return {
    view,
    act,
    openAutomation,
    asked,
    chosenTask,
    taskId,
    chosenAgentId,
    agents,
    live,
    named,
    marks,
    standing,
    chosen,
    missing,
    closeItem,
  };
}
