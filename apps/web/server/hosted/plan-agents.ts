import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import {
  PLAN_AGENTS_BOUNDS,
  type PlanAgentLine,
  type PlanAgentsSummary,
  type PlanPullRequestLine,
  type PlanSummary,
  ROLLOUT_BASE,
  type RolloutItem,
} from "@sidecar/hosted/plan-wire";
import { Clock, Effect, Result } from "effect";
import { codingAgentRunStartedAt, codingAgentStatusOf } from "./coder-host/status.js";
import {
  awaitingLinesOf,
  type CodingAgentLatestTurn,
  type CodingAgentStoreEffect,
  isLiveWorkerTurn,
  latestTurnsOf,
  listPublishedCodingAgents,
  type PublishedCodingAgent,
} from "./coding-agent-store.js";

/**
 * plan-agents.ts -- what each listed plan's coding agents are doing and what they published, in brief, for the sidebar's row and its hover card.
 *
 * Three statements answer the whole list however many plans it holds: the
 * agents of every plan named with the pull request each last published,
 * their newest turns, and which of them hold a line awaiting its turn. An
 * agent's status is read exactly as its tab's is (`coder-host/status.ts`),
 * and a pull request is the one its row keeps as GitHub last answered, so
 * nothing here asks GitHub. A plan with no agent carries nothing, so the
 * list stays as small as it was for every plan nobody has started an agent
 * on.
 *
 * A plan's rollout is read the same way, for the planning model rather than
 * the sidebar: the plan's list is the graph and its workers' rows are its
 * state, so which pull request may start and which may merge is computed
 * here from both, and Luke never has to infer it.
 */

/** The statuses under which an agent is at work. */
const WORKING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** One agent read for the list: its line, and when it was started, which orders the lines. */
interface ReadAgent {
  readonly line: PlanAgentLine;
  readonly createdAt: number;
  readonly published: PublishedCodingAgent["published"];
}

/** One agent as its row names it, its status read at `now`: since its run began while it works, since its newest turn ended once it has. */
function agentLine(
  held: PublishedCodingAgent,
  turn: CodingAgentLatestTurn | undefined,
  lineAwaits: boolean,
  now: number,
): ReadAgent {
  const { agent } = held;
  const status = codingAgentStatusOf(turn, { createdAt: agent.createdAt, now, lineAwaits });
  const at = WORKING_STATUSES.has(status)
    ? codingAgentRunStartedAt(turn, { createdAt: agent.createdAt, lineAwaits })
    : turn?.settledAt?.getTime();
  return {
    line: {
      id: agent.id,
      title: agent.title,
      model: agent.model,
      effort: agent.effort,
      status,
      ...(at === undefined ? undefined : { at }),
    },
    createdAt: agent.createdAt.getTime(),
    published: held.published,
  };
}

/** The order the pull requests a row names stand in: those still to act on first, then merged, then closed. */
const PULL_REQUEST_RANK = {
  [PULL_REQUEST_STATE.OPEN]: 0,
  [PULL_REQUEST_STATE.DRAFT]: 0,
  [PULL_REQUEST_STATE.MERGED]: 1,
  [PULL_REQUEST_STATE.CLOSED]: 2,
} as const satisfies Record<PlanPullRequestLine["state"], number>;

/**
 * One plan's agents in brief: those at work named first, then the rest,
 * newest started first within each; the pull requests each named once by
 * their page, since two agents on one branch share theirs and a plan whose
 * repository changed may hold two of one number, those still open first, then
 * merged, then closed, newest agent's first within each, so the few a row
 * names always hold the one its mark is drawn for.
 */
