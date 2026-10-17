import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import type { AppInboxTask, AppInboxWaitingItem } from "@luke/host/app-state";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { agentStillWriting } from "../tasks/coding-agent-model";
import { INBOX_HOLDER, type InboxListed } from "../tasks/inbox-model";

/**
 * factory-model.ts -- what the Factory tab draws: the task on a call with Luke, the agents building tasks, and what ships, each station leading with what waits on the developer, from the plan list, main's Inbox read, and the call.
 *
 * Factory is a live view, not a report: it holds no totals, only where work
 * stands now and what moved in the last day. Talk holds the task on this
 * Mac's call with Luke, being talked through. Build lists each agent still
 * at work with its task, each agent with no task (one an automation started,
 * by its automation's name) the same way, and each pull request still in
 * checks or a draft;
 * it leads with what stops an agent until the developer acts, the Inbox's
 * open items, every member's as the Inbox lists them, and the agents whose
 * turn failed in the last day. Ship lists
 * the pull requests merged in the last day, and leads with what stops a
 * merge: failing checks, then pull requests ready to merge, since nothing
 * merges without the developer. The wire carries no merge instant, so a
 * pull request's time is its task's last activity. Every list is read from what the
 * window already holds; nothing here fetches. Note that the list's row names
 * at most three agents and three pull requests (`PLAN_AGENTS_BOUNDS`), at
 * work and open ones first, so a plan with more shows the ones its row names.
 */

/** The steps of the line, left to right. */
export const FACTORY_STEP = {
  TALK: "talk",
  BUILD: "build",
  SHIP: "ship",
} as const;

export type FactoryStep = (typeof FACTORY_STEP)[keyof typeof FACTORY_STEP];

/** How far back Factory looks: an agent whose turn failed still waits on the developer, and a merged pull request still stands in Ship, for a day. */
export const LOOKBACK_MS = 24 * 3_600_000;

/** What Build lists of the work going on: an agent at work, or a pull request still in checks or a draft. */
export const FACTORY_WORK = {
  AGENT: "agent",
  PULL_REQUEST: "pull-request",
  /** An agent with no task at work, one an automation or a hand started on its own. */
  ONE_OFF: "one-off",
} as const;

export type FactoryWork =
  | {
      readonly kind: typeof FACTORY_WORK.AGENT;
      readonly plan: TaskSummary;
      readonly agent: TaskAgentLine;
    }
  | {
      readonly kind: typeof FACTORY_WORK.PULL_REQUEST;
      readonly plan: TaskSummary;
      readonly pullRequest: TaskPullRequestLine;
    }
  | { readonly kind: typeof FACTORY_WORK.ONE_OFF; readonly agent: TasklessAgent };

/** What stops an agent until the developer acts: an open Inbox item it posted, or its failed turn. */
export const FACTORY_STOP = {
  QUESTION: "question",
  FAILED: "failed",
  /** An open item an agent with no task posted. */
  ONE_OFF_QUESTION: "one-off-question",
  /** An agent with no task whose turn failed. */
  ONE_OFF_FAILED: "one-off-failed",
} as const;

export type FactoryStop =
  | {
      readonly kind: typeof FACTORY_STOP.QUESTION;
      readonly plan: TaskSummary;
      readonly item: AppInboxWaitingItem;
    }
  | {
      readonly kind: typeof FACTORY_STOP.FAILED;
      readonly plan: TaskSummary;
      readonly agent: TaskAgentLine;
    }
  | {
      readonly kind: typeof FACTORY_STOP.ONE_OFF_QUESTION;
      readonly agent: TasklessAgent;
      readonly item: AppInboxWaitingItem;
    }
  | { readonly kind: typeof FACTORY_STOP.ONE_OFF_FAILED; readonly agent: TasklessAgent };

/** An open item an agent with no task posted, by that agent. */
export interface FactoryOneOffItem {
  readonly agentId: string;
  readonly item: AppInboxWaitingItem;
}

/** What stops a merge until the developer acts: failing checks to fix, or a pull request ready to merge. */
export const FACTORY_BLOCK = {
  CHECKS: "checks",
  MERGE: "merge",
} as const;

