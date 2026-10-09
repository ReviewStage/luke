import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { Duration } from "effect";
import { TURN_STATUS } from "../../core.js";
import type { CodingAgent, CodingAgentLatestTurn } from "../coding-agent-store.js";
import { CODER } from "./bounds.js";

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
 * than starting forever: eve took the session, and its first turn lands in
 * seconds or not at all. A line that awaits its turn reads as running
 * whatever the newest turn says, because the session took the message and
 * the turn it opens is on its way (`store/message-reads.ts`'s
 * `awaitingLinesOf` is where a line is counted as waiting).
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

/** What an agent's status is read from: its newest turn, and whether a line of the developer's awaits its turn. */
export interface AgentTurnStanding {
  readonly turn: CodingAgentLatestTurn | undefined;
  readonly lineAwaits: boolean;
}

/** One agent as the tabs draw it, its status read at `now`. */
export function codingAgentSummary(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
): CodingAgentSummary {
  return {
    id: agent.id,
    planId: agent.planId,
    model: agent.model,
    effort: agent.effort,
    createdAt: agent.createdAt.getTime(),
    status: codingAgentStatusOf(standing.turn, {
      createdAt: agent.createdAt,
      now,
      lineAwaits: standing.lineAwaits,
    }),
  };
}
