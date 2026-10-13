import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentLastReport,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
  ROLLOUT_ROLE,
} from "@sidecar/hosted/coding-agent-wire";
import { ROLLOUT_BASE, type RolloutItem } from "@sidecar/hosted/plan-wire";
import { WORKER_REPORT_KIND } from "@sidecar/hosted/rollout-wire";
import { agentStillWriting } from "./coding-agent-model";

/**
 * stack-model.ts -- what the plan's Stack tab draws: its rollout's pull requests laid out by how far each stands from main, each with its worker, its pull request, and where it stands in a word.
 *
 * The rollout is the graph and the plan's agents are its state, as the
 * service's own reading of a rollout has it (`plan-agents.ts`'s
 * `rolloutStateOf`), so the tab is drawn from the two alone and asks
 * nothing of GitHub: each agent's pull request is the one its row last
 * kept, which the plan's list carries. A position stands in the column of
 * its depth, main's children first, and positions on one base stand
 * together under it, so a pair of siblings reads as a fork. A position's
 * worker is the newest agent at it still holding it (one whose newest turn
 * neither failed nor was stopped), else the newest at it at all, so a
 * worker that failed is said to have failed until another starts there.
 * The rollout's keeper, the agent at no position that owns the stack's git
 * structure, is never a card: it is read apart (`stackKeeper`) for the
 * tab's header.
 */

/** Where a position stands, in the words of the service's reading of the rollout. */
export const STACK_STATE = {
  MERGED: "merged",
  ASKS: "asks",
  BLOCKED: "blocked",
  WORKING: "working",
  FAILED: "failed",
  STOPPED: "stopped",
  GREEN: "green",
  CHECKS_FAILING: "checks-failing",
  OPEN: "open",
  CLOSED: "closed",
  FINISHED: "finished",
  WAITING: "waiting",
  READY: "ready",
  /** The keeper alone: its last turn ended with nothing it waits on. */
  IDLE: "idle",
} as const;

type StackState = (typeof STACK_STATE)[keyof typeof STACK_STATE];

/** One position's card: the rollout's item, its worker, its pull request, what its worker waits on, and where it stands. */
export interface StackCard {
  /** Counted from one, as the plan's list numbers it. */
  readonly position: number;
  readonly item: RolloutItem;
  /** The worker the card stands for; none before one is started at the position. */
  readonly worker: CodingAgentSummary | undefined;
  /** The newest pull request a worker at the position published, as its row last kept it. */
  readonly published: CodingAgentPullRequest | null;
  /** The question or block the worker reported and waits on an answer to; none for a milestone or no report. */
  readonly waiting: CodingAgentLastReport | null;
  readonly state: StackState;
}

/** The positions on one base, in the plan's order. */
interface StackGroup {
  readonly base: RolloutItem["base"];
  readonly cards: readonly StackCard[];
}

/** One depth from main: its groups, in the order their first position stands in the plan. */
export type StackColumn = readonly StackGroup[];

/** The statuses a worker no longer holds its position under, by the rule a Start at the position is refused under. */
const ENDED_STATUSES: ReadonlySet<CodingAgentSummary["status"]> = new Set([
  CODING_AGENT_STATUS.FAILED,
  CODING_AGENT_STATUS.CANCELLED,
]);

/** The pull request states a later position may build on: its branch is pushed, or it is already on main. */
const BUILDABLE_STATES: ReadonlySet<CodingAgentPullRequest["state"]> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
  PULL_REQUEST_STATE.MERGED,
]);

/** The report kinds a worker waits on an answer after. */
const WAITING_KINDS: ReadonlySet<CodingAgentLastReport["kind"]> = new Set([
  WORKER_REPORT_KIND.QUESTION,
  WORKER_REPORT_KIND.BLOCKED,
]);

/** An open pull request's state by its checks: green once every one passed. */
const OPEN_STATE_OF_CHECKS = {
  [CHECK_SUMMARY.PASSING]: STACK_STATE.GREEN,
  [CHECK_SUMMARY.FAILING]: STACK_STATE.CHECKS_FAILING,
  [CHECK_SUMMARY.PENDING]: STACK_STATE.OPEN,
  [CHECK_SUMMARY.NONE]: STACK_STATE.OPEN,
} as const satisfies Record<CodingAgentPullRequest["checks"], StackState>;

