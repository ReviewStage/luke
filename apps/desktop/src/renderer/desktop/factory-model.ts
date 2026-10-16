import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import type { PlanAgentLine, PlanPullRequestLine, PlanSummary } from "@luke/features/plan-wire";
import type { AppInboxPlan, AppInboxWaitingItem } from "@luke/host/app-state";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { agentStillWriting } from "../planning/coding-agent-model";

/**
 * factory-model.ts -- what the Factory tab draws: the plans being planned, the agents building them, and what ships, each station leading with what waits on the developer, from the plan list, main's Inbox read, and the call.
 *
 * Factory is a live view, not a report: it holds no range and no totals,
 * only where work stands now. A plan stands in Plan while it has no agents
 * and was saved lately or is on the call. Build lists each agent still at
 * work with its plan, and each pull request still in checks or a draft; it
 * leads with what stops an agent until the developer acts, the Inbox's open
 * items and the agents whose turn failed in the last day. Ship lists a pull
 * request for a minute after it was seen to merge, and leads with what
 * stops a merge: failing checks, then pull requests ready to merge, since
 * nothing merges without the developer. Every list is read from what the
 * window already holds; nothing here fetches. Note that the list's row names
 * at most three agents and three pull requests (`PLAN_AGENTS_BOUNDS`), at
 * work and open ones first, so a plan with more shows the ones its row names.
 */

/** The steps of the line, left to right. */
export const FACTORY_STEP = {
  PLAN: "plan",
  BUILD: "build",
  SHIP: "ship",
} as const;

export type FactoryStep = (typeof FACTORY_STEP)[keyof typeof FACTORY_STEP];

/** How long after its last save a plan with no agents still counts as being planned. */
export const PLANNING_WINDOW_MS = 24 * 3_600_000;

/** How long a pull request seen turning merged stands in Ship before it leaves. */
export const SHIPPED_LINGER_MS = 60_000;

/** How long an agent whose turn failed still waits on the developer to retry it. */
export const FAILED_WINDOW_MS = 24 * 3_600_000;

/** A plan being planned: drafted lately, or the one on the call. */
export interface FactoryPlanning {
  readonly plan: PlanSummary;
  readonly onCall: boolean;
}

/** What Build lists of the work going on: an agent at work, or a pull request still in checks or a draft. */
export const FACTORY_WORK = {
  AGENT: "agent",
  PULL_REQUEST: "pull-request",
} as const;

export type FactoryWork =
  | {
      readonly kind: typeof FACTORY_WORK.AGENT;
      readonly plan: PlanSummary;
      readonly agent: PlanAgentLine;
    }
  | {
      readonly kind: typeof FACTORY_WORK.PULL_REQUEST;
      readonly plan: PlanSummary;
      readonly pullRequest: PlanPullRequestLine;
    };

/** What stops an agent until the developer acts: an open Inbox item it posted, or its failed turn. */
export const FACTORY_STOP = {
  QUESTION: "question",
  FAILED: "failed",
} as const;

export type FactoryStop =
  | {
      readonly kind: typeof FACTORY_STOP.QUESTION;
      readonly plan: PlanSummary;
      readonly item: AppInboxWaitingItem;
    }
  | {
      readonly kind: typeof FACTORY_STOP.FAILED;
      readonly plan: PlanSummary;
      readonly agent: PlanAgentLine;
    };

/** What stops a merge until the developer acts: failing checks to fix, or a pull request ready to merge. */
export const FACTORY_BLOCK = {
  CHECKS: "checks",
  MERGE: "merge",
} as const;

export interface FactoryBlock {
  readonly kind: (typeof FACTORY_BLOCK)[keyof typeof FACTORY_BLOCK];
  readonly plan: PlanSummary;
  readonly pullRequest: PlanPullRequestLine;
}

/** A pull request seen turning merged, and when. */
export interface FactoryShipped {
  readonly plan: PlanSummary;
  readonly pullRequest: PlanPullRequestLine;
  readonly at: number;
}

/** A pull request's identity within its plan: its page, where the service sends one, else its number. */
type PullRequestIdentity = string | number;

/** When each pull request was first seen merged, by its plan and then its identity. */
export type MergedSeen = ReadonlyMap<string, ReadonlyMap<PullRequestIdentity, number>>;

