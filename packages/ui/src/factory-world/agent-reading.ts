/**
 * agent-reading.ts -- one coding agent as a world draws it: where it stands, what kind of work it builds, where, and how large.
 *
 * An agent's state reads its status first and its pull request after:
 *
 *   - failed: its run failed.
 *   - working: it is starting or running a turn.
 *   - stuck: it stopped on a draft pull request, or on an open one that has
 *     not moved for `AGENT_STUCK_AFTER_MS`.
 *   - waiting: it stopped and the next move is the developer's: an open pull
 *     request to review, or no pull request yet and a turn to answer.
 *   - idle: it was cancelled, or its pull request merged or closed.
 *
 * The zones it touches are its pull request's areas, each landed in its zone
 * (`zone-graph.ts`'s `zoneOfAreaIn`), weighted by its share of the lines. Its
 * primary zone is the one with the most lines; with no pull request, or one
 * whose areas land in no zone, it is its task's zone: the zone where the
 * task's other agents and its merged pull requests changed the most lines.
 */

import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import type {
  FactoryAgent,
  FactoryPullRequest,
  FactoryShipped,
} from "@luke/features/factory-world-wire";
import type { PullRequestArea } from "@luke/features/pull-request-area";

/** Where an agent stands, as every world draws it. */
export const AGENT_STATE = {
  WORKING: "working",
  STUCK: "stuck",
  WAITING: "waiting",
  FAILED: "failed",
  IDLE: "idle",
} as const;

export type AgentState = (typeof AGENT_STATE)[keyof typeof AGENT_STATE];

/** The kind of work an agent builds, the type of its pull request's Conventional Commits title. */
export const AGENT_KIND = {
  FEAT: "feat",
  FIX: "fix",
  REFACTOR: "refactor",
  PERF: "perf",
  DOCS: "docs",
  TEST: "test",
  BUILD: "build",
  CI: "ci",
  CHORE: "chore",
  STYLE: "style",
  REVERT: "revert",
  UNKNOWN: "unknown",
} as const;

/** @public Named by the Factory's worlds through `factory-world.ts`. */
export type AgentKind = (typeof AGENT_KIND)[keyof typeof AGENT_KIND];

/** How long an open pull request may stand without its agent moving before the agent reads as stuck. */
export const AGENT_STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

/** The lines at which a build reaches full size; a larger pull request is drawn no larger. */
export const BUILD_FULL_LINES = 5000;

/**
 * One zone an agent touches: how many of its lines landed there, and that share of all of them.
 *
 * @public Named by the Factory's worlds through `factory-world.ts`.
 */
export interface TouchedZone {
  readonly path: string;
  readonly lines: number;
  /** In (0, 1]; an agent's weights sum to 1. */
  readonly weight: number;
}

/** What a world draws of one agent. */
export interface AgentView {
  readonly id: string;
  /** The agent as the snapshot names it, for its card and its links. */
  readonly agent: FactoryAgent;
  readonly state: AgentState;
  readonly kind: AgentKind;
  /** The zone it builds in; null where neither its pull request nor its task lands in one. */
  readonly primaryZone: string | null;
  /** Its pull request's zones, the most lines first; empty before it opened one. */
  readonly touched: readonly TouchedZone[];
  /** Its pull request's lines on a log scale, in [0, 1]; zero before it opened one. */
  readonly buildSize: number;
}

/** What an agent's reading needs from the rest of the snapshot. */
export interface AgentContext {
  readonly now: number;
  readonly zoneOfArea: (areaPath: string) => string | null;
  readonly agents: readonly FactoryAgent[];
  readonly shipped: readonly FactoryShipped[];
}

const CONVENTIONAL_TITLE = /^([a-z]+)(?:\([^)]*\))?!?:\s/i;

function linesOf(item: { readonly additions: number; readonly deletions: number }): number {
  return item.additions + item.deletions;
}

function stateOfStopped(pullRequest: FactoryPullRequest | null, idleFor: number): AgentState {
  if (pullRequest === null) return AGENT_STATE.WAITING;
  switch (pullRequest.state) {
    case PULL_REQUEST_STATE.DRAFT:
      return AGENT_STATE.STUCK;
    case PULL_REQUEST_STATE.OPEN:
      return idleFor >= AGENT_STUCK_AFTER_MS ? AGENT_STATE.STUCK : AGENT_STATE.WAITING;
    case PULL_REQUEST_STATE.MERGED:
    case PULL_REQUEST_STATE.CLOSED:
      return AGENT_STATE.IDLE;
  }
}