function summaryOf(agents: readonly ReadAgent[]): PlanAgentsSummary {
  const newest = [...agents].sort((a, b) => b.createdAt - a.createdAt);
  const working = newest.filter((agent) => WORKING_STATUSES.has(agent.line.status));
  const resting = newest.filter((agent) => !WORKING_STATUSES.has(agent.line.status));
  const pullRequests = new Map<string, PlanPullRequestLine>();
  for (const { published } of newest) {
    if (published === null || pullRequests.has(published.url)) continue;
    const { number, title, state, checks, additions, deletions, url } = published;
    pullRequests.set(url, { number, title, state, checks, additions, deletions, url });
  }
  return {
    total: agents.length,
    working: working.length,
    agents: [...working, ...resting]
      .slice(0, PLAN_AGENTS_BOUNDS.MAX_AGENTS)
      .map((agent) => agent.line),
    pullRequestTotal: pullRequests.size,
    pullRequests: [...pullRequests.values()]
      .sort((a, b) => PULL_REQUEST_RANK[a.state] - PULL_REQUEST_RANK[b.state])
      .slice(0, PLAN_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  };
}

/** The account's listed plans, each carrying its agents in brief where it has any; the plans' order and every other field as listed. */
export function withPlanAgents(
  userId: string,
  plans: readonly PlanSummary[],
): CodingAgentStoreEffect<readonly PlanSummary[]> {
  return Effect.gen(function* () {
    const held = yield* listPublishedCodingAgents(
      userId,
      plans.map((plan) => plan.id),
    );
    const conversationIds = held.map(({ agent }) => agent.conversationId);
    const turns = yield* latestTurnsOf(userId, conversationIds);
    const awaiting = yield* awaitingLinesOf(userId, conversationIds);
    const now = yield* Clock.currentTimeMillis;
    const byPlan = new Map<string, ReadAgent[]>();
    for (const agent of held) {
      const { conversationId, planId } = agent.agent;
      const line = agentLine(agent, turns.get(conversationId), awaiting.has(conversationId), now);
      byPlan.set(planId, [...(byPlan.get(planId) ?? []), line]);
    }
    return plans.map((plan) => {
      const agents = byPlan.get(plan.id);
      return agents === undefined ? plan : { ...plan, agents: summaryOf(agents) };
    });
  });
}

/** A rollout worker as its position's line reads it: where it stands, whether it still holds its position, and its pull request as GitHub last answered. */
export interface RolloutWorker {
  readonly position: number;
  readonly status: CodingAgentStatus;
  /** Whether it holds its position, by the rule a Start at the position is refused under (`isLiveWorkerTurn`). */
  readonly live: boolean;
  readonly published: CodingAgentPullRequest | null;
}

/** A position's worker in a word: none started, at work, or how its newest turn ended. */
const WORKER_WORD = {
  NONE: "none",
  WORKING: "working",
  FINISHED: "finished",
  FAILED: "failed",
  STOPPED: "stopped",
} as const;

const WORKER_WORD_OF_STATUS = {
  [CODING_AGENT_STATUS.STARTING]: WORKER_WORD.WORKING,
  [CODING_AGENT_STATUS.RUNNING]: WORKER_WORD.WORKING,
  [CODING_AGENT_STATUS.COMPLETED]: WORKER_WORD.FINISHED,
  [CODING_AGENT_STATUS.FAILED]: WORKER_WORD.FAILED,
  [CODING_AGENT_STATUS.CANCELLED]: WORKER_WORD.STOPPED,
} as const satisfies Record<CodingAgentStatus, string>;

/** An open pull request's word by its checks: green once every one passed. */
const OPEN_PULL_REQUEST_WORD = {
  [CHECK_SUMMARY.PASSING]: "green",
  [CHECK_SUMMARY.FAILING]: "checks failing",
  [CHECK_SUMMARY.PENDING]: "open",
  [CHECK_SUMMARY.NONE]: "open",
} as const satisfies Record<CodingAgentPullRequest["checks"], string>;

/** The pull request states a later position may build on: its branch is pushed, or it is already on main. */
const BUILDABLE_STATES: ReadonlySet<CodingAgentPullRequest["state"]> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
  PULL_REQUEST_STATE.MERGED,
]);

/** One position's state: its workers, newest started last, and the newest pull request any of them published. */
interface PositionState {
  readonly newest: RolloutWorker | undefined;
  readonly live: boolean;
  readonly published: CodingAgentPullRequest | null;
}

function positionStateOf(workers: readonly RolloutWorker[]): PositionState {
  const published = workers.findLast((worker) => worker.published !== null)?.published ?? null;
  return { newest: workers.at(-1), live: workers.some((worker) => worker.live), published };
}

/** A pull request in words: its number and where it stands, or none. */
function pullRequestWords(published: CodingAgentPullRequest | null): string {
  if (published === null) return "none";
  const words =
    published.state === PULL_REQUEST_STATE.OPEN
      ? OPEN_PULL_REQUEST_WORD[published.checks]
      : published.state;
  return `#${published.number} ${words}`;
}

/** Whether a position's base lets it start: main, or an earlier position whose pull request is pushed or merged. */
function baseBuildable(base: RolloutItem["base"], states: readonly PositionState[]): boolean {
  if (base === ROLLOUT_BASE.MAIN) return true;
  const state = states[base - 1]?.published?.state;
  return state !== undefined && BUILDABLE_STATES.has(state);
}

/** Whether a position's base is on main already: main itself, or an earlier position whose pull request merged. */
function baseMerged(base: RolloutItem["base"], states: readonly PositionState[]): boolean {
  if (base === ROLLOUT_BASE.MAIN) return true;
  return states[base - 1]?.published?.state === PULL_REQUEST_STATE.MERGED;
}

/** Positions in a line, or none. */
function positionsWords(positions: readonly number[]): string {
  return positions.length === 0 ? "none" : positions.join(", ");
}

