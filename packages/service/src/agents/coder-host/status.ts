import type { CodingAgent, CodingAgentLatestTurn } from "@luke/database/models/coding-agent-store";
import type { StoredArchive, StoredAutomationOrigin } from "@luke/database/schemas/coding-agent";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentArchivedBy,
  type CodingAgentFailure,
  type CodingAgentOrigin,
  type CodingAgentPage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { Duration } from "effect";
import { BRAIN_REQUEST_FAILURE, TURN_STATUS } from "../../core.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";

/**
 * status.ts -- where a coding agent stands, read from its newest turn.
 *
 * An agent's status is its conversation's newest turn row and the one
 * thing beside it, a message of the developer's still awaiting its turn:
 * `starting` before the first turn is queued, `running` while eve runs a
 * turn or a line waits for the turn it will open, and how the newest turn
 * ended after. A turn still running that carries a Stop stamp
 * reads as cancelled already, since the Stop is on its way to eve and
 * nothing the turn still does changes where it ends. An agent with no turn
 * row long past its Start (`CODER.STARTING_GRACE`) reads as failed rather
 * than starting forever, as one that never started: eve took the session,
 * and its first turn lands in seconds or not at all. A line that awaits its turn reads as running
 * whatever the newest turn says, because the session took the message and
 * the turn it opens is on its way (`@luke/database/models/message-reads`'s
 * `awaitingLinesOf` is where a line is counted as waiting). A failed turn
 * is also read for why, as one of the wire's fixed words: the sweep's own
 * word for a turn it settled, else the host's refusal sentences where the
 * turn's detail carries one, GitHub's or the sandbox's, else the model
 * call, which is what every other eve failure of a coding turn is. Nothing
 * of the detail itself leaves here.
 */

/** The status a turn row's own status word reads as. */
const STATUS_OF_TURN = {
  [TURN_STATUS.QUEUED]: CODING_AGENT_STATUS.RUNNING,
  [TURN_STATUS.RUNNING]: CODING_AGENT_STATUS.RUNNING,
  [TURN_STATUS.SETTLED]: CODING_AGENT_STATUS.COMPLETED,
  [TURN_STATUS.CANCELLED]: CODING_AGENT_STATUS.CANCELLED,
  [TURN_STATUS.FAILED]: CODING_AGENT_STATUS.FAILED,
} as const satisfies Record<string, CodingAgentStatus>;

const STATUS_WORDS: ReadonlySet<string> = new Set(Object.keys(STATUS_OF_TURN));

function isTurnStatusWord(status: string): status is keyof typeof STATUS_OF_TURN {
  return STATUS_WORDS.has(status);
}

/** When the agent was started, when it is being read, which is what an agent with no turn is judged by, and whether a line of the developer's awaits its turn. */
export interface AgentStanding {
  readonly createdAt: Date;
  /** Epoch milliseconds now. */
  readonly now: number;
  /** Whether a message of the developer's stands in the transcript with no turn yet; none where unsaid. */
  readonly lineAwaits?: boolean;
}

/** Whether an agent with no turn row is still inside the grace its first turn may land in. */
function withinStartingGrace(standing: AgentStanding): boolean {
  return standing.now - standing.createdAt.getTime() <= Duration.toMillis(CODER.STARTING_GRACE);
}

/** Where an agent stands, from its newest turn; running where a line awaits its turn, starting with no turn inside the grace, failed with none past it. */
export function codingAgentStatusOf(
  turn: CodingAgentLatestTurn | undefined,
  standing: AgentStanding,
): CodingAgentStatus {
  if (standing.lineAwaits === true) return CODING_AGENT_STATUS.RUNNING;
  if (turn === undefined) {
    return withinStartingGrace(standing)
      ? CODING_AGENT_STATUS.STARTING
      : CODING_AGENT_STATUS.FAILED;
  }
  // A row outside the vocabulary is a write this build does not know, read as the one status that claims nothing.
  if (!isTurnStatusWord(turn.status)) return CODING_AGENT_STATUS.FAILED;
  const status = STATUS_OF_TURN[turn.status];
  return status === CODING_AGENT_STATUS.RUNNING && turn.cancelRequestedAt !== null
    ? CODING_AGENT_STATUS.CANCELLED
    : status;
}

