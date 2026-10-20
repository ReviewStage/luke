import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxParams,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { useCallback, useEffect, useMemo } from "react";
import { useAct } from "../act.js";
import { useInboxTaskFolds, useInboxViewChoices } from "../desktop/folded-groups.js";
import { useInboxCloser } from "./inbox-close.js";
import {
  EVERYONES,
  firstChoice,
  INBOX_GROUPING,
  INBOX_HOLDER,
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxGroup,
  type InboxListed,
  inboxCounts,
  inboxList,
  listedItems,
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
 * use-inbox-listing.ts -- the window's Inbox read once: every item of every
 * task of the listed workspace that holds one, and every agent with no task
 * that waits, as its list lists them under the view the developer chose, and
 * the item chosen, read live through its holder's own read.
 *
 * The window's Inbox page reads it for its list and the item beside it
 * (`desktop-inbox.tsx`). While the account has the inbox-first sidebar on,
 * the shell reads it once and hands it to both the sidebar, which lists the
 * items, and the Inbox page, which then shows the chosen item alone, so the
 * two never read or choose apart. Note that the list's reads stand as long
 * as it is read, so a sidebar that lists it reads every task holding items
 * while it is on screen, where the page read them only while it stood.
 */

/**
 * The tasks the list holds items of, in main's order: each holding one that
 * the listed workspace's list given holds, so one not yet read, or another
 * workspace's, is listed nowhere. Handed the standing tasks, an archived
 * one is listed nowhere either; handed the archived ones, it is what the
 * Archived tab lists.
 */
function listedHoldings(
  holdings: TasksControl["inboxTasks"],
  listed: TasksControl["tasks"],
): readonly AppInboxTaskHolding[] {
  return holdings.filter((holding) => listed.some((task) => task.id === holding.taskId));
}

/** No task's items are read for the Archived tab while it is not shown. */
const NO_HOLDINGS: readonly AppInboxTaskHolding[] = [];

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

/** No agent with no task is read while the listing reads nothing. */
const NO_TASKLESS: TasksControl["inboxTaskless"] = [];

/**
 * The window's Inbox as it is read and listed, and its chosen item; see the
 * module's head. Where it is not `enabled` it reads nothing, lists nothing,
 * and chooses nothing, so a shell that always calls it costs nothing while
 * the inbox-first sidebar is off.
 */
export function useInboxListing(tasks: TasksControl, enabled = true) {
  const view = tasks.inboxView;
  const { act } = useAct();
  const choices = useInboxViewChoices();
  const folds = useInboxTaskFolds();
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  // Note that the Inbox reads the automations whenever it stands, because the items of agents with no task it lists are every one an automation's.
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  const readInbox = useCallback(
    (params: CodingAgentInboxParams) => act(ACT_KIND.CODING_AGENTS_INBOX, params),
    [act],
  );
  const { inboxTasks, tasks: listedTasks, archived: listedArchived } = tasks.listed;
  const holdings = useMemo(
    () => (enabled ? listedHoldings(inboxTasks, listedTasks) : NO_HOLDINGS),
    [enabled, inboxTasks, listedTasks],
  );
  const archivedHoldings = useMemo(
    () => (enabled ? listedHoldings(inboxTasks, listedArchived) : NO_HOLDINGS),
    [enabled, inboxTasks, listedArchived],
  );
  const read = useInboxItems({ holdings, readInbox });
  // Note that the archived tasks' items are read only while the Archived tab is shown, since nothing in them waits on anyone.
  const showArchived = choices.show === INBOX_SHOW.ARCHIVED;
  const archivedRead = useInboxItems({
    holdings: showArchived ? archivedHoldings : NO_HOLDINGS,
    readInbox,
  });
  const waitingTaskless = enabled ? tasks.inboxTaskless : NO_TASKLESS;
  const tasklessReads = useTasklessInboxItems(waitingTaskless);
  // Note that the window's own answers and messages stand over the agents' reads until they hold them, so a stale read never brings an answered item back.
  const tasklessItems = useSettledReads(tasklessReads.items);
  const taskless = { ...tasklessReads, items: tasklessItems };
  const asked = enabled ? view.chosen : undefined;
  const chosenTask =
    asked !== undefined && "taskId" in asked
      ? (tasks.tasks.find((task) => task.id === asked.taskId) ??
        tasks.archived.find((task) => task.id === asked.taskId))
      : undefined;
  // The chosen task's items are read with the archived tasks' while it is archived, with the rest's otherwise.
  const chosenArchived = chosenTask?.archivedAt !== undefined;
  const chosenRead = chosenArchived ? archivedRead : read;
  const chosenHoldings = chosenArchived ? archivedHoldings : holdings;
  const taskId = chosenTask?.id;
  const chosenAgentId = asked !== undefined && "agentId" in asked ? asked.agentId : undefined;
  const agents = useCodingAgents({
    acts: { act },
    taskId,
    ...(chosenAgentId === undefined ? undefined : { agentId: chosenAgentId }),
    repository: chosenTask?.repository ?? null,
    archived: false,
    onUnarchive: () => undefined,
    // The Inbox draws no agent's composer, so nothing here opens Settings.
    onOpenIntegrations: () => undefined,
    onOpenApiKeys: () => undefined,
    onStarted: () => undefined,
    me: tasks.me,
  });
  const readAgentInbox = useCallback(
    (after: string) =>
      chosenAgentId === undefined
        ? Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const)
        : act(ACT_KIND.CODING_AGENTS_AGENT_INBOX, { agentId: chosenAgentId, after }),
    [act, chosenAgentId],
  );
  // Note that an agent with no task holds its own read, by its id, as a task's is held by the task's.
  const live = useTaskInbox({
    taskId: taskId ?? chosenAgentId,
    ...(chosenAgentId === undefined ? undefined : { reader: readAgentInbox }),
    shown: tasks.shown,
    waiting:
      tasks.inbox.some((each) => each.taskId === taskId) ||
      waitingTaskless.some((each) => each.agentId === chosenAgentId),
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
  const archivedEntries = holdingGroups(archivedHoldings, tasks.archived, itemsOf(archivedRead));
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
  const { onReread: rereadTasks } = read;
  const { onReread: rereadTaskless } = taskless;
  // Note that every item marked read moves nothing main hears of, so the Inbox reads its items again once the service took it.
  const marks = useInboxReadMarks({
    act,
    workspaceId: tasks.workspace?.id,
    onMarkedAll: () => {
      rereadTasks();
      rereadTaskless();
    },
  });
  // Note that every read here draws the window's own marks, answers, and messages over it already (`inbox-settling.ts`).
  // The archived tasks' items stand on the Archived tab alone, which counts what main says each holds whether or not it is read yet.
  const standing: readonly InboxGroup[] = [
    ...taskEntries,
    ...tasklessGroups([...waitingTaskless, ...settledAgent], tasklessRead, tasks.workspace?.id),
  ];
  const entries = showArchived ? archivedEntries : standing;
  const archivedCount = archivedHoldings.reduce((total, holding) => total + holding.items, 0);
  const counts = {
    ...inboxCounts(standing, tasks.me, choices.whose),
    [INBOX_SHOW.ARCHIVED]: archivedCount,
  };
  // Note that the Archived tab lists every archived item, whoever's, as main's count of them does, and
  // groups by task where Status is chosen, since nothing in it needs anyone or waits on anyone.
  const filter = {
    grouping:
      showArchived && choices.grouping === INBOX_GROUPING.STATUS
        ? INBOX_GROUPING.TASK
        : choices.grouping,
    show: choices.show,
    sort: choices.sort,
    whose: showArchived ? EVERYONES : choices.whose,
    readerId: tasks.me,
  };
  // The rows hold what the filter lists alone, while the steps keep the item the pane shows in its place.
  const list = inboxList(entries, { ...filter, chosen: undefined });
  const steps = inboxList(entries, { ...filter, chosen: asked?.itemId });
  const chosen = listedItems(steps).find(({ item }) => item.id === asked?.itemId);
  // Note that a tab leaving out every item listed is said apart from an Inbox holding none, the
  // archived tasks' items among what another tab would list.
  const holdsItems = (groups: readonly InboxGroup[]) =>
    groups.some(({ items }) => items.length > 0);
  const filteredOut =
    listedItems(list).length === 0 &&
    (showArchived
      ? holdsItems(standing)
      : ((choices.show !== INBOX_SHOW.ALL || choices.whose.kind !== INBOX_WHOSE.EVERYONE) &&
          holdsItems(standing)) ||
        archivedCount > 0);
  // Note that a chosen item whose task or agent is listed but not read yet keeps its place, because
  // it may be listed once the read lands; one whose task left the list, archived elsewhere, gives way.
  // A holder whose agents' read answered none, or that it is not there, holds no Inbox to read;
  // one whose agents are not read yet may still hold the item, until its Inbox's own read answers.
  const holderEmpty = agents.listMissing || agents.heldIds?.length === 0;
  const agentsUnread = agents.heldIds === undefined && !agents.listFailed && !agents.listMissing;
  // Note that a plan's items read before main's latest word of it may lack the item asked for, so only a current read settles it.
  const chosenWaits =
    (taskId !== undefined &&
      !chosenRead.current.has(taskId) &&
      !live.read &&
      (chosenHoldings.some((holding) => holding.taskId === taskId) || agentsUnread)) ||
    (chosenAgentId !== undefined &&
      !taskless.current.has(chosenAgentId) &&
      !live.read &&
      !agents.listMissing);
  // Note that the holdings are filtered against the task list, so until it is read they hold nothing and prove nothing.
  const listUnread = !tasks.listRead && !tasks.listFailed;
  const reading =
    listUnread ||
    (showArchived
      ? archivedHoldings.some((holding) => !archivedRead.items.has(holding.taskId))
      : holdings.some((holding) => !read.items.has(holding.taskId)) ||
        waitingTaskless.some((each) => !taskless.items.has(each.agentId)));
  // An item asked for by a link or a notification that no read holds once every read has landed is
  // not there for the reader, whether it was deleted or is of a task they cannot read, and its pane
  // says so rather than giving way to the first item.
  // Note that only the asked holder's own reads are waited on, since another's that failed says nothing of this item.
  const holderRead =
    taskId !== undefined
      ? chosenRead.current.has(taskId) || live.read || holderEmpty
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
  // Note that an item a link or a notification asked for is never given way to, found or not, and that only an Inbox standing has an item to stand in.
  const standIn =
    view.open && chosen === undefined && !chosenWaits && !missing && asked?.opened !== true
      ? firstChoice(list)
      : undefined;
  // An item a link or a notification asked for on an archived task is shown on the Archived tab, the one that lists it.
  const { onShow } = choices;
  const opensArchived = asked?.opened === true && chosenArchived && !showArchived;
  useEffect(() => {
    if (opensArchived) onShow(INBOX_SHOW.ARCHIVED);
  }, [opensArchived, onShow]);
  const { onChoose } = view;
  const choose = useCallback((listed: InboxListed) => onChoose(choiceOf(listed)), [onChoose]);
  useEffect(() => {
    if (standIn !== undefined) choose(standIn);
  }, [standIn, choose]);
  // Note that a close the agent hears may open its turn, so its agents are read again once it is taken.
  const closeItem = useInboxCloser({ act, onHeard: agents.onRetryList });
  const onRetry = () => {
    read.onRetry();
    archivedRead.onRetry();
    taskless.onRetry();
  };
  return {
    view,
    act,
    choices,
    folds,
    openAutomation,
    read,
    archivedRead,
    taskless,
    showArchived,
    asked,
    chosenTask,
    chosenArchived,
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
    missing,
    reading,
    choose,
    closeItem,
    onRetry,
  };
}

/** The window's Inbox as `useInboxListing` reads it. */
export type InboxListing = ReturnType<typeof useInboxListing>;
