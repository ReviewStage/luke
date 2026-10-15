import type { CodingAgent, CodingAgentLatestTurn } from "@luke/database/models/coding-agent-store";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentFailure,
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

/** What every read of one agent says of it but its plan, its status read at `now`. */
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
    ...(agent.disabledServers.length === 0
      ? undefined
      : { disabledServers: agent.disabledServers }),
    ...(starter === undefined ? undefined : { startedBy: { userId: agent.userId, name: starter } }),
  };
  const started = codingAgentRunStartedAt(standing.turn, {
    createdAt: agent.createdAt,
    lineAwaits: standing.lineAwaits,
  });
  return started === undefined ? summary : { ...summary, runStartedAt: started };
}

/**
 * One agent as the tabs draw it, on a plan or with none, its status read at
 * `now`, and the member who started it named by `names`, the accounts' names
 * by id, where theirs stands.
 */
export function codingAgentSummary(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
): CodingAgentSummary {
  return { id: agent.id, planId: agent.planId, ...summaryFields(agent, standing, now, names) };
}

/** One agent as its own page reads it, on a plan or with none, its status read at `now`. */
export function codingAgentPage(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
): CodingAgentPage {
  return {
    id: agent.id,
    planId: agent.planId,
    ...summaryFields(agent, standing, now, names),
    automationId: agent.automationId,
    workspaceId: agent.organizationId,
    repository: agent.repository,
  };
}