export interface FactoryBlock {
  readonly kind: (typeof FACTORY_BLOCK)[keyof typeof FACTORY_BLOCK];
  readonly plan: TaskSummary;
  readonly pullRequest: TaskPullRequestLine;
}

/** A pull request merged in the last day, and its task's last activity. */
export interface FactoryShipped {
  readonly task: TaskSummary;
  readonly pullRequest: TaskPullRequestLine;
  readonly at: number;
}

/** What the board is read from. */
export interface FactoryInput {
  /** The tasks the sidebar lists. */
  readonly plans: readonly TaskSummary[];
  /** What waits, by plan: every member's open items, as the Inbox reads them (`factoryWaiting`). */
  readonly waiting: readonly AppInboxTask[];
  /** The task on this Mac's call, or none. */
  readonly callTaskId: string | undefined;
  /** The listed workspace's agents with no task that stand, not archived (chain D's plan list). */
  readonly oneOff: readonly TasklessAgent[];
  /** The open items those agents posted, as the Inbox reads them (`factoryOneOffWaiting`). */
  readonly oneOffWaiting: readonly FactoryOneOffItem[];
  readonly now: number;
}

/** The board: each station's work, led by what waits on the developer there. */
export interface FactoryBoard {
  /** The task on this Mac's call with Luke, if it is listed. */
  readonly talking: readonly TaskSummary[];
  /** What stops an agent: the questions, then the failures, each the latest first. */
  readonly stopped: readonly FactoryStop[];
  /** The agents at work, the latest moved first, then the pull requests still being built. */
  readonly working: readonly FactoryWork[];
  /** What stops a merge: failing checks, then pull requests ready to merge, each the latest first. */
  readonly blocked: readonly FactoryBlock[];
  /** What merged in the last day, the latest first. */
  readonly shipped: readonly FactoryShipped[];
  /** The agents at work across the board. */
  readonly agentsWorking: number;
}

const STANDING_STATES: ReadonlySet<TaskPullRequestLine["state"]> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/** Checks that leave an open pull request ready: passing, or none to run. */
const READY_CHECKS: ReadonlySet<TaskPullRequestLine["checks"]> = new Set([
  CHECK_SUMMARY.PASSING,
  CHECK_SUMMARY.NONE,
]);

function readyToMerge(pullRequest: TaskPullRequestLine): boolean {
  return pullRequest.state === PULL_REQUEST_STATE.OPEN && READY_CHECKS.has(pullRequest.checks);
}

function pullRequestsOf(plan: TaskSummary): readonly TaskPullRequestLine[] {
  return plan.agents?.pullRequests ?? [];
}

/**
 * When a task last moved, as the sidebar says it (`taskTime`), or its
 * newest agent's turn where that is later, which stands for when its pull
 * request moved, since the wire carries no instant of its own for one.
 */
export function factoryMovedAt(plan: TaskSummary): number {
  return Math.max(
    taskTime(plan, TASK_ORDER.UPDATED),
    ...(plan.agents?.agents ?? []).map((agent) => agent.at ?? 0),
  );
}

/**
 * When an agent last moved: its turn's start or settle, or, for one that
 * never ran a turn, its task's last activity (`taskTime`), which counts the
 * agent's start, so an agent that failed before its first turn on an old
 * task is as recent as it is.
 */
export function agentMovedAt(plan: TaskSummary, agent: TaskAgentLine): number {
  return agent.at ?? taskTime(plan, TASK_ORDER.UPDATED);
}

/** An agent whose turn failed lately, which waits on the developer to retry it. */
function failedLately(plan: TaskSummary, agent: TaskAgentLine, now: number): boolean {
  return (
    agent.status === CODING_AGENT_STATUS.FAILED && now - agentMovedAt(plan, agent) < LOOKBACK_MS
  );
}

/** Failing checks on an open pull request, which wait on the developer; a draft's are its own work still. */
function checksFailing(pullRequest: TaskPullRequestLine): boolean {
  return (
    pullRequest.state === PULL_REQUEST_STATE.OPEN && pullRequest.checks === CHECK_SUMMARY.FAILING
  );
}

