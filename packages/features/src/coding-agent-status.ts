import { TURN_STATUS } from "@luke/wire";
import { CODING_AGENT_STATUS, type CodingAgentStatus } from "./coding-agent-wire.js";

/**
 * coding-agent-status.ts -- where a coding agent stands, read from its newest turn at an instant: the one rule the service and the desktop both read an agent's status by.
 *
 * An agent's status is its conversation's newest turn row and the one
 * thing beside it, a message of the developer's still awaiting its turn:
 * `starting` before the first turn is queued, `running` while eve runs a
 * turn or a line waits for the turn it will open, and how the newest turn
 * ended after. A turn still running that carries a Stop stamp reads as
 * cancelled already, since the Stop is on its way to eve and nothing the
 * turn still does changes where it ends. An agent with no turn row long
 * past its Start (`STARTING_GRACE_MILLIS`) reads as failed rather than
 * starting forever, as one that never started. A line that awaits its turn
 * reads as running whatever the newest turn says, because the session took
 * the message and the turn it opens is on its way.
 *
 * The rule is pure and takes the instant it reads at, because the grace is
 * the one part of it the rows alone do not say: a reader following the rows
 * live reads the status again at `startingGraceEdge`, the one instant the
 * clock alone moves it.
 */

/**
 * How long after its Start an agent with no turn row yet still reads as
 * starting. eve took the session and its first turn lands in seconds; an
 * agent still without one past this is read as failed, so nothing reads
 * starting forever.
 */
export const STARTING_GRACE_MILLIS = 5 * 60 * 1000;

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

/** What of an agent's newest turn its status is read from: the turn's own word, and whether a Stop was asked of it. */
export interface StatusTurn {
  readonly status: string;
  readonly cancelRequested: boolean;
}

/** When the agent was started, in epoch milliseconds, the instant it is read at, and whether a line of the developer's awaits its turn. */
export interface StatusStanding {
  readonly createdAt: number;
  readonly now: number;
  readonly lineAwaits: boolean;
}

/** Where an agent stands, from its newest turn; running where a line awaits its turn, starting with no turn inside the grace, failed with none past it. */
export function codingAgentStatusAt(
  turn: StatusTurn | undefined,
  standing: StatusStanding,
): CodingAgentStatus {
  if (standing.lineAwaits) return CODING_AGENT_STATUS.RUNNING;
  if (turn === undefined) {
    return standing.now - standing.createdAt <= STARTING_GRACE_MILLIS
      ? CODING_AGENT_STATUS.STARTING
      : CODING_AGENT_STATUS.FAILED;
  }
  // A row outside the vocabulary is a write this build does not know, read as the one status that claims nothing.
  if (!isTurnStatusWord(turn.status)) return CODING_AGENT_STATUS.FAILED;
  const status = STATUS_OF_TURN[turn.status];
  return status === CODING_AGENT_STATUS.RUNNING && turn.cancelRequested
    ? CODING_AGENT_STATUS.CANCELLED
    : status;
}

/**
 * The instant past which the clock alone moves the agent's status, from
 * starting to failed, in epoch milliseconds; none where nothing but a row
 * changing can move it: a turn stands, a line awaits one, or the grace is
 * already past.
 */
export function startingGraceEdge(
  turn: StatusTurn | undefined,
  standing: StatusStanding,
): number | undefined {
  if (turn !== undefined || standing.lineAwaits) return undefined;
  const edge = standing.createdAt + STARTING_GRACE_MILLIS;
  return standing.now <= edge ? edge + 1 : undefined;
}