/** Where an agent stands at `now`. */
function agentStateOf(agent: FactoryAgent, now: number): AgentState {
  const status: CodingAgentStatus = agent.status;
  switch (status) {
    case CODING_AGENT_STATUS.FAILED:
      return AGENT_STATE.FAILED;
    case CODING_AGENT_STATUS.STARTING:
    case CODING_AGENT_STATUS.RUNNING:
      return AGENT_STATE.WORKING;
    case CODING_AGENT_STATUS.CANCELLED:
      return AGENT_STATE.IDLE;
    case CODING_AGENT_STATUS.COMPLETED:
      return stateOfStopped(agent.pullRequest, now - agent.activityAt);
  }
}

/** The kind a title's Conventional Commits type names, else unknown. */
function agentKindOf(title: string | null): AgentKind {
  const type = CONVENTIONAL_TITLE.exec(title ?? "")?.[1]?.toLowerCase();
  return Object.values(AGENT_KIND).find((kind) => kind === type) ?? AGENT_KIND.UNKNOWN;
}

/** A build's size for `lines`: zero for none, 1 at `BUILD_FULL_LINES` and past it. */
function buildSizeOf(lines: number): number {
  return Math.min(1, Math.log1p(Math.max(0, lines)) / Math.log1p(BUILD_FULL_LINES));
}

/** Sums areas' lines into the zones they land in. */
function linesByZone(
  areas: readonly PullRequestArea[],
  zoneOfArea: (areaPath: string) => string | null,
  into: Map<string, number> = new Map(),
): Map<string, number> {
  for (const area of areas) {
    const zone = zoneOfArea(area.path);
    if (zone !== null) into.set(zone, (into.get(zone) ?? 0) + linesOf(area));
  }
  return into;
}

/** The most lines first, equal zones by path. */
function mostLinesFirst(lines: ReadonlyMap<string, number>): Array<[string, number]> {
  return [...lines].sort(
    ([leftPath, left], [rightPath, right]) => right - left || (leftPath < rightPath ? -1 : 1),
  );
}

function touchedOf(lines: ReadonlyMap<string, number>): TouchedZone[] {
  const total = [...lines.values()].reduce((sum, count) => sum + count, 0);
  return mostLinesFirst(lines).map(([path, count]) => ({
    path,
    lines: count,
    weight: total === 0 ? 1 / lines.size : count / total,
  }));
}

/**
 * The zone where the task's merged pull requests and its other agents' pull
 * requests changed the most lines; null for none. Note that a pull request
 * merged by one of the task's agents is in both lists, so each is counted
 * once by its number, from its merged row.
 */
function taskZoneOf(agent: FactoryAgent, context: AgentContext): string | null {
  if (agent.taskId === null) return null;
  const lines = new Map<string, number>();
  const counted = new Set<number>();
  for (const merged of context.shipped) {
    if (merged.taskId !== agent.taskId) continue;
    counted.add(merged.number);
    linesByZone(merged.areas, context.zoneOfArea, lines);
  }
  for (const other of context.agents) {
    const pullRequest = other.pullRequest;
    if (other.id === agent.id || other.taskId !== agent.taskId || pullRequest === null) continue;
    if (counted.has(pullRequest.number)) continue;
    counted.add(pullRequest.number);
    linesByZone(pullRequest.areas, context.zoneOfArea, lines);
  }
  return mostLinesFirst(lines)[0]?.[0] ?? null;
}

/** Reads one agent against the rest of the snapshot. */
export function agentViewOf(agent: FactoryAgent, context: AgentContext): AgentView {
  const pullRequest = agent.pullRequest;
  const touched = touchedOf(linesByZone(pullRequest?.areas ?? [], context.zoneOfArea));
  return {
    id: agent.id,
    agent,
    state: agentStateOf(agent, context.now),
    kind: agentKindOf(pullRequest?.title ?? agent.title),
    primaryZone: touched[0]?.path ?? taskZoneOf(agent, context),
    touched,
    buildSize: pullRequest === null ? 0 : buildSizeOf(linesOf(pullRequest)),
  };
}