/** Where one plan stands: what of it stops, works, blocks, and shipped. */
function placeTask(plan: TaskSummary, input: FactoryInput) {
  const agents = plan.agents?.agents ?? [];
  const items = input.waiting.find((each) => each.taskId === plan.id)?.items ?? [];
  const questions = items.map((item): FactoryStop => ({ kind: FACTORY_STOP.QUESTION, plan, item }));
  const failed = agents
    .filter((agent) => failedLately(plan, agent, input.now))
    .map((agent): FactoryStop => ({ kind: FACTORY_STOP.FAILED, plan, agent }));
  const standing = pullRequestsOf(plan).filter((each) => STANDING_STATES.has(each.state));
  const blocked = standing.flatMap((pullRequest): FactoryBlock[] => {
    if (readyToMerge(pullRequest)) return [{ kind: FACTORY_BLOCK.MERGE, plan, pullRequest }];
    if (checksFailing(pullRequest)) {
      return [{ kind: FACTORY_BLOCK.CHECKS, plan, pullRequest }];
    }
    return [];
  });
  const building = standing.filter((each) => !readyToMerge(each) && !checksFailing(each));
  const working: FactoryWork[] = [
    ...agents
      .filter((agent) => agentStillWriting(agent.status))
      .map((agent): FactoryWork => ({ kind: FACTORY_WORK.AGENT, plan, agent })),
    ...building.map(
      (pullRequest): FactoryWork => ({ kind: FACTORY_WORK.PULL_REQUEST, plan, pullRequest }),
    ),
  ];
  const at = factoryMovedAt(plan);
  const shipped =
    input.now - at < LOOKBACK_MS
      ? pullRequestsOf(plan)
          .filter((pullRequest) => pullRequest.state === PULL_REQUEST_STATE.MERGED)
          .map((pullRequest): FactoryShipped => ({ task: plan, pullRequest, at }))
      : [];
  return { questions, failed, working, blocked, shipped };
}

/** Where the agents with no task stand: what of them stops, and what works. */
function placeOneOff(input: FactoryInput) {
  const questions = input.oneOffWaiting.flatMap(({ agentId, item }): FactoryStop[] => {
    const agent = input.oneOff.find((each) => each.id === agentId);
    return agent === undefined ? [] : [{ kind: FACTORY_STOP.ONE_OFF_QUESTION, agent, item }];
  });
  const failed = input.oneOff
    .filter(
      (agent) =>
        agent.status === CODING_AGENT_STATUS.FAILED && input.now - agent.activityAt < LOOKBACK_MS,
    )
    .map((agent): FactoryStop => ({ kind: FACTORY_STOP.ONE_OFF_FAILED, agent }));
  const working = input.oneOff
    .filter((agent) => agentStillWriting(agent.status))
    .map((agent): FactoryWork => ({ kind: FACTORY_WORK.ONE_OFF, agent }));
  return { questions, failed, working };
}

/** When a stop or a piece of work last moved: a question's post, an agent's turn, a pull request's plan. */
function stopAt(stop: FactoryStop): number {
  switch (stop.kind) {
    case FACTORY_STOP.QUESTION:
    case FACTORY_STOP.ONE_OFF_QUESTION:
      return stop.item.postedAt;
    case FACTORY_STOP.FAILED:
      return agentMovedAt(stop.plan, stop.agent);
    case FACTORY_STOP.ONE_OFF_FAILED:
      return stop.agent.activityAt;
  }
}

function workAt(work: FactoryWork): number {
  switch (work.kind) {
    case FACTORY_WORK.AGENT:
      return agentMovedAt(work.plan, work.agent);
    case FACTORY_WORK.PULL_REQUEST:
      return factoryMovedAt(work.plan);
    case FACTORY_WORK.ONE_OFF:
      return work.agent.activityAt;
  }
}

function latestFirst<T>(at: (each: T) => number): (a: T, b: T) => number {
  return (a, b) => at(b) - at(a);
}

