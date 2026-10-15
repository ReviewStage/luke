import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { PlanAgentLine, PlanPullRequestLine, PlanSummary } from "@luke/features/plan-wire";
import type { AppInboxPlan, AppInboxWaitingItem } from "#shared/messages/app-state";
import { agentStillWriting } from "../planning/coding-agent-model";

/**
 * factory-model.ts -- what the Factory tab draws: the plans being planned, built, and shipped right now, and what of them waits on the developer, from the plan list, main's Inbox read, and the call.
 *
 * Factory is a live view, not a report: it holds no range and no totals,
 * only where work stands now. A plan stands in the step its own state puts
 * it in, worked out here rather than stored: Plan while it has no agents
 * and was saved lately or is on the call, Build while an agent works on it
 * or its pull request is still in checks, Ship for a minute after one of
 * its pull requests was seen to merge. What waits on the developer is the
 * bottom of two steps: the Inbox's open items under Build, since an agent
 * that asks is stopped until it is answered, and the pull requests ready
 * to merge under Ship, since nothing merges without the developer. An
 * agent is stalled by holding an open item, not by a status of its own.
 * Every list is read from what the window already holds; nothing here
 * fetches. Note that the list's row names at most three pull requests,
 * open and draft ones first (`PLAN_AGENTS_BOUNDS`), so a plan with more
 * open than that shows the three the row names.
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

/** A plan being planned: drafted lately, or the one on the call. */
export interface FactoryPlanning {
  readonly plan: PlanSummary;
  readonly onCall: boolean;
}

/** A plan being built: the agent at work on it, or else the pull request still in checks. */
export interface FactoryBuilding {
  readonly plan: PlanSummary;
  readonly agent: PlanAgentLine | undefined;
  readonly pullRequest: PlanPullRequestLine | undefined;
}

/** An open Inbox item and its plan: the agent that posted it is stopped until it is answered. */
export interface FactoryQuestion {
  readonly plan: PlanSummary;
  readonly item: AppInboxWaitingItem;
}

/** A pull request waiting on the developer to merge it. */
export interface FactoryMerge {
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

/** The board: each step's work, what waits on the developer, and which wait to take first. */
export interface FactoryBoard {
  readonly planning: readonly FactoryPlanning[];
  readonly building: readonly FactoryBuilding[];
  /** The open Inbox items, the longest waiting first. */
  readonly questions: readonly FactoryQuestion[];
  readonly merges: readonly FactoryMerge[];
  /** What shipped within the last minute, the latest first. */
  readonly shipped: readonly FactoryShipped[];
  /** The agents at work across the board, and the plans they work on. */
  readonly agentsWorking: number;
  readonly plansWorking: number;
  /** The step whose wait to take first: questions before merges, since an agent that asks is stopped. */
  readonly first: FactoryStep | undefined;
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

/** Where one plan stands: its build row, its merges, its questions, and whether it is being planned. */
function placePlan(plan: PlanSummary, input: FactoryInput) {
  const agents = plan.agents;
  const items = input.waiting.find((each) => each.planId === plan.id)?.items ?? [];
  const questions = items.map((item) => ({ plan, item }));
  const merges = pullRequestsOf(plan)
    .filter(readyToMerge)
    .map((pullRequest) => ({ plan, pullRequest }));
  const checking = pullRequestsOf(plan).find(
    (pullRequest) => STANDING_STATES.has(pullRequest.state) && !readyToMerge(pullRequest),
  );
  const working = agents !== undefined && agents.working > 0;
  const agent = agents?.agents.find((each) => agentStillWriting(each.status));
  const building =
    working || checking !== undefined
      ? { plan, agent: working ? agent : undefined, pullRequest: checking }
      : undefined;
  const onCall = plan.id === input.callPlanId;
  const drafted = (agents?.total ?? 0) === 0 && input.now - plan.updatedAt < PLANNING_WINDOW_MS;
  const planning = building === undefined && (onCall || drafted) ? { plan, onCall } : undefined;
  return { building, merges, questions, planning };
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
  const building = placed
    .flatMap((each) => (each.building === undefined ? [] : [each.building]))
    .toSorted((a, b) => (b.agent?.at ?? b.plan.updatedAt) - (a.agent?.at ?? a.plan.updatedAt));
  const questions = placed
    .flatMap((each) => each.questions)
    .toSorted((a, b) => a.item.postedAt - b.item.postedAt);
  const merges = placed.flatMap((each) => each.merges);
  const shipped = plans.flatMap((plan) => shippedOf(plan, input)).toSorted((a, b) => b.at - a.at);
  const working = plans.filter((plan) => (plan.agents?.working ?? 0) > 0);
  const first =
    questions.length > 0 ? FACTORY_STEP.BUILD : merges.length > 0 ? FACTORY_STEP.SHIP : undefined;
  return {
    planning,
    building,
    questions,
    merges,
    shipped,
    agentsWorking: working.reduce((sum, plan) => sum + (plan.agents?.working ?? 0), 0),
    plansWorking: working.length,
    first,
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
