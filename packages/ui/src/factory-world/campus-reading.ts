/**
 * campus-reading.ts -- the Factory's campus as data: each listed task a building, what its windows say, and every pull request a container at the merge gate or in the shipped lot.
 *
 * The campus draws the same snapshot the worlds do (`factory-world.ts`), and
 * the tasks the window already lists. A task stands for its agents, those of
 * the snapshot's whose `taskId` is the task's, and says one thing at a time,
 * the most pressing first:
 *
 *   - failed: one of its agents failed.
 *   - working: one is starting or running a turn.
 *   - waiting: one stopped and the next move is the developer's.
 *   - stuck: one stopped on a draft, or on an open pull request nobody moved.
 *   - shipped: it has merged work, and nothing of it is open.
 *   - idle: none of the above, or no agent at all.
 *
 * A task's zone is where its agents' pull requests changed the most lines,
 * else the zone its first agent builds in, else where its merged work landed;
 * none where it has touched no code. Its blast radius is every zone that
 * depends on one it touched, as `blastRadiusOf` reads an agent's.
 *
 * Open pull requests wait at the merge gate in three lanes by their checks,
 * failing, running, and ready (passing, or none run), each by number. Merged
 * ones stand in the shipped lot, the newest first. A draft or a closed pull
 * request has no place on the campus. Nothing is stored: all of it is read
 * again from the snapshot on every draw.
 */

import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { FactoryPlanned, FactoryWorld } from "@luke/features/factory-world-wire";
import { AGENT_STATE, type AgentState, type AgentView } from "./agent-reading.js";
import type { BlastZone, FactoryWorldView } from "./factory-world.js";
import { reachOf } from "./zone-graph.js";

/** What a building's windows say, the most pressing first. */
export const CAMPUS_SIGNAL = {
  FAILED: "failed",
  WORKING: "working",
  WAITING: "waiting",
  STUCK: "stuck",
  SHIPPED: "shipped",
  IDLE: "idle",
} as const;

export type CampusSignal = (typeof CAMPUS_SIGNAL)[keyof typeof CAMPUS_SIGNAL];

/** The merge gate's lanes, the one nearest the gate last. */
export const GATE_LANE = {
  FAILING: "failing",
  RUNNING: "running",
  READY: "ready",
} as const;

export type GateLane = (typeof GATE_LANE)[keyof typeof GATE_LANE];

/** Where a container stands: waiting at the gate, or shipped past it. */
export const CONTAINER_PLACE = {
  GATE: "gate",
  LOT: "lot",
} as const;

type ContainerPlace = (typeof CONTAINER_PLACE)[keyof typeof CONTAINER_PLACE];