/** What the board is read from. */
export interface FactoryInput {
  /** The plans the sidebar lists. */
  readonly plans: readonly PlanSummary[];
  /** What main's Inbox read says waits, by plan. */
  readonly waiting: readonly AppInboxPlan[];
  /** The plan on this Mac's call, or none. */
  readonly callPlanId: string | undefined;
  readonly merged: MergedSeen;
  readonly now: number;
}

/** The board: each station's work, led by what waits on the developer there. */
export interface FactoryBoard {
  readonly planning: readonly FactoryPlanning[];
  /** What stops an agent: the questions, then the failures, each the latest first. */
  readonly stopped: readonly FactoryStop[];
  /** The agents at work, the latest moved first, then the pull requests still being built. */
  readonly working: readonly FactoryWork[];
  /** What stops a merge: failing checks, then pull requests ready to merge, each the latest first. */
  readonly blocked: readonly FactoryBlock[];
  /** What shipped within the last minute, the latest first. */
  readonly shipped: readonly FactoryShipped[];
  /** The agents at work across the board. */
  readonly agentsWorking: number;
}

export const EMPTY_MERGED: MergedSeen = new Map();

const STANDING_STATES: ReadonlySet<PlanPullRequestLine["state"]> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/** Checks that leave an open pull request ready: passing, or none to run. */
const READY_CHECKS: ReadonlySet<PlanPullRequestLine["checks"]> = new Set([
  CHECK_SUMMARY.PASSING,
  CHECK_SUMMARY.NONE,
]);

function readyToMerge(pullRequest: PlanPullRequestLine): boolean {
  return pullRequest.state === PULL_REQUEST_STATE.OPEN && READY_CHECKS.has(pullRequest.checks);
}

/** Note that two repositories' pull requests may share a number, so a page tells them apart where there is one. */
function identityOf(pullRequest: PlanPullRequestLine): PullRequestIdentity {
  return pullRequest.url ?? pullRequest.number;
}

function pullRequestsOf(plan: PlanSummary): readonly PlanPullRequestLine[] {
  return plan.agents?.pullRequests ?? [];
}

/** When a plan's pull request moved, which the wire does not carry: its newest agent turn, else its save. */
export function factoryMovedAt(plan: PlanSummary): number {
  return Math.max(plan.updatedAt, ...(plan.agents?.agents ?? []).map((agent) => agent.at ?? 0));
}

/**
 * When an agent last moved: its turn's start or settle, or, for one that
 * never ran a turn, its task's last activity (`taskTime`), which counts the
 * agent's start, so an agent that failed before its first turn on an old
 * task is as recent as it is.
 */
export function agentMovedAt(plan: PlanSummary, agent: PlanAgentLine): number {
  return agent.at ?? taskTime(plan, TASK_ORDER.UPDATED);
}

/** An agent whose turn failed lately, which waits on the developer to retry it. */
function failedLately(plan: PlanSummary, agent: PlanAgentLine, now: number): boolean {
  return (
    agent.status === CODING_AGENT_STATUS.FAILED &&
    now - agentMovedAt(plan, agent) < FAILED_WINDOW_MS
  );
}

/** Failing checks on an open pull request, which wait on the developer; a draft's are its own work still. */
function checksFailing(pullRequest: PlanPullRequestLine): boolean {
  return (
    pullRequest.state === PULL_REQUEST_STATE.OPEN && pullRequest.checks === CHECK_SUMMARY.FAILING
  );
}

/** Where one plan stands: what of it stops, works, and blocks, and whether it is being planned. */
function placePlan(plan: PlanSummary, input: FactoryInput) {
  const agents = plan.agents?.agents ?? [];
  const items = input.waiting.find((each) => each.planId === plan.id)?.items ?? [];
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
  const onCall = plan.id === input.callPlanId;
  const drafted = agents.length === 0 && input.now - plan.updatedAt < PLANNING_WINDOW_MS;
  const busy = working.length + blocked.length + failed.length > 0;
  const planning = !busy && (onCall || drafted) ? { plan, onCall } : undefined;
  return { questions, failed, working, blocked, planning };
}

