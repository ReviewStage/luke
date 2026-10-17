import assert from "node:assert/strict";
import { TURN_STATUS } from "@luke/wire";
import { test } from "vitest";
import {
  codingAgentStatusAt,
  LINE_GRACE_MILLIS,
  lineAwaitsTurn,
  STARTING_GRACE_MILLIS,
  type StatusTurn,
  statusClockEdge,
} from "./coding-agent-status.js";
import { CODING_AGENT_STATUS } from "./coding-agent-wire.js";

const STARTED = 1_700_000_000_000;

/** The agent read `sinceStart` after its Start, with the newest awaiting line written at `lineAt` where one stands. */
function standing(sinceStart: number, lineAt?: number) {
  return { createdAt: STARTED, now: STARTED + sinceStart, awaitingLineAt: lineAt };
}

/** A newest turn queued a second after the Start, in the state given. */
function turn(status: string, overrides: Partial<StatusTurn> = {}): StatusTurn {
  return {
    status,
    cancelRequested: false,
    queuedAt: STARTED + 1_000,
    settledAt: null,
    sessionEnded: false,
    ...overrides,
  };
}

test("an agent with no turn reads starting through its grace and failed past it, and the edge is the first instant it fails", () => {
  assert.equal(codingAgentStatusAt(undefined, standing(0)), CODING_AGENT_STATUS.STARTING);
  assert.equal(
    codingAgentStatusAt(undefined, standing(STARTING_GRACE_MILLIS)),
    CODING_AGENT_STATUS.STARTING,
  );
  const edge = statusClockEdge(undefined, standing(1_000));
  assert.equal(edge, STARTED + STARTING_GRACE_MILLIS + 1);
  assert.equal(
    codingAgentStatusAt(undefined, standing((edge ?? 0) - STARTED)),
    CODING_AGENT_STATUS.FAILED,
  );
  assert.equal(statusClockEdge(undefined, standing(STARTING_GRACE_MILLIS + 1)), undefined);
});

test("a turn reads as its own word ended, a running one with a Stop asked reads cancelled, and the clock moves neither", () => {
  const running = turn(TURN_STATUS.RUNNING);
  assert.equal(codingAgentStatusAt(running, standing(0)), CODING_AGENT_STATUS.RUNNING);
  assert.equal(
    codingAgentStatusAt(turn(TURN_STATUS.QUEUED), standing(0)),
    CODING_AGENT_STATUS.RUNNING,
  );
  assert.equal(
    codingAgentStatusAt({ ...running, cancelRequested: true }, standing(0)),
    CODING_AGENT_STATUS.CANCELLED,
  );
  assert.equal(
    codingAgentStatusAt(turn(TURN_STATUS.SETTLED, { cancelRequested: true }), standing(0)),
    CODING_AGENT_STATUS.COMPLETED,
  );
  assert.equal(codingAgentStatusAt(turn("paused"), standing(0)), CODING_AGENT_STATUS.FAILED);
  assert.equal(statusClockEdge(running, standing(0)), undefined);
  assert.equal(statusClockEdge(turn(TURN_STATUS.SETTLED), standing(0)), undefined);
});

test("a line awaiting its turn reads running inside its grace, counted from the later of its writing and the newest turn's end, and failed past it, the edge the first instant it fails", () => {
  const settled = turn(TURN_STATUS.SETTLED, { settledAt: STARTED + 10_000 });
  const lineAt = STARTED + 20_000;
  const inside = standing(20_000 + LINE_GRACE_MILLIS, lineAt);
  assert.equal(codingAgentStatusAt(settled, inside), CODING_AGENT_STATUS.RUNNING);
  assert.equal(lineAwaitsTurn(settled, inside), true);
  const edge = statusClockEdge(settled, standing(20_000, lineAt));
  assert.equal(edge, lineAt + LINE_GRACE_MILLIS + 1);
  const past = standing((edge ?? 0) - STARTED, lineAt);
  assert.equal(codingAgentStatusAt(settled, past), CODING_AGENT_STATUS.FAILED);
  assert.equal(lineAwaitsTurn(settled, past), false, "Stop and archive read the agent idle");
  assert.equal(statusClockEdge(settled, past), undefined);

  // A turn that ended after the line was written counts the grace from its end.
  const later = turn(TURN_STATUS.FAILED, { settledAt: lineAt + 60_000 });
  assert.equal(
    statusClockEdge(later, standing(20_000, lineAt)),
    lineAt + 60_000 + LINE_GRACE_MILLIS + 1,
  );

  // With no turn at all, a line holds an agent running past the starting grace, for its own grace.
  const noTurn = standing(STARTING_GRACE_MILLIS * 2, STARTED + STARTING_GRACE_MILLIS * 2);
  assert.equal(codingAgentStatusAt(undefined, noTurn), CODING_AGENT_STATUS.RUNNING);
});

test("a line beside a running turn awaits it whatever the clock says, so nothing but a row moves it", () => {
  const running = turn(TURN_STATUS.RUNNING);
  const long = standing(LINE_GRACE_MILLIS * 10, STARTED + 2_000);
  assert.equal(codingAgentStatusAt(running, long), CODING_AGENT_STATUS.RUNNING);
  assert.equal(lineAwaitsTurn(running, long), true);
  assert.equal(statusClockEdge(running, long), undefined);
});

test("a line written before the newest turn was queued was that turn's own, and awaits nothing once it ended", () => {
  const settled = turn(TURN_STATUS.SETTLED, { settledAt: STARTED + 5_000 });
  const opener = standing(6_000, STARTED + 500);
  assert.equal(codingAgentStatusAt(settled, opener), CODING_AGENT_STATUS.COMPLETED);
  assert.equal(lineAwaitsTurn(settled, opener), false);
  assert.equal(statusClockEdge(settled, opener), undefined);
});

test("a turn failed because its session ended for good leaves every line awaiting nothing", () => {
  const ended = turn(TURN_STATUS.FAILED, { settledAt: STARTED + 5_000, sessionEnded: true });
  const steer = standing(6_000, STARTED + 5_500);
  assert.equal(codingAgentStatusAt(ended, steer), CODING_AGENT_STATUS.FAILED);
  assert.equal(lineAwaitsTurn(ended, steer), false);
  assert.equal(statusClockEdge(ended, steer), undefined);
});