/** One task as the window lists it: what the campus needs of it. */
export interface CampusTaskInput {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

/** One listed task, as its building draws it. */
export interface CampusTask {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  /** Its agents in the snapshot, in the snapshot's order. */
  readonly agents: readonly AgentView[];
  readonly signal: CampusSignal;
  /** Whether one of its agents is at work, which is what smoke says. */
  readonly working: boolean;
  /** At work with no pull request opened or merged yet: a building going up. */
  readonly underway: boolean;
  /** It has merged work, and none of it is open: a flag on its roof. */
  readonly shipped: boolean;
  /** The zone it builds in, by path; null where it has touched no code. */
  readonly zone: string | null;
}

/** One pull request, as a container: its number, its lines, whose it is, and what a press on it picks. */
export interface CampusContainer {
  readonly number: number;
  readonly additions: number;
  readonly deletions: number;
  readonly place: ContainerPlace;
  /** The lane it waits in at the gate; none in the lot. */
  readonly lane: GateLane | null;
  /** The listed task it came from; null where none is known or listed. */
  readonly taskId: string | null;
  /** The agent whose pull request it is, at the gate; its URL, in the lot. */
  readonly id: string;
}

/** Everything the campus draws of one snapshot. */
export interface CampusReading {
  /** Every listed task, the earliest started first. */
  readonly tasks: readonly CampusTask[];
  readonly taskById: ReadonlyMap<string, CampusTask>;
  /** The open pull requests at the gate, lane by lane, each by number. */
  readonly gate: readonly CampusContainer[];
  /** The pull requests merged within the window, the newest first. */
  readonly lot: readonly CampusContainer[];
  readonly planned: readonly FactoryPlanned[];
}

const SIGNAL_OF_STATE = {
  [AGENT_STATE.FAILED]: CAMPUS_SIGNAL.FAILED,
  [AGENT_STATE.WORKING]: CAMPUS_SIGNAL.WORKING,
  [AGENT_STATE.WAITING]: CAMPUS_SIGNAL.WAITING,
  [AGENT_STATE.STUCK]: CAMPUS_SIGNAL.STUCK,
  [AGENT_STATE.IDLE]: CAMPUS_SIGNAL.IDLE,
} as const satisfies Record<AgentState, CampusSignal>;

const SIGNAL_RANK: readonly CampusSignal[] = Object.values(CAMPUS_SIGNAL);

const LANE_OF_CHECKS = {
  [CHECK_SUMMARY.FAILING]: GATE_LANE.FAILING,
  [CHECK_SUMMARY.PENDING]: GATE_LANE.RUNNING,
  [CHECK_SUMMARY.PASSING]: GATE_LANE.READY,
  [CHECK_SUMMARY.NONE]: GATE_LANE.READY,
} as const;

const LANE_RANK: readonly GateLane[] = Object.values(GATE_LANE);

/** The zone where `agents`' pull requests changed the most lines, each pull request counted once. */
function zoneOfAgents(agents: readonly AgentView[]): string | null {
  const lines = new Map<string, number>();
  const counted = new Set<number>();
  for (const agent of agents) {
    const number = agent.agent.pullRequest?.number;
    if (number === undefined || counted.has(number)) continue;
    counted.add(number);
    for (const zone of agent.touched)
      lines.set(zone.path, (lines.get(zone.path) ?? 0) + zone.lines);
  }
  let best: string | null = null;
  for (const [path, count] of lines) {
    const held = best === null ? -1 : (lines.get(best) ?? 0);
    if (count > held || (count === held && best !== null && path < best)) best = path;
  }
  return best;
}

function taskOf(
  input: CampusTaskInput,
  agents: readonly AgentView[],
  /** The zones its merges within the window landed in; none where it merged nothing there, empty where what it merged landed in no zone. */
  mergedZones: readonly string[] | undefined,
): CampusTask {
  const states = new Set<CampusSignal>(agents.map((agent) => SIGNAL_OF_STATE[agent.state]));
  const pullRequests = agents.flatMap((agent) =>
    agent.agent.pullRequest === null ? [] : [agent.agent.pullRequest],
  );
  const merged =
    mergedZones !== undefined ||
    pullRequests.some((pullRequest) => pullRequest.state === PULL_REQUEST_STATE.MERGED);
  const open = pullRequests.some(
    (pullRequest) =>
      pullRequest.state === PULL_REQUEST_STATE.OPEN ||
      pullRequest.state === PULL_REQUEST_STATE.DRAFT,
  );
  const shipped = merged && !open;
  if (shipped) states.add(CAMPUS_SIGNAL.SHIPPED);
  const signal = SIGNAL_RANK.find((each) => states.has(each)) ?? CAMPUS_SIGNAL.IDLE;
  const working = states.has(CAMPUS_SIGNAL.WORKING);
  return {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    agents,
    signal,
    working,
    underway: working && pullRequests.length === 0 && !merged,
    shipped,
    zone: zoneOfAgents(agents) ?? agents[0]?.primaryZone ?? mergedZones?.[0] ?? null,
  };
}

/** The open pull requests at the gate, one container each though two agents name it, lane by lane and by number. */
function gateOf(view: FactoryWorldView, listed: ReadonlySet<string>): CampusContainer[] {
  const byNumber = new Map<number, CampusContainer>();
  for (const agent of view.agents) {
    const pullRequest = agent.agent.pullRequest;
    if (pullRequest === null || pullRequest.state !== PULL_REQUEST_STATE.OPEN) continue;
    if (byNumber.has(pullRequest.number)) continue;
    const taskId = agent.agent.taskId;
    byNumber.set(pullRequest.number, {
      number: pullRequest.number,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      place: CONTAINER_PLACE.GATE,
      lane: LANE_OF_CHECKS[pullRequest.checks],
      taskId: taskId !== null && listed.has(taskId) ? taskId : null,
      id: agent.id,
    });
  }
  return [...byNumber.values()].sort(
    (left, right) =>
      LANE_RANK.indexOf(left.lane ?? GATE_LANE.READY) -
        LANE_RANK.indexOf(right.lane ?? GATE_LANE.READY) || left.number - right.number,
  );
}

/** Reads the campus from a view, the snapshot it was read from, and the window's listed tasks. */
export function campusReadingOf(
  view: FactoryWorldView,
  world: FactoryWorld,
  tasks: readonly CampusTaskInput[],
): CampusReading {
  const listed = new Set(tasks.map((task) => task.id));
  const agentsOf = new Map<string, AgentView[]>();
  for (const agent of view.agents) {
    const taskId = agent.agent.taskId;
    if (taskId === null || !listed.has(taskId)) continue;
    const held = agentsOf.get(taskId);
    if (held === undefined) agentsOf.set(taskId, [agent]);
    else held.push(agent);
  }
  const mergedZones = new Map<string, string[]>();
  for (const entry of view.timeline) {
    if (entry.taskId === undefined || entry.mergedAt > view.snapshotAt) continue;
    mergedZones.set(entry.taskId, [...(mergedZones.get(entry.taskId) ?? []), ...entry.zonePaths]);
  }
  const read = [...tasks]
    .sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1))
    .map((task) => taskOf(task, agentsOf.get(task.id) ?? [], mergedZones.get(task.id)));
  const lot = view.timeline
    .filter((entry) => entry.mergedAt <= view.snapshotAt)
    .map(
      (entry): CampusContainer => ({
        number: entry.number,
        additions: entry.additions,
        deletions: entry.deletions,
        place: CONTAINER_PLACE.LOT,
        lane: null,
        taskId: entry.taskId !== undefined && listed.has(entry.taskId) ? entry.taskId : null,
        id: entry.url,
      }),
    )
    .reverse();
  return {
    tasks: read,
    taskById: new Map(read.map((task) => [task.id, task])),
    gate: gateOf(view, listed),
    lot,
    planned: world.planned,
  };
}

