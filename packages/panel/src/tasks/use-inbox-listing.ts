import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { InboxItem } from "@repo/features/inbox-wire";
import type { AppInboxTaskHolding } from "@repo/host/app-state";
import { useMinute } from "@repo/ui";
import { searchTokens } from "@repo/ui/search-tokens";
import { useCallback, useMemo, useRef, useState } from "react";
import { afterPaint } from "../after-paint.js";
import { useInboxViewChoices } from "../desktop/folded-groups.js";
import { useInboxCloser } from "./inbox-close.js";
import {
  EVERYONES,
  INBOX_HOLDER,
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxGroup,
  type InboxListed,
  inboxAgentOf,
  inboxAtNow,
  inboxCounts,
  listedItems,
  taskGroups,
} from "./inbox-model.js";
import { useAgents } from "./use-agents.js";
import { useHeldInboxList } from "./use-held-inbox-list.js";
import {
  agentHoldings,
  inboxGroups,
  taskHoldings,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";
import { useInboxReadMarks } from "./use-inbox-read-marks.js";
import { useHeldTaskInbox, useInboxDraftsLetGo } from "./use-task-inbox.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "./use-tasks-tab.js";

const TASK_LISTS = { show: INBOX_SHOW.ALL, whose: EVERYONES } as const;

function listedHoldings(
  holdings: TasksControl["inboxTasks"],
  listed: TasksControl["tasks"],
): readonly AppInboxTaskHolding[] {
  const ids = new Set(listed.map((task) => task.id));
  return holdings.filter((holding) => ids.has(holding.taskId));
}

export function choiceOf({ holder, item }: InboxListed): InboxChoice {
  return holder.kind === INBOX_HOLDER.TASK
    ? { taskId: holder.task.id, itemAgentId: item.agentId, itemId: item.id }
    : { agentId: item.agentId, itemId: item.id };
}

interface ChoiceOnItsWay {
  readonly choice: InboxChoice;
  readonly over: InboxChoice | undefined;
}

function unmoved(
  way: ChoiceOnItsWay,
  now: InboxChoice | undefined,
  handed: WeakSet<InboxChoice>,
): boolean {
  return now === way.over || (now !== undefined && handed.has(now));
}

function useChoiceFirst(
  chosen: InboxChoice | undefined,
  onChoose: (chosen: InboxChoice) => void,
  onClear: () => void,
): {
  readonly chosen: InboxChoice | undefined;
  readonly settling: boolean;
  readonly choose: (chosen: InboxChoice) => void;
  readonly clear: () => void;
} {
  const [held, setHeld] = useState<readonly ChoiceOnItsWay[]>([]);
  const latest = useRef({ chosen, onChoose, onClear });
  latest.current = { chosen, onChoose, onClear };
  const waiting = useRef(new Set<ChoiceOnItsWay>());
  const handed = useRef(new WeakSet<InboxChoice>());
  const choose = useCallback((choice: InboxChoice) => {
    const way: ChoiceOnItsWay = { choice, over: latest.current.chosen };
    waiting.current.add(way);
    setHeld((was) => [...was, way]);
    afterPaint(() => {
      if (!waiting.current.delete(way)) return;
      if (unmoved(way, latest.current.chosen, handed.current)) {
        handed.current.add(choice);
        latest.current.onChoose(choice);
      }
      setHeld((was) => was.filter((each) => each !== way));
    });
  }, []);
  const clear = useCallback(() => {
    waiting.current.clear();
    setHeld([]);
    latest.current.onClear();
  }, []);
  const newest = held.at(-1);
  const stands = newest !== undefined && unmoved(newest, chosen, handed.current);
  return { chosen: stands ? newest.choice : chosen, settling: stands, choose, clear };
}

export function useInboxListing(tasks: TasksControl, narrowedTask?: string) {
  const view = tasks.inboxView;
  const choices = useInboxViewChoices();
  const { onOpen: onOpenAutomations } = tasks.automationsView;
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
  const settlesTask = (id: string) =>
    readTasks.has(id) && !read.feedHoldsNothing[INBOX_SCOPE_KIND.PLAN].has(id);
  const settlesAgent = (id: string) =>
    readAgents.has(id) && !read.feedHoldsNothing[INBOX_SCOPE_KIND.AGENT].has(id);
  const { onChoose, onClear } = view;
  const {
    chosen: asked,
    settling,
    choose: chooseFirst,
    clear,
  } = useChoiceFirst(view.chosen, onChoose, onClear);
  const chosenTask =
    asked !== undefined && "taskId" in asked
      ? tasks.tasks.find((task) => task.id === asked.taskId)
      : undefined;
  const taskId = chosenTask?.id;
  const chosenAgentId = asked !== undefined && "agentId" in asked ? asked.agentId : undefined;
  const { liveAgents } = tasks;
  const listedPage = useMemo(
    () =>
      chosenAgentId === undefined
        ? undefined
        : liveAgents?.find((agent) => agent.id === chosenAgentId),
    [chosenAgentId, liveAgents],
  );
  const agents = useAgents({
    taskId,
    ...(chosenAgentId === undefined ? undefined : { agentId: chosenAgentId }),
    repository: chosenTask?.repository ?? null,
    listedAgents: liveAgents,
    listedPage,
    list: { read: tasks.listRead, failed: tasks.listFailed, onRetry: tasks.onRetryList },
    listedPullRequests: tasks.listedPullRequests,
    onOpenIntegrations: () => undefined,
    onOpenApiKeys: () => undefined,
    onStarted: () => undefined,
    me: tasks.me,
  });
  const liveScope = {
    taskId: taskId ?? chosenAgentId,
    kind: chosenAgentId === undefined ? INBOX_SCOPE_KIND.PLAN : INBOX_SCOPE_KIND.AGENT,
  };
  const live = useHeldTaskInbox({
    ...liveScope,
    shown: tasks.shown,
    onScreen: taskId !== undefined && tasks.inboxShown === taskId,
    waiting:
      tasks.inbox.some((each) => each.taskId === taskId) ||
      waitingTaskless.some((each) => each.agentId === chosenAgentId),
    readerId: tasks.me,
    agents,
  });
  useInboxDraftsLetGo(live, liveScope);
  const named = { ...agents, models: agents.models ?? tasks.agents.models };
  const liveBoard = live.board;
  const liveItems = useMemo(
    (): readonly InboxItem[] => [...liveBoard.open, ...liveBoard.settled],
    [liveBoard],
  );
  const holdsLive = live.read && !live.failed;
  const liveKind = taskId !== undefined ? INBOX_SCOPE_KIND.PLAN : INBOX_SCOPE_KIND.AGENT;
  const liveId = holdsLive ? (taskId ?? chosenAgentId) : undefined;
  const readItems = read.items;
  const held = useMemo(
    () =>
      liveId === undefined
        ? readItems
        : {
            ...readItems,
            [liveKind]: new Map(readItems[liveKind]).set(liveId, liveItems),
          },
    [readItems, liveKind, liveId, liveItems],
  );
  const pageAgent = agents.agents?.[0] ?? agents.archived?.[0];
  const settles =
    chosenAgentId !== undefined &&
    holdsLive &&
    pageAgent !== undefined &&
    !agentsHolding.some((each) => each.agentId === chosenAgentId);
  const { agentRepository, workspaceId: agentWorkspace } = agents;
  const holdingAgents = useMemo(
    () =>
      settles && pageAgent !== undefined
        ? [
            ...agentsHolding,
            inboxAgentOf({
              ...pageAgent,
              repository: agentRepository,
              workspaceId: agentWorkspace,
            }),
          ]
        : agentsHolding,
    [settles, pageAgent, agentsHolding, agentRepository, agentWorkspace],
  );
  const everyTask = tasks.tasks;
  const listedWorkspace = tasks.workspace?.id;
  const everyItem: readonly InboxGroup[] = useMemo(
    () =>
      inboxGroups(held, {
        tasks: holdings,
        listed: everyTask,
        agents: holdingAgents,
        workspaceId: listedWorkspace,
      }),
    [held, holdings, everyTask, holdingAgents, listedWorkspace],
  );
  const now = useMinute();
  const standing = useMemo(
    () =>
      inboxAtNow(narrowedTask === undefined ? everyItem : taskGroups(everyItem, narrowedTask), now),
    [everyItem, narrowedTask, now],
  );
  const marks = useInboxReadMarks({ workspaceId: tasks.workspace?.id });
  const [query, setQuery] = useState("");
  const search = useMemo(() => searchTokens(query), [query]);
  const me = tasks.me;
  const { show, whose } = narrowedTask === undefined ? choices : TASK_LISTS;
  const counts = useMemo(() => inboxCounts(standing, me, whose), [standing, me, whose]);
  const filter = useMemo(() => ({ show, whose, search, readerId: me }), [show, whose, search, me]);
  const { list, steps, onPointing } = useHeldInboxList(
    standing,
    filter,
    asked?.itemId,
    view.open && tasks.shown,
  );
  const listedRows = useMemo(() => listedItems(list), [list]);
  const askedId = asked?.itemId;
  const chosen = useMemo(
    () => listedItems(steps).find(({ item }) => item.id === askedId),
    [steps, askedId],
  );
  const searched = search.length > 0 ? query : undefined;
  const filteredOut =
    searched === undefined &&
    listedRows.length === 0 &&
    (show !== INBOX_SHOW.ALL || whose.kind !== INBOX_WHOSE.EVERYONE) &&
    standing.some(({ items }) => items.length > 0);
  const holderEmpty = agents.listMissing || agents.heldIds?.length === 0;
  const agentsUnread = agents.heldIds === undefined && !agents.listFailed && !agents.listMissing;
  const chosenWaits =
    (taskId !== undefined &&
      !settlesTask(taskId) &&
      !live.read &&
      (holdings.some((holding) => holding.taskId === taskId) || agentsUnread)) ||
    (chosenAgentId !== undefined &&
      !settlesAgent(chosenAgentId) &&
      !live.read &&
      !agents.listMissing);
  const listUnread = !tasks.listRead && !tasks.listFailed;
  const reading =
    listUnread ||
    holdings.some((holding) => !read.items[INBOX_SCOPE_KIND.PLAN].has(holding.taskId)) ||
    waitingTaskless.some((each) => !read.items[INBOX_SCOPE_KIND.AGENT].has(each.agentId));
  const holderRead =
    taskId !== undefined
      ? settlesTask(taskId) || live.read || holderEmpty
      : chosenAgentId !== undefined
        ? live.read || settlesAgent(chosenAgentId) || holderEmpty
        : true;
  const missing =
    asked?.opened === true &&
    chosen === undefined &&
    !chosenWaits &&
    holderRead &&
    (chosenAgentId !== undefined || !listUnread);
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
  const choose = useCallback((listed: InboxListed) => chooseFirst(choiceOf(listed)), [chooseFirst]);
  const closeItem = useInboxCloser();
  const failed = read.failed || tasks.listFailed;
  const onRetry = () => {
    read.onRetry();
    if (tasks.listFailed) tasks.onRetryList();
  };
  return {
    view,
    choices,
    openAutomation,
    read,
    asked,
    settling,
    chosenTask,
    taskId,
    chosenAgentId,
    agents,
    live,
    liveScope,
    named,
    marks,
    standing,
    counts,
    list,
    listedRows,
    steps,
    onPointing,
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
    clear,
    closeItem,
    onRetry,
  };
}
