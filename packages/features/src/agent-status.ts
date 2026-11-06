import { TURN_STATUS } from "@repo/wire";
import { AGENT_STATUS, type AgentStatus } from "./agent-wire.js";

export const STARTING_GRACE_MILLIS = 5 * 60 * 1000;

export const LINE_GRACE_MILLIS = 5 * 60 * 1000;

const STATUS_OF_TURN = {
  [TURN_STATUS.QUEUED]: AGENT_STATUS.RUNNING,
  [TURN_STATUS.RUNNING]: AGENT_STATUS.RUNNING,
  [TURN_STATUS.SETTLED]: AGENT_STATUS.COMPLETED,
  [TURN_STATUS.CANCELED]: AGENT_STATUS.CANCELED,
  [TURN_STATUS.FAILED]: AGENT_STATUS.FAILED,
} as const satisfies Record<string, AgentStatus>;

const STATUS_WORDS: ReadonlySet<string> = new Set(Object.keys(STATUS_OF_TURN));

function isTurnStatusWord(status: string): status is keyof typeof STATUS_OF_TURN {
  return STATUS_WORDS.has(status);
}

export interface StatusTurn {
  readonly status: string;
  readonly cancelRequested: boolean;
  readonly cancelRequestedAt?: number | undefined;
  readonly queuedAt: number;
  readonly settledAt: number | null;
  readonly sessionEnded: boolean;
}

export interface StatusStanding {
  readonly createdAt: number;
  readonly now: number;
  readonly awaitingLineAt?: number | undefined;
  readonly blank?: boolean | undefined;
}

const LINE_STANDING = {
  NONE: "none",
  AWAITS: "awaits",
  UNANSWERED: "unanswered",
} as const;

type LineStanding = (typeof LINE_STANDING)[keyof typeof LINE_STANDING];

interface LineReading {
  readonly standing: LineStanding;
  readonly since?: number;
}

function turnRuns(turn: StatusTurn): boolean {
  return isTurnStatusWord(turn.status) && STATUS_OF_TURN[turn.status] === AGENT_STATUS.RUNNING;
}

function lineOf(
  turn: StatusTurn | undefined,
  standing: Pick<StatusStanding, "now" | "awaitingLineAt">,
): LineReading {
  const line = standing.awaitingLineAt;
  if (line === undefined) return { standing: LINE_STANDING.NONE };
  if (turn?.sessionEnded === true) return { standing: LINE_STANDING.NONE };
  const stoppedAt = turn?.cancelRequestedAt;
  if (stoppedAt !== undefined && line < stoppedAt) return { standing: LINE_STANDING.NONE };
  if (turn !== undefined && turnRuns(turn)) return { standing: LINE_STANDING.AWAITS };
  if (turn !== undefined && line < turn.queuedAt) return { standing: LINE_STANDING.NONE };
  const since = Math.max(line, turn?.settledAt ?? 0);
  return {
    standing:
      standing.now - since <= LINE_GRACE_MILLIS ? LINE_STANDING.AWAITS : LINE_STANDING.UNANSWERED,
    since,
  };
}

export function lineAwaitsTurn(
  turn: StatusTurn | undefined,
  standing: Pick<StatusStanding, "now" | "awaitingLineAt">,
): boolean {
  return lineOf(turn, standing).standing === LINE_STANDING.AWAITS;
}

export function turnStoppable(turn: StatusTurn | undefined): boolean {
  return turn !== undefined && turnRuns(turn) && !turn.cancelRequested;
}

export function agentStatusAt(turn: StatusTurn | undefined, standing: StatusStanding): AgentStatus {
  const line = lineOf(turn, standing).standing;
  if (line === LINE_STANDING.AWAITS) return AGENT_STATUS.RUNNING;
  if (line === LINE_STANDING.UNANSWERED) return AGENT_STATUS.FAILED;
  if (turn === undefined && standing.blank === true) return AGENT_STATUS.COMPLETED;
  if (turn === undefined) {
    return standing.now - standing.createdAt <= STARTING_GRACE_MILLIS
      ? AGENT_STATUS.STARTING
      : AGENT_STATUS.FAILED;
  }
  if (!isTurnStatusWord(turn.status)) return AGENT_STATUS.FAILED;
  const status = STATUS_OF_TURN[turn.status];
  return status === AGENT_STATUS.RUNNING && turn.cancelRequested ? AGENT_STATUS.CANCELED : status;
}

export function statusClockEdge(
  turn: StatusTurn | undefined,
  standing: StatusStanding,
): number | undefined {
  const line = lineOf(turn, standing);
  if (line.standing === LINE_STANDING.AWAITS) {
    return line.since === undefined ? undefined : line.since + LINE_GRACE_MILLIS + 1;
  }
  if (line.standing === LINE_STANDING.UNANSWERED || turn !== undefined) return undefined;
  if (standing.blank === true) return undefined;
  const edge = standing.createdAt + STARTING_GRACE_MILLIS;
  return standing.now <= edge ? edge + 1 : undefined;
}