/**
 * The zones a task's work ripples out to: every zone its agents' pull
 * requests touched and its merged work landed in, at distance zero, else the
 * zones its agents build in, then every zone that depends on one of them,
 * transitively, the nearest first and equal distances by path. A task that
 * has touched no code, or one the view holds nothing of, ripples nowhere.
 */
export function taskBlastRadiusOf(view: FactoryWorldView, taskId: string): BlastZone[] {
  const agents = view.agents.filter((agent) => agent.agent.taskId === taskId);
  const touched = new Set([
    ...agents.flatMap((agent) => agent.touched.map((zone) => zone.path)),
    ...view.timeline.flatMap((entry) =>
      entry.taskId === taskId && entry.mergedAt <= view.snapshotAt ? entry.zonePaths : [],
    ),
  ]);
  const origins =
    touched.size > 0
      ? [...touched]
      : agents.flatMap((agent) => (agent.primaryZone === null ? [] : [agent.primaryZone]));
  const known = origins.filter((path) => view.zoneByPath.has(path));
  const reach = reachOf(known, (path) => view.zoneByPath.get(path)?.dependents ?? []);
  return [...reach]
    .map(([path, distance]) => ({ path, distance }))
    .sort((left, right) => left.distance - right.distance || (left.path < right.path ? -1 : 1));
}