/**
 * The rollout's state, one line per position counted from one: its title,
 * its base, its newest worker, and the newest pull request a worker at it
 * published; then the positions ready to start (base on main or its pull
 * request pushed, no live worker holding it, and its own not merged) and
 * those ready to merge (open and green, its base on main already).
 */
export function rolloutStateOf(
  rollout: readonly RolloutItem[],
  workers: readonly RolloutWorker[],
): readonly string[] {
  const states = rollout.map((_, at) =>
    positionStateOf(workers.filter((worker) => worker.position === at + 1)),
  );
  const lines = rollout.map((item, at) => {
    const state = states[at];
    const worker =
      state?.newest === undefined ? WORKER_WORD.NONE : WORKER_WORD_OF_STATUS[state.newest.status];
    return `${at + 1}. ${JSON.stringify(item.title)} · base: ${item.base} · worker: ${worker} · pull request: ${pullRequestWords(state?.published ?? null)}`;
  });
  const toStart: number[] = [];
  const toMerge: number[] = [];
  rollout.forEach((item, at) => {
    const state = states[at];
    const published = state?.published ?? null;
    if (
      state?.live !== true &&
      published?.state !== PULL_REQUEST_STATE.MERGED &&
      baseBuildable(item.base, states)
    ) {
      toStart.push(at + 1);
    }
    if (
      published?.state === PULL_REQUEST_STATE.OPEN &&
      published.checks === CHECK_SUMMARY.PASSING &&
      baseMerged(item.base, states)
    ) {
      toMerge.push(at + 1);
    }
  });
  return [
    ...lines,
    `Ready to start: ${positionsWords(toStart)}`,
    `Ready to merge: ${positionsWords(toMerge)}`,
  ];
}

/** Why a position of the rollout cannot start on a base: the rollout names no such position, or the pull request it bases on is not open. */
export const ROLLOUT_BASE_REFUSAL = {
  NOT_IN_ROLLOUT: "not-in-rollout",
  BASE_NOT_OPEN: "base-not-open",
} as const;

export type RolloutBaseRefusal = (typeof ROLLOUT_BASE_REFUSAL)[keyof typeof ROLLOUT_BASE_REFUSAL];

/**
 * The branch a worker at `position` bases on, counted from one: none for a
 * pull request on main, or one on an earlier pull request that has merged,
 * since the default branch then holds it; the branch of the newest worker at
 * the base position that published, while its pull request is open. Refused
 * where the rollout names no such position, or where the base's pull request
 * is not open, by the rule the ready line reads (`baseBuildable`).
 */
export function rolloutBaseBranchOf(
  rollout: readonly RolloutItem[],
  position: number,
  agents: readonly PublishedCodingAgent[],
): Result.Result<string | undefined, RolloutBaseRefusal> {
  const item = rollout[position - 1];
  if (item === undefined) return Result.fail(ROLLOUT_BASE_REFUSAL.NOT_IN_ROLLOUT);
  if (item.base === ROLLOUT_BASE.MAIN) return Result.succeed(undefined);
  const base = item.base;
  const holder = agents.findLast(
    ({ agent, published }) => agent.position === base && published !== null,
  );
  const state = holder?.published?.state;
  if (state === PULL_REQUEST_STATE.MERGED) return Result.succeed(undefined);
  const branch = holder?.agent.branch ?? null;
  if (state === undefined || !BUILDABLE_STATES.has(state) || branch === null) {
    return Result.fail(ROLLOUT_BASE_REFUSAL.BASE_NOT_OPEN);
  }
  return Result.succeed(branch);
}

/** The plan's rollout workers, in the order started, each read as its position's line reads it; none where the plan has no worker or the account owns no such plan. */
export function rolloutWorkersOf(
  userId: string,
  planId: string,
): CodingAgentStoreEffect<readonly RolloutWorker[]> {
  return Effect.gen(function* () {
    // An agent started outside the rollout holds no position and is no worker of it.
    const held = (yield* listPublishedCodingAgents(userId, [planId])).flatMap(
      ({ agent, published }) =>
        agent.position === null ? [] : [{ agent, position: agent.position, published }],
    );
    const conversationIds = held.map(({ agent }) => agent.conversationId);
    const turns = yield* latestTurnsOf(userId, conversationIds);
    const awaiting = yield* awaitingLinesOf(userId, conversationIds);
    const now = yield* Clock.currentTimeMillis;
    return held.map(({ agent, position, published }) => {
      const turn = turns.get(agent.conversationId);
      const lineAwaits = awaiting.has(agent.conversationId);
      return {
        position,
        status: codingAgentStatusOf(turn, { createdAt: agent.createdAt, now, lineAwaits }),
        live: isLiveWorkerTurn(turn),
        published,
      };
    });
  });
}