/** The host's refusal sentences a failed turn's detail may carry, by the word the wire says for each. */
const FAILURE_WORDS: readonly (readonly [CodingAgentFailure, readonly string[]])[] = [
  [
    CODING_AGENT_FAILURE.GITHUB,
    [
      CODER_REFUSAL.NOT_REACHABLE,
      CODER_REFUSAL.GITHUB_UNAVAILABLE,
      REPOSITORY_REFUSAL.NOT_REACHABLE,
      REPOSITORY_REFUSAL.GITHUB_UNAVAILABLE,
    ],
  ],
  [CODING_AGENT_FAILURE.FAST_ON_OWN_KEY, [CODER_REFUSAL.FAST_ON_OWN_KEY]],
  [CODING_AGENT_FAILURE.FAST_NOT_ENABLED, [CODER_REFUSAL.FAST_NOT_ENABLED]],
  [
    CODING_AGENT_FAILURE.PROVIDER_KEY,
    [
      CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE,
      CODER_REFUSAL.ACCOUNT_KEY_REFUSED,
      CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA,
    ],
  ],
  [
    CODING_AGENT_FAILURE.SANDBOX,
    [
      REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
      REPOSITORY_REFUSAL.NO_FIREWALL,
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ],
  ],
];

/** Why an agent read as failed failed, as the wire's word: its newest turn's failure, or a session that never started where no turn stands; nothing for a turn that did not fail. */
export function codingAgentFailureOf(
  turn: Pick<CodingAgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): CodingAgentFailure | undefined {
  if (turn === undefined) return CODING_AGENT_FAILURE.NOT_STARTED;
  if (turn.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure === BRAIN_REQUEST_FAILURE.ABANDONED) return CODING_AGENT_FAILURE.ABANDONED;
  if (turn.failure !== BRAIN_REQUEST_FAILURE.MODEL) return CODING_AGENT_FAILURE.OTHER;
  const detail = turn.failureDetail ?? "";
  const named = FAILURE_WORDS.find(([, words]) => words.some((word) => detail.includes(word)));
  return named?.[0] ?? CODING_AGENT_FAILURE.MODEL;
}

/** What an agent's status is read from: its newest turn, and whether a line of the developer's awaits its turn. */
export interface AgentTurnStanding {
  readonly turn: CodingAgentLatestTurn | undefined;
  readonly lineAwaits: boolean;
}

/** When the run the status is read from began: the newest turn's start, or its queueing before eve starts it, the agent's own before any turn, and none while a line awaits its turn. */
export function codingAgentRunStartedAt(
  turn: CodingAgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "createdAt" | "lineAwaits">,
): number | undefined {
  if (standing.lineAwaits === true) return undefined;
  return (turn === undefined ? standing.createdAt : (turn.startedAt ?? turn.queuedAt)).getTime();
}

/**
 * When the agent last did something settled, in epoch milliseconds: the
 * latest of when it was started, when its newest turn was handed a message
 * (queued, then begun), and when that turn settled. None of them moves while
 * a turn streams, so a list ordered by it holds still while the agent works,
 * and moves once, when the turn ends. Note that a subagent's turns run inside
 * its parent's, and that an item the agent posts to the Inbox or a pull
 * request it opens is posted inside a turn, so the parent's turn already
 * brackets them, and none is read apart.
 */
export function codingAgentActivityAt(
  turn: CodingAgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "createdAt">,
): number {
  const begun = turn === undefined ? undefined : (turn.startedAt ?? turn.queuedAt);
  return Math.max(
    standing.createdAt.getTime(),
    begun?.getTime() ?? 0,
    turn?.settledAt?.getTime() ?? 0,
  );
}

/** Who archived an agent as its banner says it: the member, where their account stands, the agent acting for them, and why. */
function archivedByOf(
  archive: StoredArchive,
  names: ReadonlyMap<string, string>,
): CodingAgentArchivedBy {
  const member = names.get(archive.userId);
  return {
    by: archive.by,
    ...(member === undefined ? undefined : { member: { userId: archive.userId, name: member } }),
    ...(archive.agentId === undefined
      ? undefined
      : { agent: { id: archive.agentId, name: archive.agentName ?? "" } }),
    ...(archive.reason === undefined ? undefined : { reason: archive.reason }),
  };
}

