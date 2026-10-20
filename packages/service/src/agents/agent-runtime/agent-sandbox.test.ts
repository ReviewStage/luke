import assert from "node:assert/strict";
import { Duration } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { test } from "vitest";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { CODER } from "../coder-host/bounds.js";
import { AGENT_ROLE } from "./role.js";
import {
  lapsesCredential,
  renewsCredential,
  type SandboxRecord,
  stopsAtTurnEnd,
  withdrawsCredential,
} from "./sandbox.js";

/**
 * The coding agent's sandbox lifecycle as its root's store hook reads it:
 * the sandbox stopped at each turn's end unless a developer's terminal holds
 * it, and its credential renewed as it ages, or, where it is a member's own
 * token, taken off as the sandbox stops and set again at the next turn.
 */

const OPENED_AT = Date.UTC(2026, 9, 13, 9);
const OPENED: SandboxRecord = { openedAt: OPENED_AT };
const NEVER_OPENED: SandboxRecord = {};
const TURN = { turnId: "turn_0", sequence: 0 } as const;

const TURN_COMPLETED = stampedEveEvent({ type: "turn.completed", data: TURN }, OPENED_AT);

const TURN_ENDS: readonly MessageStreamEvent[] = [
  TURN_COMPLETED,
  stampedEveEvent({ type: "turn.cancelled", data: TURN }, OPENED_AT),
  stampedEveEvent(
    { type: "turn.failed", data: { ...TURN, code: "model_error", message: "upstream failed" } },
    OPENED_AT,
  ),
];

const STEP_STARTED = stampedEveEvent(
  { type: "step.started", data: { ...TURN, stepIndex: 1, modelId: "m" } },
  OPENED_AT,
);

const REFRESH_MS = Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH);

test("a coding agent's sandbox is stopped at a turn's end however the turn ended, once a sandbox tool has opened it", () => {
  for (const end of TURN_ENDS) {
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, OPENED, false), true, end.type);
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, NEVER_OPENED, false), false, end.type);
  }
  assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, STEP_STARTED, OPENED, false), false);
});

test("a coding agent's sandbox a developer's terminal holds is left running at a turn's end", () => {
  for (const end of TURN_ENDS) {
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, OPENED, true), false, end.type);
  }
});

test("a coding agent's credential is renewed at the first step past its age, counted from the open or the last renewal", () => {
  const aged = OPENED_AT + REFRESH_MS;
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, OPENED, aged - 1), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, OPENED, aged), true);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, TURN_COMPLETED, OPENED, aged), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, NEVER_OPENED, aged), false);
  const renewed: SandboxRecord = { ...OPENED, credentialAt: aged };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, renewed, aged + 1), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, renewed, aged + REFRESH_MS), true);
});

test("a member's own token is withdrawn at a turn's end that stops the sandbox, kept for a terminal that holds it, and set again at the next turn's first step, never for its age", () => {
  const onToken: SandboxRecord = { ...OPENED, memberToken: true };
  for (const end of TURN_ENDS) {
    assert.equal(withdrawsCredential(AGENT_ROLE.CODER, end, onToken, false), true, end.type);
    assert.equal(withdrawsCredential(AGENT_ROLE.CODER, end, onToken, true), false, end.type);
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, onToken), true, end.type);
    assert.equal(withdrawsCredential(AGENT_ROLE.CODER, end, OPENED, false), false, end.type);
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, OPENED), false, end.type);
  }
  const aged = OPENED_AT + REFRESH_MS;
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, onToken, aged), false);
  const lapsed: SandboxRecord = { ...onToken, credentialLapsed: true };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, lapsed, OPENED_AT), true);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, TURN_COMPLETED, lapsed, OPENED_AT), false);
});

test("a sandbox opened on a shallow checkout holds no credential: none is renewed, lapsed, or withdrawn until the first write deepens it, and its age counts from the deepen", () => {
  const shallow: SandboxRecord = { openedAt: OPENED_AT, openedShallow: true };
  const shallowOnToken: SandboxRecord = { ...shallow, memberToken: true, credentialLapsed: true };
  const aged = OPENED_AT + REFRESH_MS;
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, shallow, aged * 2), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, shallowOnToken, aged), false);
  for (const end of TURN_ENDS) {
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, shallowOnToken), false, end.type);
    assert.equal(
      withdrawsCredential(AGENT_ROLE.CODER, end, shallowOnToken, false),
      false,
      end.type,
    );
    // The sandbox itself is still stopped at the turn's end, shallow or not.
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, shallow, false), true, end.type);
  }

  const deepenedAt = OPENED_AT + REFRESH_MS / 2;
  const deepened: SandboxRecord = { ...shallow, deepenedAt };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, deepened, aged), false);
  assert.equal(
    renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, deepened, deepenedAt + REFRESH_MS),
    true,
  );
  const deepenedOnToken: SandboxRecord = { ...shallowOnToken, deepenedAt };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, deepenedOnToken, deepenedAt), true);
  for (const end of TURN_ENDS) {
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, deepenedOnToken), true, end.type);
  }
});
