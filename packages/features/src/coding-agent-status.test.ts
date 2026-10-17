import assert from "node:assert/strict";
import { TURN_STATUS } from "@luke/wire";
import { test } from "vitest";
import {
  codingAgentStatusAt,
  STARTING_GRACE_MILLIS,
  startingGraceEdge,
} from "./coding-agent-status.js";
import { CODING_AGENT_STATUS } from "./coding-agent-wire.js";

const STARTED = 1_700_000_000_000;

function standing(sinceStart: number, lineAwaits = false) {
  return { createdAt: STARTED, now: STARTED + sinceStart, lineAwaits };
}

test("an agent with no turn reads starting through its grace and failed past it, and the edge is the first instant it fails", () => {
  assert.equal(codingAgentStatusAt(undefined, standing(0)), CODING_AGENT_STATUS.STARTING);
  assert.equal(
    codingAgentStatusAt(undefined, standing(STARTING_GRACE_MILLIS)),
    CODING_AGENT_STATUS.STARTING,
  );
  const edge = startingGraceEdge(undefined, standing(1000));
  assert.equal(edge, STARTED + STARTING_GRACE_MILLIS + 1);
  assert.equal(
    codingAgentStatusAt(undefined, { createdAt: STARTED, now: edge ?? 0, lineAwaits: false }),
    CODING_AGENT_STATUS.FAILED,
  );
  assert.equal(startingGraceEdge(undefined, standing(STARTING_GRACE_MILLIS + 1)), undefined);
});

test("a turn reads as its own word ended, a running one with a Stop asked reads cancelled, and the clock moves neither", () => {
  const running = { status: TURN_STATUS.RUNNING, cancelRequested: false };
  assert.equal(codingAgentStatusAt(running, standing(0)), CODING_AGENT_STATUS.RUNNING);
  assert.equal(
    codingAgentStatusAt({ status: TURN_STATUS.QUEUED, cancelRequested: false }, standing(0)),
    CODING_AGENT_STATUS.RUNNING,
  );
  assert.equal(
    codingAgentStatusAt({ ...running, cancelRequested: true }, standing(0)),
    CODING_AGENT_STATUS.CANCELLED,
  );
  assert.equal(
    codingAgentStatusAt({ status: TURN_STATUS.SETTLED, cancelRequested: true }, standing(0)),
    CODING_AGENT_STATUS.COMPLETED,
  );
  assert.equal(
    codingAgentStatusAt({ status: "paused", cancelRequested: false }, standing(0)),
    CODING_AGENT_STATUS.FAILED,
  );
  assert.equal(startingGraceEdge(running, standing(0)), undefined);
});

test("a line awaiting its turn reads running over an ended turn or none, past the grace too", () => {
  const settled = { status: TURN_STATUS.SETTLED, cancelRequested: false };
  assert.equal(codingAgentStatusAt(settled, standing(0, true)), CODING_AGENT_STATUS.RUNNING);
  assert.equal(
    codingAgentStatusAt(undefined, standing(STARTING_GRACE_MILLIS * 2, true)),
    CODING_AGENT_STATUS.RUNNING,
  );
  assert.equal(startingGraceEdge(undefined, standing(0, true)), undefined);
});