/** What every read of one agent says of it but its task, its status read at `now`. */
function summaryFields(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
): Omit<CodingAgentSummary, "id" | "planId"> {
  const starter = names.get(agent.userId);
  const summary: Omit<CodingAgentSummary, "id" | "planId"> = {
    model: agent.model,
    effort: agent.effort,
    ...(agent.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: agent.contextWindow }
      : undefined),
    title: agent.title,
    createdAt: agent.createdAt.getTime(),
    status: codingAgentStatusOf(standing.turn, {
      createdAt: agent.createdAt,
      now,
      lineAwaits: standing.lineAwaits,
    }),
    turnId: standing.turn?.id ?? null,
    brief: agent.prompt === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.PROMPT,
    ...(agent.archivedAt === null ? undefined : { archivedAt: agent.archivedAt.getTime() }),
    ...(agent.archivedAt === null || agent.archivedBy === null
      ? undefined
      : { archivedBy: archivedByOf(agent.archivedBy, names) }),
    ...(agent.disabledServers.length === 0
      ? undefined
      : { disabledServers: agent.disabledServers }),
    ...(starter === undefined ? undefined : { startedBy: { userId: agent.userId, name: starter } }),
    ...(agent.automationId === null ? undefined : { automationId: agent.automationId }),
    ...(agent.automationOrigin === null
      ? undefined
      : { automationName: agent.automationOrigin.name }),
    ...(agent.startedFrom === null ? undefined : { from: agent.startedFrom }),
  };
  const started = codingAgentRunStartedAt(standing.turn, {
    createdAt: agent.createdAt,
    lineAwaits: standing.lineAwaits,
  });
  return started === undefined ? summary : { ...summary, runStartedAt: started };
}

/**
 * One agent as the tabs draw it, on a task or with none, its status read at
 * `now`, and the member who started it named by `names`, the accounts' names
 * by id, where theirs stands.
 */
export function codingAgentSummary(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
): CodingAgentSummary {
  return { id: agent.id, planId: agent.taskId, ...summaryFields(agent, standing, now, names) };
}

/**
 * The run that started an agent as its page opens on it: the prompt alone,
 * the issue or pull request a GitHub event named, a webhook's body, and the
 * member who asked for a run now, named by `names` where their account
 * stands.
 */
function originOf(
  origin: StoredAutomationOrigin,
  names: ReadonlyMap<string, string>,
): CodingAgentOrigin {
  const { firing } = origin;
  const subject =
    firing.kind === AUTOMATION_FIRING.GITHUB && firing.number !== undefined
      ? {
          number: firing.number,
          ...(firing.title === undefined ? undefined : { title: firing.title }),
          ...(firing.url === undefined ? undefined : { url: firing.url }),
        }
      : undefined;
  const runner =
    firing.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
      ? firing.userId
      : undefined;
  const name = runner === undefined ? undefined : names.get(runner);
  return {
    prompt: origin.prompt,
    ...(subject === undefined ? undefined : { subject }),
    ...(origin.body === undefined ? undefined : { body: origin.body }),
    ...(runner === undefined || name === undefined
      ? undefined
      : { runBy: { userId: runner, name } }),
  };
}

/** The accounts an agent's summary names: its starter, and the member it was archived by or for. */
export function summaryAccounts(agent: CodingAgent): readonly string[] {
  return agent.archivedBy === null ? [agent.userId] : [agent.userId, agent.archivedBy.userId];
}

/** The accounts an agent's page names: its summary's, and whoever asked for the run that started it. */
export function pageAccounts(agent: CodingAgent): readonly string[] {
  const firing = agent.automationOrigin?.firing;
  return firing?.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
    ? [...summaryAccounts(agent), firing.userId]
    : summaryAccounts(agent);
}

/** One agent as its own page reads it, on a task or with none, its status read at `now`. */
export function codingAgentPage(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
): CodingAgentPage {
  return {
    id: agent.id,
    planId: agent.taskId,
    ...summaryFields(agent, standing, now, names),
    automationId: agent.automationId,
    ...(agent.automationOrigin === null
      ? undefined
      : { origin: originOf(agent.automationOrigin, names) }),
    workspaceId: agent.organizationId,
    repository: agent.repository,
  };
}