/** Each group of kinds of a list ahead of the next, each group the latest first. */
function kindsInOrder<T extends { readonly kind: string }>(
  list: readonly T[],
  order: readonly (readonly T["kind"][])[],
  at: (each: T) => number,
): T[] {
  return order.flatMap((kinds) =>
    list.filter((each) => kinds.includes(each.kind)).toSorted(latestFirst(at)),
  );
}

/** The board as it stands now. */
export function factoryBoard(input: FactoryInput): FactoryBoard {
  const plans = input.plans.filter((plan) => plan.archivedAt === undefined);
  const placed = plans.map((plan) => placeTask(plan, input));
  const oneOff = placeOneOff(input);
  const stops = [
    ...placed.flatMap((each) => [...each.questions, ...each.failed]),
    ...oneOff.questions,
    ...oneOff.failed,
  ];
  const blockAt = (block: FactoryBlock) => factoryMovedAt(block.plan);
  return {
    talking: plans.filter((plan) => plan.id === input.callTaskId),
    stopped: kindsInOrder(
      stops,
      [
        [FACTORY_STOP.QUESTION, FACTORY_STOP.ONE_OFF_QUESTION],
        [FACTORY_STOP.FAILED, FACTORY_STOP.ONE_OFF_FAILED],
      ],
      stopAt,
    ),
    working: kindsInOrder(
      [...placed.flatMap((each) => each.working), ...oneOff.working],
      [[FACTORY_WORK.AGENT, FACTORY_WORK.ONE_OFF], [FACTORY_WORK.PULL_REQUEST]],
      workAt,
    ),
    blocked: kindsInOrder(
      placed.flatMap((each) => each.blocked),
      [[FACTORY_BLOCK.CHECKS], [FACTORY_BLOCK.MERGE]],
      blockAt,
    ),
    shipped: placed.flatMap((each) => each.shipped).toSorted((a, b) => b.at - a.at),
    agentsWorking:
      plans.reduce((sum, plan) => sum + (plan.agents?.working ?? 0), 0) + oneOff.working.length,
  };
}

/**
 * What waits, by plan: every open item the Inbox read of the listed plans,
 * a teammate's agent's among them, and main's own count of the account's
 * besides where the caller hands it, which it does only while the Inbox's
 * reads are still out or did not answer. An item both name stands once.
 */
export function factoryWaiting(
  read: readonly InboxListed[],
  main: readonly AppInboxTask[],
): AppInboxTask[] {
  const byTask = new Map<string, Map<string, AppInboxWaitingItem>>();
  const add = (planId: string, item: AppInboxWaitingItem) => {
    const items = byTask.get(planId) ?? new Map<string, AppInboxWaitingItem>();
    if (!items.has(item.id)) items.set(item.id, item);
    byTask.set(planId, items);
  };
  for (const { holder, item } of read) {
    if (holder.kind !== INBOX_HOLDER.TASK) continue;
    const { id, agentId, title, postedAt } = item;
    add(holder.task.id, { id, agentId, title, postedAt });
  }
  for (const { taskId: planId, items } of main) for (const item of items) add(planId, item);
  return [...byTask].map(([planId, items]) => ({ taskId: planId, items: [...items.values()] }));
}

/**
 * The open items of agents with no task, each by its agent: those the
 * Inbox read, and main's own count besides where the caller hands it, which
 * it does for an agent whose read is out or did not answer. An item both
 * name stands once.
 */
export function factoryOneOffWaiting(
  read: readonly InboxListed[],
  main: readonly AppInboxWaitingItem[],
): FactoryOneOffItem[] {
  const fromRead = read.flatMap(({ holder, item }) => {
    if (holder.kind === INBOX_HOLDER.TASK) return [];
    const { id, agentId, title, postedAt } = item;
    return [{ agentId, item: { id, agentId, title, postedAt } }];
  });
  const seen = new Set(fromRead.map((each) => each.item.id));
  const fromMain = main
    .filter((item) => !seen.has(item.id))
    .map(({ id, agentId, title, postedAt }) => ({
      agentId,
      item: { id, agentId, title, postedAt },
    }));
  return [...fromRead, ...fromMain];
}
