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
 * starting forever, as one that never started.
 *
 * A line that awaits its turn reads as running whatever the newest turn
 * says, because the session took the message and the turn it opens is on
 * its way, but only for so long: a line that has waited past
 * `LINE_GRACE_MILLIS` with no turn running reads as failed, as one whose
 * turn is not coming, so the developer is offered Continue on it rather
 * than watching it run forever. A line older than the newest turn's
 * queueing that the turn never took awaits nothing: that turn was its, and
 * ended without the store hearing it received. A turn failed because its
 * session ended for good leaves every line awaiting nothing, since the
 * session that would have taken one is gone.
 *
 * The rule is pure and takes the instant it reads at, because the two
 * graces are the parts of it the rows alone do not say: a reader following
 * the rows live reads the status again at `statusClockEdge`, the next
 * instant the clock alone moves it.
 */

/**
 * How long after its Start an agent with no turn row yet still reads as
 * starting. eve took the session and its first turn lands in seconds; an
 * agent still without one past this is read as failed, so nothing reads
 * starting forever.
 */
export const STARTING_GRACE_MILLIS = 5 * 60 * 1000;

/**
 * How long a line of the developer's may stand with no turn to take it
 * while none runs, and still read the agent as running. eve opens the turn
 * on a line it took in seconds, as it lands the first turn of a Start
 * (`STARTING_GRACE_MILLIS`, whose length this shares); a line still waiting
 * past this is one whose turn is not coming.
 */
export const LINE_GRACE_MILLIS = 5 * 60 * 1000;

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

/** What of an agent's newest turn its status is read from, each instant in epoch milliseconds. */
export interface StatusTurn {
  /** The turn's own status word. */
  readonly status: string;
  /** Whether a Stop was asked of it. */
  readonly cancelRequested: boolean;
  /** When it was queued. */
  readonly queuedAt: number;
  /** When it settled; none while it is queued or runs. */
  readonly settledAt: number | null;
  /** Whether it failed because its session ended for good. */
  readonly sessionEnded: boolean;
}

/** When the agent was started and the instant it is read at, in epoch milliseconds, and when the newest line of the developer's still awaiting its turn was written, where one stands. */
export interface StatusStanding {
  readonly createdAt: number;
  readonly now: number;
  readonly awaitingLineAt?: number | undefined;
}

/** Where a line of the developer's with no turn stands: none, awaiting the turn it opens, or unanswered past the grace. */
const LINE_STANDING = {
  NONE: "none",
  AWAITS: "awaits",
  UNANSWERED: "unanswered",
} as const;

type LineStanding = (typeof LINE_STANDING)[keyof typeof LINE_STANDING];

/** Where the newest awaiting line stands, and from when its grace is counted where the clock decides it. */
interface LineReading {
  readonly standing: LineStanding;
  readonly since?: number;
}

/** Whether a turn row still runs, or is queued to: what takes a line at its next step, however long the step it is on runs. */
function turnRuns(turn: StatusTurn): boolean {
  return (
    isTurnStatusWord(turn.status) && STATUS_OF_TURN[turn.status] === CODING_AGENT_STATUS.RUNNING
  );
}

/**
 * Where the newest line awaiting a turn stands, and from when its grace is
 * counted where the clock decides it. A turn still running takes it, so it
 * awaits. With none running, a line written before the newest turn was
 * queued was that turn's opener, and the turn ended without the store
 * hearing it received, so it awaits nothing; a line written once the turn
 * was queued was a steer to it and still counts. Else it awaits for the
 * grace, counted from when it was written or the newest turn ended,
 * whichever came later, since that is how long it has stood with nothing
 * running to take it, and is unanswered past it.
 */
function lineOf(
  turn: StatusTurn | undefined,
  standing: Pick<StatusStanding, "now" | "awaitingLineAt">,
): LineReading {
  const line = standing.awaitingLineAt;
  if (line === undefined) return { standing: LINE_STANDING.NONE };
  if (turn?.sessionEnded === true) return { standing: LINE_STANDING.NONE };
  if (turn !== undefined && turnRuns(turn)) return { standing: LINE_STANDING.AWAITS };
  if (turn !== undefined && line < turn.queuedAt) return { standing: LINE_STANDING.NONE };
  const since = Math.max(line, turn?.settledAt ?? 0);
  return {
    standing:
      standing.now - since <= LINE_GRACE_MILLIS ? LINE_STANDING.AWAITS : LINE_STANDING.UNANSWERED,
    since,
  };
}

/** Whether a line of the developer's awaits the turn it opens, which keeps the agent at work: what an archive or a Stop reads the agent idle by. */
export function lineAwaitsTurn(
  turn: StatusTurn | undefined,
  standing: Pick<StatusStanding, "now" | "awaitingLineAt">,
): boolean {
  return lineOf(turn, standing).standing === LINE_STANDING.AWAITS;
}

/** Where an agent stands, from its newest turn; running where a line awaits its turn, failed where one went unanswered past its grace, starting with no turn inside the grace, failed with none past it. */
export function codingAgentStatusAt(
  turn: StatusTurn | undefined,
  standing: StatusStanding,
): CodingAgentStatus {
  const line = lineOf(turn, standing).standing;
  if (line === LINE_STANDING.AWAITS) return CODING_AGENT_STATUS.RUNNING;
  if (line === LINE_STANDING.UNANSWERED) return CODING_AGENT_STATUS.FAILED;
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
 * The next instant past which the clock alone moves the agent's status, in
 * epoch milliseconds: a line's grace running out, from running to failed,
 * or, with no turn and no line, the starting grace running out, from
 * starting to failed. None where nothing but a row changing can move it: a
 * turn runs, a line counts for nothing, or the grace is already past.
 */
export function statusClockEdge(
  turn: StatusTurn | undefined,
  standing: StatusStanding,
): number | undefined {
  const line = lineOf(turn, standing);
  if (line.standing === LINE_STANDING.AWAITS) {
    return line.since === undefined ? undefined : line.since + LINE_GRACE_MILLIS + 1;
  }
  if (line.standing === LINE_STANDING.UNANSWERED || turn !== undefined) return undefined;
  const edge = standing.createdAt + STARTING_GRACE_MILLIS;
  return standing.now <= edge ? edge + 1 : undefined;
}
