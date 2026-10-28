import { INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { searchTokens } from "@luke/ui/search-tokens";
import { useCallback, useMemo, useState } from "react";
import { useAct } from "../act.js";
import {
  type InboxViewChoices,
  useInboxTaskFolds,
  useInboxViewChoices,
} from "../desktop/folded-groups.js";
import { useInboxCloser } from "./inbox-close.js";
import {
  channelGroups,
  EVERYONES,
  INBOX_HOLDER,
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxGroup,
  type InboxListed,
  type InboxShow,
  type InboxWhose,
  inboxAgentOf,
  inboxCounts,
  listedItems,
} from "./inbox-model.js";
import { useCodingAgents } from "./use-coding-agents.js";
import { useHeldInboxList } from "./use-held-inbox-list.js";
import {
  agentHoldings,
  inboxGroups,
  taskHoldings,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";
import { useInboxReadMarks } from "./use-inbox-read-marks.js";
import { useTaskInbox } from "./use-task-inbox.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "./use-tasks-tab.js";

/**
 * use-inbox-listing.ts -- the window's Inbox read once: every item of every
 * task of the listed workspace that holds one, and every agent with no task
 * that holds one, as its list lists them under the view the developer chose, and
 * the item chosen, read live through its holder's own read.
 *
 * The window's Inbox page reads it for its list and the item beside it
 * (`desktop-inbox.tsx`).
 *
 * Its search, the words typed in the list's head, is held here too, the item
 * the pane shows keeping its place among the steps, as it does under any
 * scope (`inboxList`).
 *
 * Narrowed to a channel, it lists and counts that channel's items alone
 * (`channelGroups`), under a scope of the channel's own: All of everyone's
 * each time a channel opens, since a channel is everyone's threads on one
 * topic, and whatever the reader turns it to while that channel stays
 * shown, never kept. Its grouping, its order, and the rest of its view are
 * the Inbox's own.
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

/** A channel's own scope, as the reader last turned it while that channel stood. */
interface ChannelScope {
  readonly channelId: string;
  readonly show: InboxShow;
  readonly whose: InboxWhose;
}

/**
 * The Inbox's view choices, narrowed to a channel where one is given: its
 * scope the channel's own, All of everyone's as it opens, held only while
 * it stands; the Inbox's kept choices where none is.
 */
function useScopedChoices(channelId: string | undefined): InboxViewChoices {
  const kept = useInboxViewChoices();
  const [scope, setScope] = useState<ChannelScope | undefined>(undefined);
  // Note that a scope is forgotten once its channel is left, so the channel opens on All of everyone's again.
  if (scope !== undefined && scope.channelId !== channelId) setScope(undefined);
  if (channelId === undefined) return kept;
  const standing =
    scope?.channelId === channelId ? scope : { channelId, show: INBOX_SHOW.ALL, whose: EVERYONES };
  return {
    ...kept,
    show: standing.show,
    onShow: (show) => setScope({ ...standing, show }),
    whose: standing.whose,
    onWhose: (whose) => setScope({ ...standing, whose }),
  };
}

/** The choice that opens a listed item: by its task, and its agent, which its link names, or by its agent where it has none. */
export function choiceOf({ holder, item }: InboxListed): InboxChoice {
  return holder.kind === INBOX_HOLDER.TASK
    ? { taskId: holder.task.id, itemAgentId: item.agentId, itemId: item.id }
    : { agentId: item.agentId, itemId: item.id };
}

/**
 * The window's Inbox as it is read and listed, narrowed to `channelId`
 * where one is given, and its chosen item; see the module's head, its list
 * held still while it is shown (`use-held-inbox-list.ts`).
 */
export function useInboxListing(tasks: TasksControl, channelId?: string) {
  const view = tasks.inboxView;
  const { act } = useAct();
  const choices = useScopedChoices(channelId);
  const folds = useInboxTaskFolds();
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
  const waitingTaskless = tasks.inboxTaskless;
  const agentsHolding = tasks.inboxAgents;
  const read = useHolderInboxItems(
    useMemo(
      () => [...taskHoldings(holdings), ...agentHoldings(agentsHolding)],
      [holdings, agentsHolding],
    ),
  );
  const readTasks = read.current[INBOX_SCOPE_KIND.PLAN];
  const readAgents = read.current[INBOX_SCOPE_KIND.AGENT];
  // Note that a holder the feed holds nothing of is read for the list, but its own read may still hold an item a link names.
  const settlesTask = (id: string) =>
    readTasks.has(id) && !read.feedHoldsNothing[INBOX_SCOPE_KIND.PLAN].has(id);
  const settlesAgent = (id: string) =>
    readAgents.has(id) && !read.feedHoldsNothing[INBOX_SCOPE_KIND.AGENT].has(id);
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
  const chosenHolder =
    taskId !== undefined
      ? { kind: INBOX_SCOPE_KIND.PLAN, id: taskId }
      : chosenAgentId === undefined
        ? undefined
        : { kind: INBOX_SCOPE_KIND.AGENT, id: chosenAgentId };
  const held =
    holdsLive && chosenHolder !== undefined
      ? {
          ...read.items,
          [chosenHolder.kind]: new Map(read.items[chosenHolder.kind]).set(
            chosenHolder.id,
            liveItems,
          ),
        }
      : read.items;
  // An agent with no plan that a link names, which main does not list as holding items yet, is grouped by its own read, in its own workspace's list alone.
  const pageAgent = agents.agents?.[0] ?? agents.archived?.[0];
  const settledAgent =
    chosenAgentId !== undefined &&
    holdsLive &&
    pageAgent !== undefined &&
    !agentsHolding.some((each) => each.agentId === chosenAgentId)
      ? [
          inboxAgentOf({
            ...pageAgent,
            repository: agents.agentRepository,
            workspaceId: agents.workspaceId,
          }),
        ]
      : [];
  // Note that every read here draws the window's own marks, answers, and messages already, as the host draws them into each (`@luke/host`'s `inbox-collections.ts`).
  const everyChannel: readonly InboxGroup[] = inboxGroups(held, {
    tasks: holdings,
    listed: tasks.tasks,
    agents: [...agentsHolding, ...settledAgent],
    workspaceId: tasks.workspace?.id,
  });
  const standing =
    channelId === undefined
      ? everyChannel
      : channelGroups(everyChannel, channelId, asked?.opened === true ? asked.itemId : undefined);
  // Note that every item marked read is pushed with each followed inbox, its marker among its rows, so nothing is read again.
  const marks = useInboxReadMarks({ act, workspaceId: tasks.workspace?.id });
  // The list's search, which narrows what it lists, never what it counts.
  const [query, setQuery] = useState("");
  const search = searchTokens(query);
  const counts = inboxCounts(standing, tasks.me, choices.whose);
  const filter = {
    grouping: choices.grouping,
    show: choices.show,
    sort: choices.sort,
    whose: choices.whose,
    search,
    readerId: tasks.me,
  };
  // The rows hold what the filter lists and the chosen row they drew, while the steps keep the item the pane shows in its place,
  // both held still while the page stands.
  const { list, steps } = useHeldInboxList(
    standing,
    filter,
    asked?.itemId,
    view.open && tasks.shown,
  );
  const chosen = listedItems(steps).find(({ item }) => item.id === asked?.itemId);
  // Note that a scope leaving out every item listed is said apart from an Inbox holding none.
  const searched = search.length > 0 ? query : undefined;
  const filteredOut =
    searched === undefined &&
    listedItems(list).length === 0 &&
    (choices.show !== INBOX_SHOW.ALL || choices.whose.kind !== INBOX_WHOSE.EVERYONE) &&
    standing.some(({ items }) => items.length > 0);
  // Note that a chosen item whose task or agent is listed but not read yet keeps its place, because
  // it may be listed once the read lands; one whose task left the list, deleted elsewhere, gives way.
  // A holder whose agents' read answered none, or that it is not there, holds no Inbox to read;
  // one whose agents are not read yet may still hold the item, until its Inbox's own read answers.
  const holderEmpty = agents.listMissing || agents.heldIds?.length === 0;
  const agentsUnread = agents.heldIds === undefined && !agents.listFailed && !agents.listMissing;
  // Note that a plan's items read before main's latest word of it may lack the item asked for, so only a current read settles it.
  const chosenWaits =
    (taskId !== undefined &&
      !settlesTask(taskId) &&
      !live.read &&
      (holdings.some((holding) => holding.taskId === taskId) || agentsUnread)) ||
    (chosenAgentId !== undefined &&
      !settlesAgent(chosenAgentId) &&
      !live.read &&
      !agents.listMissing);
  // Note that the holdings are filtered against the task list, so until it is read they hold nothing and prove nothing.
  const listUnread = !tasks.listRead && !tasks.listFailed;
  const reading =
    listUnread ||
    holdings.some((holding) => !read.items[INBOX_SCOPE_KIND.PLAN].has(holding.taskId)) ||
    waitingTaskless.some((each) => !read.items[INBOX_SCOPE_KIND.AGENT].has(each.agentId));
  // An item asked for by a link or a notification that no read holds once every read has landed is
  // not there for the reader, whether it was deleted or is of a task they cannot read, and its pane
  // says so rather than standing empty.
  // Note that only the asked holder's own reads are waited on, since another's that failed says nothing of this item.
  const holderRead =
    taskId !== undefined
      ? settlesTask(taskId) || live.read || holderEmpty
      : chosenAgentId !== undefined
        ? live.read || settlesAgent(chosenAgentId) || holderEmpty
        : true;
  // Note that only a task's item waits on the task list, since an agent with no task is read apart from it.
  const missing =
    asked?.opened === true &&
    chosen === undefined &&
    !chosenWaits &&
    holderRead &&
    (chosenAgentId !== undefined || !listUnread);
  // An item opened whose holder's own read failed says so, with a way to read it again, rather than waiting on it for good,
  // since nothing reads a failed holder again by itself.
  const chosenFailed =
    asked?.opened === true &&
    chosen === undefined &&
    !missing &&
    (live.failed || (agents.listFailed && agents.heldIds === undefined));
  const { onRetry: retryLive } = live;
  const { onRetryList: retryAgents } = agents;
  const onRetryChosen = useCallback(() => {
    retryLive();
    retryAgents();
  }, [retryLive, retryAgents]);
  const { onChoose } = view;
  const choose = useCallback((listed: InboxListed) => onChoose(choiceOf(listed)), [onChoose]);
  // Note that a close the agent hears may open its turn, so its agents are read again once it is taken.
  const closeItem = useInboxCloser({ act, onHeard: agents.onRetryList });
  // Note that a task list that failed leaves the Inbox holding nothing to read, which would otherwise say it was empty.
  const failed = read.failed || tasks.listFailed;
  const onRetry = () => {
    read.onRetry();
    if (tasks.listFailed) tasks.onRetryList();
  };
  return {
    view,
    act,
    choices,
    folds,
    openAutomation,
    read,
    asked,
    chosenTask,
    taskId,
    chosenAgentId,
    agents,
    live,
    named,
    marks,
    standing,
    counts,
    list,
    steps,
    chosen,
    filteredOut,
    search: { query, onQuery: setQuery },
    searched,
    missing,
    chosenFailed,
    onRetryChosen,
    reading,
    failed,
    choose,
    closeItem,
    onRetry,
  };
}