/** When a stop or a piece of work last moved: a question's post, an agent's turn, a pull request's plan. */
function stopAt(stop: FactoryStop): number {
  return stop.kind === FACTORY_STOP.QUESTION
    ? stop.item.postedAt
    : agentMovedAt(stop.plan, stop.agent);
}

function workAt(work: FactoryWork): number {
  return work.kind === FACTORY_WORK.AGENT
    ? agentMovedAt(work.plan, work.agent)
    : factoryMovedAt(work.plan);
}

function latestFirst<T>(at: (each: T) => number): (a: T, b: T) => number {
  return (a, b) => at(b) - at(a);
}

/** One kind of a list ahead of the other, each the latest first. */
function kindsInOrder<T extends { readonly kind: string }>(
  list: readonly T[],
  order: readonly T["kind"][],
  at: (each: T) => number,
): T[] {
  return order.flatMap((kind) =>
    list.filter((each) => each.kind === kind).toSorted(latestFirst(at)),
  );
}

/** The pull requests of a plan seen merged within the last minute. */
function shippedOf(plan: PlanSummary, input: FactoryInput): FactoryShipped[] {
  const seen = input.merged.get(plan.id);
  if (seen === undefined) return [];
  return pullRequestsOf(plan).flatMap((pullRequest) => {
    const at = seen.get(identityOf(pullRequest));
    const fresh = at !== undefined && input.now - at < SHIPPED_LINGER_MS;
    return fresh && pullRequest.state === PULL_REQUEST_STATE.MERGED
      ? [{ plan, pullRequest, at }]
      : [];
  });
}

/** The board as it stands now. */
export function factoryBoard(input: FactoryInput): FactoryBoard {
  const plans = input.plans.filter((plan) => plan.archivedAt === undefined);
  const placed = plans.map((plan) => placePlan(plan, input));
  const planning = placed
    .flatMap((each) => (each.planning === undefined ? [] : [each.planning]))
    .toSorted((a, b) => Number(b.onCall) - Number(a.onCall) || b.plan.updatedAt - a.plan.updatedAt);
  const stops = placed.flatMap((each) => [...each.questions, ...each.failed]);
  const blockAt = (block: FactoryBlock) => factoryMovedAt(block.plan);
  return {
    planning,
    stopped: kindsInOrder(stops, [FACTORY_STOP.QUESTION, FACTORY_STOP.FAILED], stopAt),
    working: kindsInOrder(
      placed.flatMap((each) => each.working),
      [FACTORY_WORK.AGENT, FACTORY_WORK.PULL_REQUEST],
      workAt,
    ),
    blocked: kindsInOrder(
      placed.flatMap((each) => each.blocked),
      [FACTORY_BLOCK.CHECKS, FACTORY_BLOCK.MERGE],
      blockAt,
    ),
    shipped: plans.flatMap((plan) => shippedOf(plan, input)).toSorted((a, b) => b.at - a.at),
    agentsWorking: plans.reduce((sum, plan) => sum + (plan.agents?.working ?? 0), 0),
  };
}

/**
 * When each pull request was first seen merged, carried from one read of
 * the plan list to the next. Note that only a pull request seen standing
 * in the read before and merged in this one is marked, because the list
 * carries no merge instant: one already merged when first read shipped at
 * a time this window never saw, and is not news. A mark leaves once its
 * minute is up.
 */
export function noteMerged(
  seen: MergedSeen,
  before: readonly PlanSummary[] | undefined,
  after: readonly PlanSummary[],
  now: number,
): MergedSeen {
  const next = new Map<string, Map<PullRequestIdentity, number>>();
  for (const plan of after) {
    const was = before?.find((each) => each.id === plan.id);
    const marks = new Map<PullRequestIdentity, number>();
    for (const pullRequest of pullRequestsOf(plan)) {
      if (pullRequest.state !== PULL_REQUEST_STATE.MERGED) continue;
      const identity = identityOf(pullRequest);
      const at = seen.get(plan.id)?.get(identity);
      const stood =
        was !== undefined &&
        pullRequestsOf(was).some(
          (old) => identityOf(old) === identity && STANDING_STATES.has(old.state),
        );
      const mark = at ?? (stood ? now : undefined);
      if (mark !== undefined && now - mark < SHIPPED_LINGER_MS) marks.set(identity, mark);
    }
    if (marks.size > 0) next.set(plan.id, marks);
  }
  return next;
}