/** What each state says on its card; a wait on an earlier position names it after these words. */
const STACK_STATE_WORDS = {
  [STACK_STATE.MERGED]: "merged",
  [STACK_STATE.ASKS]: "waiting on you",
  [STACK_STATE.BLOCKED]: "blocked",
  [STACK_STATE.WORKING]: "working",
  [STACK_STATE.FAILED]: "failed",
  [STACK_STATE.STOPPED]: "stopped",
  [STACK_STATE.GREEN]: "green",
  [STACK_STATE.CHECKS_FAILING]: "checks failing",
  [STACK_STATE.OPEN]: "open",
  [STACK_STATE.CLOSED]: "closed",
  [STACK_STATE.FINISHED]: "finished",
  [STACK_STATE.WAITING]: "waiting on",
  [STACK_STATE.READY]: "ready",
  [STACK_STATE.IDLE]: "idle",
} as const satisfies Record<StackState, string>;

/** The agents at the position, oldest started first; the keeper holds none, so it is never a card. */
function workersAt(agents: readonly CodingAgentSummary[], position: number) {
  return agents
    .filter((agent) => agent.position === position && agent.role !== ROLLOUT_ROLE.KEEPER)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The newest of the agents still holding their place (no failed or stopped newest turn), else the newest at all. */
function holderOf(agents: readonly CodingAgentSummary[]): CodingAgentSummary | undefined {
  return agents.findLast((agent) => !ENDED_STATUSES.has(agent.status)) ?? agents.at(-1);
}

/** Whether the agent works the rollout: a builder at a position, or its keeper. */
function rolloutAgent(agent: CodingAgentSummary): boolean {
  return agent.position !== undefined || agent.role === ROLLOUT_ROLE.KEEPER;
}

/** Whether a position's base lets it start: main, or an earlier position whose pull request is pushed or merged. */
function baseBuildable(
  base: RolloutItem["base"],
  published: readonly (CodingAgentPullRequest | null)[],
) {
  if (base === ROLLOUT_BASE.MAIN) return true;
  const state = published[base - 1]?.state;
  return state !== undefined && BUILDABLE_STATES.has(state);
}

/** Where a pull request stands once no worker's own state says more. */
function pullRequestState(published: CodingAgentPullRequest): StackState {
  if (published.state === PULL_REQUEST_STATE.CLOSED) return STACK_STATE.CLOSED;
  if (published.state === PULL_REQUEST_STATE.MERGED) return STACK_STATE.MERGED;
  return OPEN_STATE_OF_CHECKS[published.checks];
}

/**
 * Where a position stands: merged above all, then what its worker waits on
 * or is doing, then its pull request, and with no worker whether its base
 * lets it start.
 */
function stateOf(card: Omit<StackCard, "state">, buildable: boolean): StackState {
  const { worker, published, waiting } = card;
  if (published?.state === PULL_REQUEST_STATE.MERGED) return STACK_STATE.MERGED;
  if (waiting?.kind === WORKER_REPORT_KIND.QUESTION) return STACK_STATE.ASKS;
  if (waiting?.kind === WORKER_REPORT_KIND.BLOCKED) return STACK_STATE.BLOCKED;
  if (worker !== undefined && agentStillWriting(worker.status)) return STACK_STATE.WORKING;
  if (worker?.status === CODING_AGENT_STATUS.FAILED) return STACK_STATE.FAILED;
  if (worker?.status === CODING_AGENT_STATUS.CANCELLED) return STACK_STATE.STOPPED;
  if (published !== null) return pullRequestState(published);
  if (worker !== undefined) return STACK_STATE.FINISHED;
  return buildable ? STACK_STATE.READY : STACK_STATE.WAITING;
}

/** The rollout's cards in the plan's order. */
function cardsOf(
  rollout: readonly RolloutItem[],
  agents: readonly CodingAgentSummary[],
): readonly StackCard[] {
  const held = rollout.map((item, at) => {
    const workers = workersAt(agents, at + 1);
    const worker = workers.findLast((agent) => !ENDED_STATUSES.has(agent.status)) ?? workers.at(-1);
    const report = worker?.lastReport ?? null;
    return {
      position: at + 1,
      item,
      worker,
      published: workers.findLast((agent) => agent.published !== undefined)?.published ?? null,
      waiting: report !== null && WAITING_KINDS.has(report.kind) ? report : null,
    };
  });
  const published = held.map((card) => card.published);
  return held.map((card) => ({
    ...card,
    state: stateOf(card, baseBuildable(card.item.base, published)),
  }));
}

/**
 * The rollout as the tab lays it out: a column per depth from main, a
 * position on main at depth zero and one on an earlier position a column
 * past it, each column's positions grouped by the base they share. The
 * plan's list only ever bases a position on one before it, so each depth
 * is read off positions already placed.
 */
export function stackLayout(
  rollout: readonly RolloutItem[],
  agents: readonly CodingAgentSummary[],
): readonly StackColumn[] {
  const depths: number[] = [];
  const columns: StackGroup[][] = [];
  for (const card of cardsOf(rollout, agents)) {
    const base = card.item.base;
    const depth = base === ROLLOUT_BASE.MAIN ? 0 : (depths[base - 1] ?? 0) + 1;
    depths.push(depth);
    const column = columns[depth] ?? [];
    columns[depth] = column;
    const at = column.findIndex((group) => group.base === base);
    const group = column[at];
    if (group === undefined) column.push({ base, cards: [card] });
    else column[at] = { base, cards: [...group.cards, card] };
  }
  return columns;
}

/** Where a card stands in words: "green", "waiting on you", or "waiting on #1" for a base not yet pushed. */
export function stackStateWords(card: Pick<StackCard, "state" | "item">): string {
  const words = STACK_STATE_WORDS[card.state];
  if (card.state !== STACK_STATE.WAITING || card.item.base === ROLLOUT_BASE.MAIN) return words;
  return `${words} ${stackPositionLabel(card.item.base)}`;
}

/** A position as the tab names it: "#2". */
export function stackPositionLabel(position: number): string {
  return `#${position}`;
}

/** What a card says of its base: "base: main", or "on #2" for an earlier position. */
export function stackBaseWords(base: RolloutItem["base"]): string {
  return base === ROLLOUT_BASE.MAIN
    ? `base: ${ROLLOUT_BASE.MAIN}`
    : `on ${stackPositionLabel(base)}`;
}

/** Where a keeper stands: what it waits on an answer to, else what it is doing or how its turn ended. */
function keeperStateOf(agent: CodingAgentSummary): StackState {
  const kind = agent.lastReport?.kind;
  if (kind === WORKER_REPORT_KIND.QUESTION) return STACK_STATE.ASKS;
  if (kind === WORKER_REPORT_KIND.BLOCKED) return STACK_STATE.BLOCKED;
  if (agentStillWriting(agent.status)) return STACK_STATE.WORKING;
  if (agent.status === CODING_AGENT_STATUS.FAILED) return STACK_STATE.FAILED;
  if (agent.status === CODING_AGENT_STATUS.CANCELLED) return STACK_STATE.STOPPED;
  return STACK_STATE.IDLE;
}

/** The rollout's keeper as the tab's header draws it: the agent, and where it stands. */
export interface StackKeeper {
  readonly agent: CodingAgentSummary;
  readonly state: StackState;
}

/**
 * The plan's keeper, the one agent of the rollout at no position that owns
 * the stack's git structure: the newest keeper still holding its place,
 * else the newest at all, so a keeper that failed says so until another is
 * started; none before one is. It waits on an answer as a builder does, and
 * otherwise is working, failed, stopped, or idle.
 */
export function stackKeeper(agents: readonly CodingAgentSummary[]): StackKeeper | undefined {
  const keepers = agents
    .filter((agent) => agent.role === ROLLOUT_ROLE.KEEPER)
    .sort((a, b) => a.createdAt - b.createdAt);
  const agent = holderOf(keepers);
  if (agent === undefined) return undefined;
  return { agent, state: keeperStateOf(agent) };
}

/** Where the keeper stands in words: "working", "waiting on you", "idle". */
export function keeperStateWords(keeper: StackKeeper): string {
  return STACK_STATE_WORDS[keeper.state];
}

/** The rollout's agents, its builders and its keeper, which the tab follows. */
export function stackAgents(agents: readonly CodingAgentSummary[]): readonly CodingAgentSummary[] {
  return agents.filter(rolloutAgent);
}

/** Whether any agent of the rollout, a builder or its keeper, is at work, which is what keeps the tab reading its list again. */
export function stackWorking(agents: readonly CodingAgentSummary[]): boolean {
  return agents.some((agent) => rolloutAgent(agent) && agentStillWriting(agent.status));
}
